// Kleit share-page Worker (technical pack §4.1 "set-preview"; spec 8.2–8.4; roadmap M3.3, M3.5).
//
// Only /s/* reaches this code (wrangler.jsonc: run_worker_first). Everything else is a static
// asset or the SPA shell and never runs a Worker, so the free 100k/day limit is untouched.
//
// What it is: the one page a person with no account can open - the set, its pieces, prices and
// Buy, the sources, the creator's name, and a "Sign up" card. Rendered here as plain HTML with
// Open Graph tags, so iMessage and WhatsApp show a preview and Google can index a public set
// (spec 8.3, 8.4). It asks the database one question, `shared_set(code)`, with the public key;
// a wrong code, a private set and a draft all come back empty and render the same "not
// available" page - and "Only me" or a reset link makes an old link stop working at once,
// because there is no cache in between (spec 5.2; M3.3 "Done when").
//
// What it never does: it never holds a session, never takes a form, and never names the person
// looking. Voting (M3.7) and "send one back" (account) come later, on this same page.

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

type Piece = {
  id: string;
  slot: number | null;
  kind: "product" | "non_product" | "own";
  title: string | null;
  price_cents: number | null;
  price_currency: string | null;
  store_name: string | null;
  source_domain: string | null;
  buyable: boolean;
  pictured: boolean;
};

type SharedSet = {
  id: string;
  title: string;
  caption: string;
  layout: { background?: string; template?: string } | null;
  visibility: "public" | "link";
  published_at: string | null;
  owner: { username: string; display_name: string };
  pieces: Piece[];
};

const CODE = /^[A-Za-z0-9]{8,32}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/s/")) return env.ASSETS.fetch(request);

    const code = url.pathname.slice(3).replace(/\/+$/, "");
    if (!CODE.test(code)) return notAvailable();

    let set: SharedSet | null = null;
    try {
      set = await fetchSet(env, code);
    } catch {
      return notAvailable(503);
    }
    if (!set) return notAvailable();

    const base = `${url.protocol}//${url.host}`;
    return new Response(render(set, code, base, env), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // A link-only set must never be indexed; a public one may be, later, when the test site
        // is no longer noindex everywhere (M10).
        "x-robots-tag": set.visibility === "public" ? "noindex, nofollow" : "noindex, nofollow",
        "cache-control": "no-store",
        "x-kleit-surface": "share-worker",
      },
    });
  },
};

async function fetchSet(env: Env, code: string): Promise<SharedSet | null> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/shared_set`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_code: code }),
  });
  if (!response.ok) throw new Error(`shared_set: ${response.status}`);
  const body = (await response.json()) as SharedSet | null;
  return body && typeof body === "object" && body.id ? body : null;
}

function notAvailable(status = 404): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Kleit</title>${STYLE}</head>
<body><main class="wrap"><h1>This set isn't available</h1><p>It may have been made private, or the link may have been reset.</p>
<p><a class="button" href="/welcome">Open Kleit</a></p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
      "x-kleit-surface": "share-worker",
    },
  });
}

function esc(text: string | null | undefined): string {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function price(piece: Piece): string | null {
  if (piece.price_cents == null) return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: piece.price_currency ?? "USD" }).format(piece.price_cents / 100);
  } catch {
    return `${(piece.price_cents / 100).toFixed(2)} ${piece.price_currency ?? ""}`.trim();
  }
}

function render(set: SharedSet, code: string, base: string, env: Env): string {
  const title = set.title || "A set on Kleit";
  const who = set.owner.display_name?.trim() || `@${set.owner.username}`;
  const description = set.caption || `${set.pieces.length} piece${set.pieces.length === 1 ? "" : "s"} by ${who}`;
  const background = /^#[0-9a-fA-F]{6}$/.test(set.layout?.background ?? "") ? (set.layout!.background as string) : "#F4EFE6";
  const functions = `${env.SUPABASE_URL}/functions/v1`;
  const pageUrl = `${base}/s/${code}`;

  const pieces = set.pieces
    .map((p) => {
      const name = p.title?.trim() || (p.kind === "own" ? `${who}'s own piece` : "A piece");
      const tag = p.kind === "own" ? "OWN" : price(p);
      const img = p.pictured && p.kind === "product"
        ? `<img src="${functions}/item-image?item=${p.id}" alt="${esc(name)}" loading="lazy">`
        : `<div class="noimg" aria-hidden="true"></div>`;
      const buy = p.buyable
        ? `<a class="buy" rel="noopener noreferrer" target="_blank" href="${functions}/buy-redirect?item=${p.id}&set=${set.id}&network=direct" aria-label="Buy ${esc(name)} at ${esc(p.store_name ?? "the store")}, opens store site">Buy at ${esc(p.store_name ?? "the store")}</a>`
        : "";
      return `<li class="piece">${img}<div class="meta"><h3>${esc(name)}</h3>${tag ? `<p class="tag">${esc(tag)}</p>` : ""}${p.source_domain ? `<p class="from">from ${esc(p.source_domain)}</p>` : ""}${buy}</div></li>`;
    })
    .join("");

  const sources = [...new Set(set.pieces.map((p) => p.source_domain).filter(Boolean))] as string[];
  const hasBuy = set.pieces.some((p) => p.buyable);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Kleit</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Kleit">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${esc(pageUrl)}">
${STYLE}</head>
<body>
<header class="wrap top"><a class="mark" href="/welcome" aria-label="Kleit">Kleit</a></header>
<main class="wrap">
  <h1>${esc(title)}</h1>
  <p class="by">by ${esc(who)}${set.published_at ? ` · ${new Date(set.published_at).toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}</p>
  ${set.caption ? `<p class="caption">${esc(set.caption)}</p>` : ""}
  <section class="canvas" style="background:${background}" aria-label="The set">
    <ul class="pieces">${pieces}</ul>
  </section>
  ${hasBuy ? `<p class="disclosure">We earn a commission from purchases.</p>` : ""}
  <section class="card">
    <h2>Send one back</h2>
    <p>Make your own set in about a minute and send it to ${esc(who)}.</p>
    <a class="button" href="/welcome">Sign up</a>
  </section>
  ${sources.length ? `<section class="sources"><h2>Sources</h2><ul>${sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></section>` : ""}
</main>
<footer class="wrap foot">
  <a href="/settings/legal">Terms</a> · <a href="/settings/legal">Privacy</a> · <a href="/settings/legal">Copyright</a>
</footer>
</body></html>`;
}

// One small stylesheet, inline: the share page is under 1 MB and needs nothing from the app.
// Plain colours here are the page's own, not the app's theme: this page is seen by people who
// never opened the app, in whatever browser, and it must look the same to all of them.
const STYLE = `<style>
:root{color-scheme:light}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#faf8f4;color:#1f1d1a;line-height:1.4}
.wrap{max-width:640px;margin:0 auto;padding:16px}
.top{padding-bottom:0}.mark{font-weight:700;text-decoration:none;color:#1f1d1a;font-size:20px}
h1{font-size:26px;margin:12px 0 4px}h2{font-size:18px;margin:0 0 6px}h3{font-size:15px;margin:0}
.by,.from,.disclosure,.foot{color:#5f5a52;font-size:14px}.caption{font-size:17px;margin:8px 0 12px}
.canvas{border-radius:12px;padding:12px;margin-top:12px}
.pieces{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.piece{background:rgba(255,255,255,.7);border-radius:8px;overflow:hidden}
.piece img,.noimg{display:block;width:100%;aspect-ratio:1;object-fit:contain;background:#eee7dc}
.meta{padding:8px}.tag{margin:4px 0 0;font-weight:600;font-size:14px}
.buy,.button{display:inline-block;margin-top:8px;padding:10px 14px;border-radius:999px;background:#d9552b;color:#fff;text-decoration:none;font-weight:600;font-size:15px}
.card{margin-top:20px;padding:16px;border:1px solid #e6e0d6;border-radius:12px;background:#fff}
.sources{margin-top:20px}.sources ul{padding-left:18px}
.foot a{color:#5f5a52}
</style>`;
