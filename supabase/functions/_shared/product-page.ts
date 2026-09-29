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
};

const MAX_IMAGES = 8;

export function readProductPage(html: string, pageUrl: URL): ProductRead {
  const head = html.slice(0, 400_000);

  const meta = collectMeta(head);
  const ld = collectJsonLd(head);

  const title =
    clean(ld.name) ??
    clean(meta.get("og:title")) ??
    clean(meta.get("twitter:title")) ??
    clean(firstMatch(head, /<title[^>]*>([\s\S]*?)<\/title>/i)) ??
    null;

  const priceRaw =
    ld.price ??
    meta.get("product:price:amount") ??
    meta.get("og:price:amount") ??
    meta.get("twitter:data1") ??
    firstMatch(head, /itemprop=["']price["'][^>]*content=["']([^"']+)["']/i) ??
    null;
  const priceCents = toCents(priceRaw);

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

  return {
    title,
    priceCents,
    currency,
    storeName,
    images,
    canonical: canonical ? safeAbsolute(canonical, pageUrl) : null,
  };
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

type Ld = { name?: string | undefined; price?: string | undefined; currency?: string | undefined; brand?: string | undefined; images: string[] };

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
    const offersRaw = product["offers"];
    const offers = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
    if (offers && typeof offers === "object") {
      const o = offers as Record<string, unknown>;
      found.price = str(o["price"]) ?? str(o["lowPrice"]);
      found.currency = str(o["priceCurrency"]);
    }
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
