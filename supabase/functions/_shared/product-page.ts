/**
 * Reading what a store page says about its product (roadmap M2.4; spec 4.1 #4, #6, #9).
 *
 * No DOM. The things we want - name, price, currency, pictures, site name - are in the page's
 * head, in tags that were put there precisely so that other software could read them: Open
 * Graph (`og:*`), the product extension (`product:price:amount`), Twitter cards, and JSON-LD
 * `Product` blocks. A regex over the head is enough for all of them and needs no parser to keep
 * up to date. Each source is tried in order of how reliable it tends to be, and the first answer
 * wins per field, so a page with a good JSON-LD block and a stale og:title still comes out right.
 *
 * Pure: bytes in, a record out. Tested on fixtures in scripts/check-product-page.ts, so a change
 * that breaks one shape of page is caught without a network.
 */

export type ProductRead = {
  title: string | null;
  priceCents: number | null;
  currency: string | null;
  storeName: string | null;
  /** Absolute image URLs, best first, no duplicates. */
  images: string[];
  /** The page's own idea of its canonical address, if it has one. */
  canonical: string | null;
  /**
   * Whether the store offers the piece (spec 4.8 #1 "sold out"): true in stock, false sold out,
   * null when the page does not say. A page that does not say is not a page that says "gone".
   */
  available: boolean | null;
};

const MAX_IMAGES = 8;

/**
 * True when what came back is not the page at all: a bot wall or a JavaScript shell. Zara answers
 * a server with 2 KB and a title of "&nbsp;"; Nordstrom with 250 KB and not one <meta>. Neither
 * says "no" out loud, so this is how the reader tells the app the store did not really answer.
 */
export function looksLikeAShell(html: string): boolean {
  const metaCount = (html.match(/<meta\b/gi) ?? []).length;
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/&nbsp;|\s/g, "");
  return metaCount < 2 || (title.length === 0 && metaCount < 5) || html.length < 4000;
}

export function readProductPage(html: string, pageUrl: URL): ProductRead {
  // The whole of what was fetched (the fetch itself is capped). A JSON-LD block can sit a
  // megabyte in - Lululemon's does - and a cut at the "head" lost it.
  const head = html;

  const meta = collectMeta(head);
  const ld = collectJsonLd(head);

  const title =
    clean(ld.name) ??
    clean(meta.get("og:title")) ??
    clean(meta.get("twitter:title")) ??
    clean(firstMatch(head, /<title[^>]*>([\s\S]*?)<\/title>/i)) ??
    null;

  // First source with a REAL price wins. A zero is "no price" - Free People's JSON-LD says
  // "price": 0 while its meta tags carry the real one - so zero falls through to the next.
  const priceCandidates = [
    ld.price,
    meta.get("product:price:amount"),
    meta.get("og:price:amount"),
    meta.get("twitter:data1"),
    firstMatch(head, /itemprop=["']price["'][^>]*content=["']([^"']+)["']/i),
  ];
  let priceRaw: string | undefined;
  let priceCents: number | null = null;
  for (const candidate of priceCandidates) {
    const cents = toCents(candidate);
    if (cents != null && cents > 0) {
      priceRaw = candidate ?? undefined;
      priceCents = cents;
      break;
    }
  }

  const currency =
    normaliseCurrency(ld.currency) ??
    normaliseCurrency(meta.get("product:price:currency")) ??
    normaliseCurrency(meta.get("og:price:currency")) ??
    normaliseCurrency(firstMatch(head, /itemprop=["']priceCurrency["'][^>]*content=["']([^"']+)["']/i)) ??
    (priceCents != null && /\$/.test(String(priceRaw)) ? "USD" : null);

  const storeName =
    clean(meta.get("og:site_name")) ??
    clean(ld.brand) ??
    null;

  const images: string[] = [];
  const push = (candidate: string | null | undefined) => {
    if (!candidate) return;
    let absolute: string;
    try {
      absolute = new URL(candidate.trim(), pageUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/.test(absolute)) return;
    if (images.includes(absolute)) return;
    if (images.length < MAX_IMAGES) images.push(absolute);
  };
  for (const image of ld.images) push(image);
  for (const image of meta.getAll("og:image:secure_url")) push(image);
  for (const image of meta.getAll("og:image")) push(image);
  for (const image of meta.getAll("twitter:image")) push(image);
  // A product image under `itemprop="image"` on an <img> or <link>. Kept last: it is the least
  // curated of the sources.
  for (const m of head.matchAll(/itemprop=["']image["'][^>]*?(?:content|src|href)=["']([^"']+)["']/gi)) push(m[1]);

  const canonical = firstMatch(head, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    ?? firstMatch(head, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);

  // Stock: the first source that says. Inside the JSON-LD every offer and variant is read and
  // one in stock means in stock (a page lists a size per offer); across sources the first answer
  // wins, like every other field, so a stale og tag cannot overrule the product block.
  const available =
    ld.available ??
    stockOf(meta.get("product:availability")) ??
    stockOf(meta.get("og:availability")) ??
    stockOf(firstMatch(head, /itemprop=["']availability["'][^>]*?(?:href|content)=["']([^"']+)["']/i)) ??
    null;

  return {
    title,
    priceCents,
    currency,
    storeName,
    images,
    canonical: canonical ? safeAbsolute(canonical, pageUrl) : null,
    available,
  };
}

/**
 * One availability word to a reading: schema.org's ("https://schema.org/InStock", "OutOfStock",
 * "SoldOut", "PreOrder" ...) and Open Graph's ("instock", "oos", "out of stock", "preorder").
 * Something that can be ordered counts as offered; a word this does not know is no reading.
 */
export function stockOf(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  const word = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/schema\.org\//, "")
    .replace(/[\s_-]/g, "");
  if (/^(instock|instoreonly|onlineonly|limitedavailability|preorder|presale|backorder|availablefororder|available|instocks)$/.test(word)) return true;
  if (/^(outofstock|soldout|discontinued|oos|unavailable|notavailable)$/.test(word)) return false;
  return null;
}

function combineStock(readings: (boolean | null)[]): boolean | null {
  if (readings.some((r) => r === true)) return true;
  if (readings.some((r) => r === false)) return false;
  return null;
}

// ---------------------------------------------------------------------------

class Meta {
  private byName = new Map<string, string[]>();
  add(name: string, content: string) {
    const key = name.toLowerCase();
    const list = this.byName.get(key) ?? [];
    list.push(content);
    this.byName.set(key, list);
  }
  get(name: string): string | undefined {
    return this.byName.get(name.toLowerCase())?.[0];
  }
  getAll(name: string): string[] {
    return this.byName.get(name.toLowerCase()) ?? [];
  }
}

/** Every <meta> with a property or name, in document order, whichever way round its attributes are. */
function collectMeta(head: string): Meta {
  const meta = new Meta();
  for (const tag of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = tag[0];
    const name = firstMatch(attrs, /(?:property|name)=["']([^"']+)["']/i);
    const content = firstMatch(attrs, /content=["']([^"']*)["']/i);
    if (name && content != null) meta.add(name, decodeEntities(content));
  }
  return meta;
}

type Ld = {
  name?: string | undefined;
  price?: string | undefined;
  currency?: string | undefined;
  brand?: string | undefined;
  images: string[];
  /** Across every offer and variant: in stock if any is; sold out only if they all say so. */
  available?: boolean | null;
};

/** Offers as a list, whatever shape the page used: one, several, or an aggregate holding several. */
function offerList(raw: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const entry of Array.isArray(raw) ? raw : [raw]) {
    if (!entry || typeof entry !== "object") continue;
    const offer = entry as Record<string, unknown>;
    out.push(offer);
    // An AggregateOffer can carry the offers it aggregates.
    if (Array.isArray(offer["offers"])) {
      for (const inner of offer["offers"]) if (inner && typeof inner === "object") out.push(inner as Record<string, unknown>);
    }
  }
  return out;
}

/** The first JSON-LD Product on the page (also inside a @graph, and offers as an object or a list). */
function collectJsonLd(head: string): Ld {
  const found: Ld = { images: [] };
  for (const block of head.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1] ?? "");
    } catch {
      continue;
    }
    const product = findProduct(parsed);
    if (!product) continue;
    found.name = str(product["name"]);
    const brand = product["brand"];
    found.brand = typeof brand === "object" && brand ? str((brand as Record<string, unknown>)["name"]) : str(brand);
    const image = product["image"];
    if (typeof image === "string") found.images.push(image);
    else if (Array.isArray(image)) {
      for (const i of image) {
        if (typeof i === "string") found.images.push(i);
        else if (i && typeof i === "object") {
          const u = str((i as Record<string, unknown>)["url"]) ?? str((i as Record<string, unknown>)["contentUrl"]);
          if (u) found.images.push(u);
        }
      }
    } else if (image && typeof image === "object") {
      const u = str((image as Record<string, unknown>)["url"]);
      if (u) found.images.push(u);
    }
    // Offers: on the product, or - for a ProductGroup (H&M) - on its first variant. An Offer, a
    // list of Offers, or an AggregateOffer with a lowPrice; a price may also sit one level down
    // in a priceSpecification.
    let offersRaw = product["offers"];
    if (!offersRaw && Array.isArray(product["hasVariant"])) {
      const variant = product["hasVariant"][0];
      if (variant && typeof variant === "object") offersRaw = (variant as Record<string, unknown>)["offers"];
    }
    const offers = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
    if (offers && typeof offers === "object") {
      const o = offers as Record<string, unknown>;
      const spec = o["priceSpecification"];
      const specPrice = spec && typeof spec === "object" ? str((spec as Record<string, unknown>)["price"]) : undefined;
      found.price = str(o["price"]) ?? str(o["lowPrice"]) ?? specPrice;
      found.currency = str(o["priceCurrency"]) ??
        (spec && typeof spec === "object" ? str((spec as Record<string, unknown>)["priceCurrency"]) : undefined);
    }
    // Stock, from every offer there is: the product's own and each variant's (a size per offer
    // is the usual shape, and a product with one size left is still for sale).
    const readings = offerList(product["offers"]).map((o) => stockOf(o["availability"]));
    if (Array.isArray(product["hasVariant"])) {
      for (const variant of product["hasVariant"]) {
        if (!variant || typeof variant !== "object") continue;
        for (const o of offerList((variant as Record<string, unknown>)["offers"])) readings.push(stockOf(o["availability"]));
      }
    }
    found.available = combineStock(readings);
    break;
  }
  return found;
}

function findProduct(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || !node) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findProduct(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === "string" && /^(Product|ProductGroup|IndividualProduct)$/i.test(t))) return record;
  for (const key of ["@graph", "mainEntity", "itemListElement", "item", "hasVariant"]) {
    const hit = findProduct(record[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1];
}

function clean(value: string | undefined | null): string | undefined {
  if (value == null) return undefined;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text.slice(0, 200) : undefined;
}

/** "1,299.00", "$49", "49,99" (a comma decimal) all come out in cents; anything odd is null. */
export function toCents(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let text = String(raw).replace(/[^\d.,]/g, "");
  if (!text) return null;
  // Comma as decimal separator when it is the last separator and followed by exactly two digits.
  if (/,\d{2}$/.test(text) && !/\.\d{2}$/.test(text)) text = text.replace(/\./g, "").replace(",", ".");
  else text = text.replace(/,/g, "");
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
  return Math.round(value * 100);
}

function normaliseCurrency(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : undefined;
}

function safeAbsolute(candidate: string, base: URL): string | null {
  try {
    const url = new URL(decodeEntities(candidate).trim(), base);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

/** The site's plain name from its host, when the page does not say: "www.zara.com" -> "zara.com". */
export function domainOf(url: URL): string {
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

/** The address we lock onto the item: tracking codes and fragments removed (spec 4.2 #4). */
export function cleanSourceUrl(url: URL): string {
  const cleaned = new URL(url.toString());
  cleaned.hash = "";
  for (const key of [...cleaned.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|msclkid|mc_|ref|referrer|affid|aff_|cjevent|irclickid|_ga|_gl|yclid|dclid|srsltid|si$)/i.test(key)) {
      cleaned.searchParams.delete(key);
    }
  }
  return cleaned.toString();
}
