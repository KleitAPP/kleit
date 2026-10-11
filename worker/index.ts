// Kleit share-page Worker (technical pack §4.1 "set-preview"; spec 8.2–8.4; roadmap M3.3, M3.5).
//
// Only /s/*, /p/*, /e/* and a few form pages reach this code (wrangler.jsonc: run_worker_first).
// Everything else is a static asset or the SPA shell and never runs a Worker, so the free
// 100k/day limit is untouched.
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
// looking. "Send one back" (an account) comes later, on this same page.
//
// /p/<code> is the poll page (M3.7; spec 7.3): the 2–4 sets, a Vote under each, the privacy line
// and "one vote per device" BEFORE the first tap (design pack G11, G13), then the bars and the
// sign-up card (decision 88). The vote itself goes to the `cast-vote` function, never to the
// database; this page only draws.

// The library index: catalogue id → [file, title], written by scripts/build-library.mjs.
import LIBRARY from "../src/library/files.json";

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  TURNSTILE_SITE_KEY?: string;
  // "on" only on the live site (M10): lets search engines index Public set pages and serves the
  // sitemap. Anything else keeps every page noindex (the test site, security plan #21).
  INDEXING?: string;
}

function indexable(env: Env, visibility: string): boolean {
  return env.INDEXING === "on" && visibility === "public";
}

// Cloudflare's published always-passes test key, until Kleit has keys of its own (the same one
// the app's sign-up uses; see src/auth/turnstile.ts).
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

type PollPiece = {
  id: string;
  slot: number | null;
  kind: string;
  title: string | null;
  pictured: boolean;
};
type PollOption = {
  id: string;
  label: string;
  sort_order: number;
  set: {
    id: string;
    title: string;
    layout: { background?: string } | null;
    preview: string | null;
    pieces: PollPiece[];
  };
};
type SharedPoll = {
  id: string;
  question: string;
  closes_at: string;
  closed: boolean;
  owner: { username: string; display_name: string };
  options: PollOption[];
};

type Position = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  opacity?: number;
  hidden?: boolean;
  crop?: { x: number; y: number; w: number; h: number } | null;
};

type TextLayer = Position & {
  kind: "text";
  text: {
    text: string;
    font: string;
    size: number;
    colour: string;
    align: "left" | "center" | "right";
  };
};

type DecorLayer = Position & { kind: "asset"; asset: string; colour?: string };

const LIB = LIBRARY as unknown as {
  assets: Record<string, [string, string]>;
  backgrounds: Record<string, [string, string]>;
};

type Piece = {
  id: string;
  row?: string;
  slot: number | null;
  position?: Position | null;
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
  layout: {
    background?: string;
    template?: string;
    version?: number;
    canvas?: { w: number; h: number };
    order?: string[];
    texts?: Record<string, TextLayer>;
    decor?: Record<string, DecorLayer>;
    backgroundAsset?: string | null;
  } | null;
  visibility: "public" | "link";
  remixed_from?: string | null;
  published_at: string | null;
  owner: { username: string; display_name: string };
  preview: string | null;
  pieces: Piece[];
};

const CODE = /^[A-Za-z0-9]{8,32}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/p/")) return pollPage(request, env);
    if (url.pathname.startsWith("/e/")) return embedPage(request, env);
    if (url.pathname === "/takedown/status") return takedownStatusPage(request, env);
    if (url.pathname === "/takedown" || url.pathname === "/copyright")
      return takedownFormPage(request, env);
    if (url.pathname === "/sitemap.xml") return sitemap(request, env);
    if (url.pathname === "/contact") return contactPage(request, env);
    if (url.pathname === "/delete-account") return deleteAccountPage();
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
        "x-robots-tag": indexable(env, set.visibility) ? "index, follow" : "noindex, nofollow",
        "cache-control": "no-store",
        "x-kleit-surface": "share-worker",
      },
    });
  },
};

// The emergency switch for every public page (spec 22.2; M7.3): when `public_links_open` is
// off, every share and poll page answers "not available", read fresh on each request so the
// switch bites within a second of being flipped. Unreadable counts as open: a database blip
// must not take every shared link down with it.
async function publicLinksOpen(env: Env): Promise<boolean> {
  try {
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/app_settings?select=value&key=eq.public_links_open`,
      {
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        },
      },
    );
    if (!r.ok) return true;
    const rows = (await r.json()) as { value: unknown }[];
    return rows[0]?.value !== false && rows[0]?.value !== "false";
  } catch {
    return true;
  }
}

async function askDatabase<T extends { id: string }>(
  env: Env,
  fn: string,
  code: string,
): Promise<T | null> {
  if (!(await publicLinksOpen(env))) return null;
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_code: code }),
  });
  if (!response.ok) throw new Error(`${fn}: ${response.status}`);
  const body = (await response.json()) as T | null;
  return body && typeof body === "object" && body.id ? body : null;
}

function fetchSet(env: Env, code: string): Promise<SharedSet | null> {
  return askDatabase<SharedSet>(env, "shared_set", code);
}

// ---------------------------------------------------------------------------
// The poll page.
// ---------------------------------------------------------------------------
async function pollPage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.pathname.slice(3).replace(/\/+$/, "");
  if (!CODE.test(code)) return notAvailable();
  let poll: SharedPoll | null = null;
  try {
    poll = await askDatabase<SharedPoll>(env, "shared_poll", code);
  } catch {
    return notAvailable(503);
  }
  if (!poll || poll.options.length < 2) return notAvailable();
  return new Response(renderPoll(poll, code, `${url.protocol}//${url.host}`, env), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
      "x-kleit-surface": "share-worker",
    },
  });
}

function renderPoll(poll: SharedPoll, code: string, base: string, env: Env): string {
  const who = poll.owner.display_name?.trim() || `@${poll.owner.username}`;
  const question = poll.question?.trim() || "Which one?";
  const functions = `${env.SUPABASE_URL}/functions/v1`;
  const pageUrl = `${base}/p/${code}`;
  const closes = new Date(poll.closes_at);
  const closesText = closes.toLocaleDateString("en-US", { weekday: "long" });
  const options = [...poll.options].sort((a, b) => a.sort_order - b.sort_order);
  const firstPreview = options.find((o) => o.set.preview)?.set.preview ?? null;
  const pollPreview = firstPreview
    ? `${env.SUPABASE_URL}/storage/v1/object/public/set-previews/${firstPreview}`
    : null;

  const cards = options
    .map((o) => {
      const background = /^#[0-9a-fA-F]{6}$/.test(o.set.layout?.background ?? "")
        ? (o.set.layout!.background as string)
        : "#F4EFE6";
      const pieces = [...o.set.pieces]
        .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
        .slice(0, 4)
        .map((p) =>
          p.pictured
            ? `<img src="${functions}/item-image?item=${p.id}" alt="${esc(p.title ?? "")}" loading="lazy">`
            : `<div class="noimg" aria-hidden="true"></div>`,
        )
        .join("");
      const label = o.label?.trim() || o.set.title?.trim() || `Option ${o.sort_order + 1}`;
      return `<li class="option" data-option="${o.id}">
  <div class="mini" style="background:${background}" aria-hidden="true">${pieces}</div>
  <div class="meta"><h3>${esc(label)}</h3>${o.set.title && o.set.title !== label ? `<p class="from">${esc(o.set.title)}</p>` : ""}
    <div class="bar" hidden><div class="fill"></div></div><p class="pct" hidden></p>
    <button class="vote" type="button" data-option="${o.id}" aria-label="Vote for ${esc(label)}">Vote</button>
  </div>
</li>`;
    })
    .join("");

  const config = JSON.stringify({
    code,
    functions,
    anonKey: env.SUPABASE_ANON_KEY,
    siteKey: env.TURNSTILE_SITE_KEY || TURNSTILE_TEST_SITE_KEY,
    sessionKey: `sb-${new URL(env.SUPABASE_URL).hostname.split(".")[0]}-auth-token`,
    closed: poll.closed,
    closesText,
  });

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(question)} · Kleit</title>
<meta name="description" content="${esc(who)} asks: ${esc(question)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Kleit">
<meta property="og:title" content="${esc(question)}">
<meta property="og:description" content="Help ${esc(who)} choose - ${options.length} sets, one tap.">
<meta property="og:url" content="${esc(pageUrl)}">
${
  pollPreview
    ? `<meta property="og:image" content="${esc(pollPreview)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1200">
<meta name="twitter:image" content="${esc(pollPreview)}">`
    : ""
}
<meta name="twitter:card" content="${pollPreview ? "summary_large_image" : "summary"}">
<link rel="canonical" href="${esc(pageUrl)}">
${STYLE}${POLL_STYLE}</head>
<body>
<header class="wrap top"><a class="mark" href="/welcome" aria-label="Kleit">Kleit</a></header>
<main class="wrap">
  <h1>${esc(question)}</h1>
  <p class="by">${esc(who)} is asking${poll.closed ? " · closed" : ` · until ${esc(closesText)}`}</p>
  <p class="notice" id="notice" role="status" hidden></p>
  <ul class="options" id="options">${cards}</ul>
  <p class="quiet" id="before">Tap Vote under the one you'd pick. One vote per device. <a href="/settings/legal">How we handle votes</a>.</p>
  <p class="quiet" id="after" hidden>One vote per device · <span id="change">You can change your vote until ${esc(closesText)}</span></p>
  <div id="turnstile" class="turnstile"></div>
  <section class="card" id="signup" hidden>
    <h2>Send one back</h2>
    <p>Sign up to see who voted, and make your own set in about a minute.</p>
    <a class="button" href="/welcome?next=${encodeURIComponent(`/p/${code}`)}">Sign up</a>
  </section>
</main>
<footer class="wrap foot">
  <a href="/help">Help</a> · <a href="/contact">Contact</a> · <a href="/settings/legal">Terms</a> · <a href="/settings/legal">Privacy</a> · <a href="/copyright">Copyright</a> · <a href="/takedown">Remove an intimate image</a>
</footer>
<script>window.KLEIT_POLL=${config.replace(/</g, "\\u003c")};</script>
<script>${POLL_SCRIPT}</script>
</body></html>`;
}

/**
 * A Creative set (layout version 2) drawn where its owner put things: each pictured piece an
 * absolutely placed image in percentages of the canvas, rotated, flipped and faded as saved,
 * hidden layers skipped, in the saved order. The piece list follows for Buy and the names.
 */
function creativeCanvas(set: SharedSet, functions: string, background: string): string {
  if (set.layout?.version !== 2 || !set.layout.canvas) return "";
  const { w, h } = set.layout.canvas;
  const byRow = new Map(set.pieces.filter((p) => p.row).map((p) => [p.row as string, p]));
  const texts = set.layout.texts ?? {};
  const decor = set.layout.decor ?? {};
  const order = (set.layout.order ?? []).filter((id) => byRow.has(id) || texts[id] || decor[id]);
  for (const p of set.pieces) if (p.row && !order.includes(p.row)) order.push(p.row);
  const fontsUsed = new Set<string>();
  const bgEntry = set.layout.backgroundAsset ? LIB.backgrounds[set.layout.backgroundAsset] : null;
  const bgPicture = bgEntry
    ? `<img src="/library/${bgEntry[0]}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`
    : "";
  const layers = order
    .map((id) => {
      const d = decor[id];
      if (d) {
        // A decoration from the library (M4.4): the same picture the app drew, from this site's
        // own /library/ folder, with the museum's title as its alt text.
        if (d.hidden) return "";
        const entry = LIB.assets[d.asset];
        if (!entry) return "";
        const transform = `rotate(${d.rotation ?? 0}deg) scale(${d.flipX ? -1 : 1},${d.flipY ? -1 : 1})`;
        if (entry[0].endsWith(".svg")) {
          // A structural piece is one colour: the SVG as a mask, filled with the colour the
          // owner chose - which is written in the set and never changes (L14).
          const colour = /^#[0-9a-fA-F]{6}$/.test(d.colour ?? "") ? d.colour : "#161513";
          return `<div role="img" aria-label="${esc(entry[1])}" style="position:absolute;left:${(d.x / w) * 100}%;top:${(d.y / h) * 100}%;width:${(d.w / w) * 100}%;height:${(d.h / h) * 100}%;transform:${transform};opacity:${d.opacity ?? 1};background:${colour};-webkit-mask:url(/library/${entry[0]}) 0 0/100% 100%;mask:url(/library/${entry[0]}) 0 0/100% 100%"></div>`;
        }
        const crop = d.crop
          ? `;width:${100 / d.crop.w}%;height:${100 / d.crop.h}%;margin-left:${(-d.crop.x / d.crop.w) * 100}%;margin-top:${(-d.crop.y / d.crop.h) * 100}%;max-width:none`
          : "";
        return `<div style="position:absolute;left:${(d.x / w) * 100}%;top:${(d.y / h) * 100}%;width:${(d.w / w) * 100}%;height:${(d.h / h) * 100}%;transform:${transform};opacity:${d.opacity ?? 1};overflow:hidden"><img src="/library/${entry[0]}" alt="${esc(entry[1])}" loading="lazy" style="width:100%;height:100%;object-fit:fill${crop}"></div>`;
      }
      const text = texts[id];
      if (text) {
        if (text.hidden) return "";
        // A curated font is served from this site; a private font never leaves the account, so
        // its words come as a picture drawn by the server (text-image).
        const isPrivate = text.text.font.startsWith("private:");
        if (!isPrivate) fontsUsed.add(text.text.font);
        const transform = `rotate(${text.rotation ?? 0}deg) scale(${text.flipX ? -1 : 1},${text.flipY ? -1 : 1})`;
        const box = `position:absolute;left:${(text.x / w) * 100}%;top:${(text.y / h) * 100}%;width:${(text.w / w) * 100}%;transform:${transform};opacity:${text.opacity ?? 1}`;
        if (isPrivate) {
          return `<div style="${box}"><img src="${functions}/text-image?set=${set.id}&layer=${encodeURIComponent(id)}" alt="${esc(text.text.text)}" style="width:100%;display:block"></div>`;
        }
        return `<div style="${box};font-family:kleit-${esc(text.text.font)},sans-serif;font-size:${(text.text.size / w) * 100}cqw;line-height:1.2;color:${esc(text.text.colour)};text-align:${text.text.align};white-space:pre-wrap">${esc(text.text.text)}</div>`;
      }
      const p = byRow.get(id)!;
      const pos = p.position;
      if (!pos || pos.hidden) return "";
      const img = p.pictured
        ? `<img src="${functions}/item-image?item=${p.id}" alt="${esc(p.title ?? "")}" loading="lazy" style="width:100%;height:100%;object-fit:fill${
            pos.crop
              ? `;width:${100 / pos.crop.w}%;height:${100 / pos.crop.h}%;margin-left:${(-pos.crop.x / pos.crop.w) * 100}%;margin-top:${(-pos.crop.y / pos.crop.h) * 100}%;max-width:none`
              : ""
          }">`
        : "";
      const transform = `rotate(${pos.rotation ?? 0}deg) scale(${pos.flipX ? -1 : 1},${pos.flipY ? -1 : 1})`;
      return `<div style="position:absolute;left:${(pos.x / w) * 100}%;top:${(pos.y / h) * 100}%;width:${(pos.w / w) * 100}%;height:${(pos.h / h) * 100}%;transform:${transform};opacity:${pos.opacity ?? 1};overflow:hidden">${img}</div>`;
    })
    .join("");
  const faces = [...fontsUsed]
    .filter((f) => /^[a-z0-9]+$/.test(f))
    .map((f) => `@font-face{font-family:kleit-${f};src:url(/fonts/${f}.ttf);font-display:swap}`)
    .join("");
  return `${faces ? `<style>${faces}</style>` : ""}<section class="creative" style="background:${background};aspect-ratio:${w} / ${h};container-type:inline-size" aria-label="The set">${bgPicture}${layers}</section>`;
}

// ---------------------------------------------------------------------------
// The takedown forms (M7.4; spec 13.3 #3–#4): TAKE IT DOWN and DMCA, with no account. The page
// posts to the takedown-request function with a Turnstile token and shows the reference back.
// ---------------------------------------------------------------------------
function takedownFormPage(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const copyright = url.pathname === "/copyright";
  const config = JSON.stringify({
    fn: `${env.SUPABASE_URL}/functions/v1/takedown-request`,
    anon: env.SUPABASE_ANON_KEY,
    siteKey: env.TURNSTILE_SITE_KEY || TURNSTILE_TEST_SITE_KEY,
    kind: copyright ? "copyright" : "intimate",
  });
  const title = copyright ? "Report a copyright problem" : "Remove an intimate image";
  const intro = copyright
    ? "If a picture on Kleit uses your work without permission, tell us here (a DMCA notice). No account needed. We answer within 72 hours, and the picture - and every identical copy - comes down if the notice is complete and in good faith."
    : "If an intimate image of you is on Kleit without your consent, tell us here. No account needed, and you don't have to say anything you'd rather not. We remove it, and every identical copy, within 48 hours. You get a reference to check on.";
  const dmcaFields = copyright
    ? `<label>The work that's yours<textarea name="work" maxlength="1000" required placeholder="What the original is and where it can be seen"></textarea></label>
<label class="check"><input type="checkbox" name="statements" required> I have a good-faith belief this use isn't authorised by the owner, its agent or the law; the information here is accurate; and, under penalty of perjury, I am the owner or authorised to act for them.</label>
<label>Your signature (type your full name)<input name="signature" maxlength="120" required></label>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} · Kleit</title>${STYLE}
<style>form{display:flex;flex-direction:column;gap:12px;margin-top:12px}label{display:flex;flex-direction:column;gap:4px;font-size:14px;color:#5f5a52}
input,textarea{font:inherit;font-size:16px;padding:10px;border:1px solid #d9d2c6;border-radius:8px;background:#fff;color:#1f1d1a}textarea{min-height:90px}
.check{flex-direction:row;align-items:flex-start;gap:8px;color:#1f1d1a}.check input{margin-top:3px}
.note{font-size:14px;color:#5f5a52}.ok{border:1px solid #d9d2c6;border-radius:12px;padding:14px;margin-top:12px}.ref{font-size:22px;font-weight:700}</style></head>
<body><main class="wrap"><a class="mark" href="/welcome">Kleit</a>
<h1>${title}</h1><p>${intro}</p>
<form id="f" novalidate>
<label>Your name<input name="name" maxlength="120" required autocomplete="name"></label>
<label>Your email (for updates on this request)<input name="email" type="email" maxlength="200" required autocomplete="email"></label>
<label>Where the picture is - one link per line (a kleit link, like /s/… or /item/…)<textarea name="urls" required placeholder="https://…"></textarea></label>
<label>Anything else that helps (optional)<textarea name="details" maxlength="2000"></textarea></label>
${dmcaFields}
<div id="turnstile" class="turnstile"></div>
<p class="note">${copyright ? "A false notice can carry liability under US law." : "Nobody else is told who asked. If you're under 18, tell us in the box above and we'll treat it as urgent."}</p>
<button class="button" type="submit">Send</button>
<p id="msg" class="note" role="status" aria-live="polite"></p>
</form>
<section id="done" class="ok" hidden><p>Sent. Your reference:</p><p class="ref" id="ref"></p><p class="note" id="hours"></p><p class="note">Keep it. You can check on it any time at <a href="/takedown/status">kleit's takedown status page</a>.</p></section>
<footer class="wrap foot"><a href="/settings/legal">Terms</a> · <a href="/settings/legal">Privacy</a></footer>
</main>
<script>window.KLEIT_TD=${config.replace(/</g, "\\u003c")};</script>
<script>${TAKEDOWN_SCRIPT}</script>
</body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
      "x-kleit-surface": "share-worker",
    },
  });
}

async function takedownStatusPage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const ref = (url.searchParams.get("ref") ?? "").trim().toUpperCase().slice(0, 20);
  let line = "";
  if (ref) {
    try {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/takedown_status`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_ref: ref }),
      });
      const rows = (await r.json()) as {
        kind: string;
        state: string;
        created_at: string;
        resolved_at: string | null;
      }[];
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) line = "No request with that reference. Check the letters and try again.";
      else if (row.state === "open")
        line =
          "Received and waiting for a person to look at it. We answer within 48 hours for an intimate image, 72 for copyright.";
      else if (row.state === "removed")
        line = "Done: the picture and any identical copies were removed.";
      else
        line =
          "Reviewed: we couldn't act on this request as sent. Reply to the email we sent if you have more to add.";
    } catch {
      line = "We couldn't check right now. Try again in a minute.";
    }
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Takedown status · Kleit</title>${STYLE}
<style>form{display:flex;gap:8px;margin-top:12px}input{font:inherit;font-size:16px;padding:10px;border:1px solid #d9d2c6;border-radius:8px;flex:1;min-width:0}</style></head>
<body><main class="wrap"><a class="mark" href="/welcome">Kleit</a>
<h1>Where your request got to</h1>
<form method="get" action="/takedown/status"><input name="ref" value="${esc(ref)}" placeholder="T-XXXXXXXX" aria-label="Your reference" maxlength="20" required><button class="button" type="submit">Check</button></form>
${line ? `<p>${esc(line)}</p>` : ""}
<footer class="wrap foot"><a href="/takedown">Remove an intimate image</a> · <a href="/copyright">Copyright</a></footer>
</main></body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
      "x-kleit-surface": "share-worker",
    },
  });
}

// The Turnstile loader both no-account forms use: resolves a token, or null if it never came.
const TURNSTILE_JS = `  var tsReady=null;
  function turnstileToken(){
    if(!tsReady){ tsReady=new Promise(function(res){
      var giveUp=setTimeout(function(){res(null);},8000);
      function ready(){ if(window.turnstile&&typeof window.turnstile.render==='function'){clearTimeout(giveUp);res(window.turnstile);return true;} return false; }
      if(ready()) return;
      window.__kleitTurnstileReady=ready;
      var s=document.createElement('script');
      s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__kleitTurnstileReady'; s.async=true;
      s.onload=function(){ var tries=0; (function poll(){ if(ready()) return; if(++tries<40) setTimeout(poll,200); })(); };
      s.onerror=function(){clearTimeout(giveUp);res(null);}; document.head.appendChild(s); }); }
    return tsReady.then(function(t){ if(!t) return null; return new Promise(function(res){ var done=setTimeout(function(){res(null);},8000); var host=document.getElementById('turnstile'); host.innerHTML='';
      try { t.render(host,{sitekey:C.siteKey,appearance:'interaction-only',callback:function(tok){clearTimeout(done);res(tok);},'error-callback':function(){clearTimeout(done);res(null);}}); }
      catch(e){ clearTimeout(done); res(null); } }); });
  }
`;

const TAKEDOWN_SCRIPT = `(function(){
  var C=window.KLEIT_TD; var f=document.getElementById('f'); var msg=document.getElementById('msg'); var busy=false;
  ${TURNSTILE_JS}
  f.addEventListener('submit',function(e){
    e.preventDefault(); if(busy) return;
    var d=new FormData(f); var urls=String(d.get('urls')||'').split(/\\s+/).filter(Boolean);
    var body={kind:C.kind,name:d.get('name'),email:d.get('email'),urls:urls,details:d.get('details')||'',work:d.get('work')||'',signature:d.get('signature')||'',statements:!!d.get('statements')};
    if(!body.name||!body.email||!urls.length||(C.kind==='copyright'&&(!body.work||!body.signature||!body.statements))){ msg.textContent='Please fill in every box with a line under it.'; return; }
    busy=true; msg.textContent='Sending…';
    turnstileToken().then(function(tok){ body.token=tok||undefined;
      return fetch(C.fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:C.anon},body:JSON.stringify(body)}).then(function(r){return r.json();}); })
    .then(function(j){ if(j&&j.ok){ f.hidden=true; document.getElementById('ref').textContent=j.ref; document.getElementById('hours').textContent='We answer within '+j.hours+' hours.'; document.getElementById('done').hidden=false; }
      else { msg.textContent= j&&j.error==='too_many' ? 'That is a lot of requests from one place today. Try again tomorrow, or email us.' : j&&j.error==='bot_check' ? 'The bot check did not pass. Reload and try again.' : 'Something was missing or did not go through. Check the boxes and try again.'; } })
    .catch(function(){ msg.textContent='That did not go through. Try again in a moment.'; })
    .then(function(){ busy=false; });
  });
})();`;

// ---------------------------------------------------------------------------
// Contact (M7.5): one form, no account needed. Posts to the contact-form function with a
// Turnstile token; a signed-in sender's session goes along so moderators see who wrote.
// ---------------------------------------------------------------------------
function contactPage(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const topic = url.searchParams.get("topic") ?? "";
  const version = (url.searchParams.get("v") ?? "").slice(0, 20);
  const config = JSON.stringify({
    fn: `${env.SUPABASE_URL}/functions/v1/contact-form`,
    version,
    anon: env.SUPABASE_ANON_KEY,
    siteKey: env.TURNSTILE_SITE_KEY || TURNSTILE_TEST_SITE_KEY,
  });
  const option = (value: string, label: string) =>
    `<option value="${value}"${topic === value ? " selected" : ""}>${label}</option>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Contact us · Kleit</title>${STYLE}
<style>form{display:flex;flex-direction:column;gap:12px;margin-top:12px}label{display:flex;flex-direction:column;gap:4px;font-size:14px;color:#5f5a52}
input,textarea,select{font:inherit;font-size:16px;padding:10px;border:1px solid #d9d2c6;border-radius:8px;background:#fff;color:#1f1d1a}textarea{min-height:120px}
.note{font-size:14px;color:#5f5a52}.ok{border:1px solid #d9d2c6;border-radius:12px;padding:14px;margin-top:12px}.ref{font-size:22px;font-weight:700}</style></head>
<body><main class="wrap"><a class="mark" href="/welcome">Kleit</a>
<h1>Contact us</h1><p>A question, a bug, something about your account - write it here. No account needed. A person reads every message and answers by email, usually within two days.</p>
<p class="note">Reporting a post or a person? That's quicker from inside the app: the Report button on the thing itself. An intimate image of you, or your work used without permission: <a href="/takedown">remove an intimate image</a> · <a href="/copyright">copyright</a>.</p>
<form id="f" novalidate>
<label>What is it about<select name="topic">${option("question", "A question")}${option("bug", "Something is broken")}${option("account", "My account")}${option("safety", "Safety")}${option("other", "Something else")}</select></label>
<label>Your name<input name="name" maxlength="120" required autocomplete="name"></label>
<label>Your email (where the answer goes)<input name="email" type="email" maxlength="200" required autocomplete="email"></label>
<label>Your message<textarea name="message" maxlength="4000" required></textarea></label>
<div id="turnstile" class="turnstile"></div>
<button class="button" type="submit">Send</button>
<p id="msg" class="note" role="status" aria-live="polite"></p>
</form>
<section id="done" class="ok" hidden><p>Sent. Your reference:</p><p class="ref" id="ref"></p><p class="note">Keep it in case you write again about the same thing. The answer comes to the email you gave.</p></section>
<footer class="wrap foot"><a href="/help">Help</a> · <a href="/settings/legal">Terms</a> · <a href="/settings/legal">Privacy</a></footer>
</main>
<script>window.KLEIT_CT=${config.replace(/</g, "\\u003c")};</script>
<script>${CONTACT_SCRIPT}</script>
</body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
      "x-kleit-surface": "share-worker",
    },
  });
}

const CONTACT_SCRIPT = `(function(){
  var C=window.KLEIT_CT; var f=document.getElementById('f'); var msg=document.getElementById('msg'); var busy=false;
  ${TURNSTILE_JS}
  function sessionToken(){ try { for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(/^sb-.*-auth-token$/.test(k)){ var v=JSON.parse(localStorage.getItem(k)||'null'); if(v&&v.access_token) return v.access_token; } } } catch(e){} return null; }
  f.addEventListener('submit',function(e){
    e.preventDefault(); if(busy) return;
    var d=new FormData(f);
    var client=((C.version?'app '+C.version+' · ':'')+navigator.userAgent).slice(0,300);
    var body={topic:d.get('topic'),name:d.get('name'),email:d.get('email'),message:d.get('message'),client:client};
    if(!body.name||!body.email||!body.message){ msg.textContent='Please fill in every box.'; return; }
    busy=true; msg.textContent='Sending…';
    turnstileToken().then(function(tok){ body.token=tok||undefined;
      var h={'Content-Type':'application/json',apikey:C.anon}; var s=sessionToken(); if(s) h.Authorization='Bearer '+s;
      return fetch(C.fn,{method:'POST',headers:h,body:JSON.stringify(body)}).then(function(r){return r.json();}); })
    .then(function(j){ if(j&&j.ok){ f.hidden=true; document.getElementById('ref').textContent=j.ref; document.getElementById('done').hidden=false; }
      else { msg.textContent= j&&j.error==='too_many' ? 'That is a lot of messages from one place today. Try again tomorrow.' : j&&j.error==='bot_check' ? 'The bot check did not pass. Reload and try again.' : 'Something was missing or did not go through. Check the boxes and try again.'; } })
    .catch(function(){ msg.textContent='That did not go through. Try again in a moment.'; })
    .then(function(){ busy=false; });
  });
})();`;

// How to delete your account (M7.5; the page app stores ask for): the steps, and a way in for
// someone who can't sign in any more.
function deleteAccountPage(): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Delete your account · Kleit</title>${STYLE}
<style>ol{padding-left:20px;line-height:1.6}.note{font-size:14px;color:#5f5a52}</style></head>
<body><main class="wrap"><a class="mark" href="/welcome">Kleit</a>
<h1>Delete your account</h1>
<p>You can delete your Kleit account yourself, from inside the app, in under a minute.</p>
<ol><li>Open Kleit and sign in.</li><li>Go to <strong>You</strong>, then <strong>Settings</strong>, then <strong>Delete account</strong>.</li><li>Read what goes and what stays, then confirm once.</li></ol>
<p>Your account closes straight away and is deleted for good after seven days. If you sign in during those seven days you can undo it with one tap. After that, your sets, closet, pictures, messages and profile are gone and cannot be brought back.</p>
<p class="note">Can't sign in any more? <a href="/contact?topic=account">Write to us</a> from the email address on the account and we'll do it for you.</p>
<p><a class="button" href="/settings/delete">Open Delete account</a></p>
<footer class="wrap foot"><a href="/help">Help</a> · <a href="/settings/legal">Terms</a> · <a href="/settings/legal">Privacy</a></footer>
</main></body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
      "x-kleit-surface": "share-worker",
    },
  });
}

// Search-engine data for a Public set page (spec 8.4 #5: structured data, CreativeWork). Only
// what the page already shows; the JSON goes through esc-free serialisation with "<" escaped.
function structuredData(
  set: SharedSet,
  title: string,
  who: string,
  pageUrl: string,
  preview: string | null,
): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: title,
    url: pageUrl,
    author: { "@type": "Person", name: who },
    ...(set.published_at ? { datePublished: set.published_at } : {}),
    ...(preview ? { image: preview } : {}),
    ...(set.caption ? { description: set.caption } : {}),
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

// The sitemap (spec 8.4 #5): every Public set page, from the database's one question. Empty
// (but well-formed) when indexing is off or the public-links switch is down.
async function sitemap(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const base = `${url.protocol}//${url.host}`;
  let rows: { share_code: string; published_at: string | null }[] = [];
  if (env.INDEXING === "on" && (await publicLinksOpen(env))) {
    try {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/public_set_codes`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_limit: 5000 }),
      });
      if (r.ok) rows = (await r.json()) as typeof rows;
    } catch {
      rows = [];
    }
  }
  const entries = rows
    .filter((r) => CODE.test(r.share_code))
    .map(
      (r) =>
        `<url><loc>${base}/s/${r.share_code}</loc>${r.published_at ? `<lastmod>${esc(r.published_at.slice(0, 10))}</lastmod>` : ""}</url>`,
    )
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-kleit-surface": "share-worker",
    },
  });
}

// /e/<code> is the embed (M9.3; spec 6.6 #5; design pack S110): the same set, drawn to sit
// inside an iframe on somebody's blog. The same one question with the public key, so a set that
// stops being shareable stops embedding at the same moment; the same pieces and Buy links as the
// share page, with the disclosure beside them (spec 8.2 #7); no sign-up card, no header, no
// footer - the host page has its own. It is the only page here that may be framed, and it says
// so itself with `frame-ancestors *`; the page answers to any width the host gives it.
async function embedPage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.pathname.slice(3).replace(/\/+$/, "");
  if (!CODE.test(code)) return notAvailable(404, true);
  let set: SharedSet | null = null;
  try {
    set = await fetchSet(env, code);
  } catch {
    return notAvailable(503, true);
  }
  if (!set) return notAvailable(404, true);
  const base = `${url.protocol}//${url.host}`;
  return new Response(renderEmbed(set, code, base, env), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "frame-ancestors *",
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
      "x-kleit-surface": "share-worker",
    },
  });
}

function renderEmbed(set: SharedSet, code: string, base: string, env: Env): string {
  const title = set.title || "A set on Kleit";
  const who = set.owner.display_name?.trim() || `@${set.owner.username}`;
  const background = /^#[0-9a-fA-F]{6}$/.test(set.layout?.background ?? "")
    ? (set.layout!.background as string)
    : "#F4EFE6";
  const functions = `${env.SUPABASE_URL}/functions/v1`;
  const pageUrl = `${base}/s/${code}`;
  const pieces = set.pieces
    .map((p) => {
      const name = p.title?.trim() || (p.kind === "own" ? `${who}'s own piece` : "A piece");
      const tag = p.kind === "own" ? "OWN" : price(p);
      const img =
        p.pictured && p.kind === "product"
          ? `<img src="${functions}/item-image?item=${p.id}" alt="${esc(name)}" loading="lazy">`
          : `<div class="noimg" aria-hidden="true"></div>`;
      const buy = p.buyable
        ? `<a class="buy" rel="noopener noreferrer" target="_blank" href="${functions}/buy-redirect?item=${p.id}&set=${set.id}&network=direct" aria-label="Buy ${esc(name)} at ${esc(p.store_name ?? "the store")}, opens store site">Buy at ${esc(p.store_name ?? "the store")}</a>`
        : "";
      return `<li class="piece">${img}<div class="meta"><h3>${esc(name)}</h3>${tag ? `<p class="tag">${esc(tag)}</p>` : ""}${buy}</div></li>`;
    })
    .join("");
  const hasBuy = set.pieces.some((p) => p.buyable);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Kleit</title>
<link rel="canonical" href="${esc(pageUrl)}">
${STYLE}${EMBED_STYLE}</head>
<body class="embed">
<main class="embed-wrap">
  <p class="embed-head"><a class="embed-mark" href="${esc(pageUrl)}" target="_top" rel="noopener">Kleit</a> · <span class="embed-title">${esc(title)}</span> <span class="embed-by">by ${esc(who)}${set.remixed_from ? ` · ${esc(set.remixed_from)}` : ""}</span></p>
  ${creativeCanvas(set, functions, background)}
  <section class="canvas" style="background:${background}" aria-label="The set">
    <ul class="pieces">${pieces}</ul>
  </section>
  ${hasBuy ? `<p class="disclosure">We earn a commission from purchases.</p>` : ""}
  <p class="embed-foot"><a href="${esc(pageUrl)}" target="_top" rel="noopener">Open on Kleit</a></p>
</main>
</body></html>`;
}

// On top of the share page's stylesheet: no page margins (the host page has its own), the
// canvas first, everything else a line.
const EMBED_STYLE = `<style>
html,body.embed{margin:0;padding:0;background:transparent}
.embed-wrap{max-width:none;margin:0;padding:0}
.embed-head{margin:0 0 8px;font-size:14px;color:#5f5a52;line-height:1.4}
.embed-mark{font-weight:700;color:#1f1d1a;text-decoration:none}
.embed-title{color:#1f1d1a;font-weight:600}
.embed-foot{margin:8px 0 0;font-size:14px}
.embed-foot a{color:#d9552b;font-weight:600}
.embed .disclosure{margin-top:6px}
</style>`;

function notAvailable(status = 404, framed = false): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Kleit</title>${STYLE}</head>
<body><main class="wrap"><h1>This set isn't available</h1><p>It may have been made private, or the link may have been reset.</p>
<p><a class="button" href="/welcome"${framed ? ' target="_top"' : ""}>Open Kleit</a></p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(framed ? { "content-security-policy": "frame-ancestors *" } : {}),
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
      "x-kleit-surface": "share-worker",
    },
  });
}

function esc(text: string | null | undefined): string {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function price(piece: Piece): string | null {
  if (piece.price_cents == null) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: piece.price_currency ?? "USD",
    }).format(piece.price_cents / 100);
  } catch {
    return `${(piece.price_cents / 100).toFixed(2)} ${piece.price_currency ?? ""}`.trim();
  }
}

function render(set: SharedSet, code: string, base: string, env: Env): string {
  const title = set.title || "A set on Kleit";
  const who = set.owner.display_name?.trim() || `@${set.owner.username}`;
  const description =
    set.caption || `${set.pieces.length} piece${set.pieces.length === 1 ? "" : "s"} by ${who}`;
  const background = /^#[0-9a-fA-F]{6}$/.test(set.layout?.background ?? "")
    ? (set.layout!.background as string)
    : "#F4EFE6";
  const functions = `${env.SUPABASE_URL}/functions/v1`;
  const pageUrl = `${base}/s/${code}`;
  // The chat picture (CL30): a versioned file in the public set-previews bucket, drawn by the
  // set-preview function from the same pieces this page shows.
  const preview = set.preview
    ? `${env.SUPABASE_URL}/storage/v1/object/public/set-previews/${set.preview}`
    : null;

  const pieces = set.pieces
    .map((p) => {
      const name = p.title?.trim() || (p.kind === "own" ? `${who}'s own piece` : "A piece");
      const tag = p.kind === "own" ? "OWN" : price(p);
      const img =
        p.pictured && p.kind === "product"
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
<meta name="robots" content="${indexable(env, set.visibility) ? "index, follow" : "noindex, nofollow"}">
<title>${esc(title)} · Kleit</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Kleit">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
${
  preview
    ? `<meta property="og:image" content="${esc(preview)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="1200">
<meta name="twitter:image" content="${esc(preview)}">`
    : ""
}
<meta name="twitter:card" content="${preview ? "summary_large_image" : "summary"}">
<link rel="canonical" href="${esc(pageUrl)}">
${indexable(env, set.visibility) ? structuredData(set, title, who, pageUrl, preview) : ""}
${STYLE}</head>
<body>
<header class="wrap top"><a class="mark" href="/welcome" aria-label="Kleit">Kleit</a></header>
<main class="wrap">
  <h1>${esc(title)}</h1>
  <p class="by">by ${esc(who)}${set.published_at ? ` · ${new Date(set.published_at).toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}</p>
  ${set.remixed_from ? `<p class="by">${esc(set.remixed_from)}</p>` : ""}
  ${set.caption ? `<p class="caption">${esc(set.caption)}</p>` : ""}
  ${creativeCanvas(set, functions, background)}
  <section class="canvas" style="background:${background}" aria-label="The set">
    <ul class="pieces">${pieces}</ul>
  </section>
  ${hasBuy ? `<p class="disclosure">We earn a commission from purchases.</p>` : ""}
  <section class="card">
    <h2>Send one back</h2>
    <p>Make your own set in about a minute and send it to ${esc(who)}.</p>
    <a class="button" href="/welcome?next=${encodeURIComponent(`/s/${code}`)}">Sign up</a>
  </section>
  ${sources.length ? `<section class="sources"><h2>Sources</h2><ul>${sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></section>` : ""}
</main>
<footer class="wrap foot">
  <a href="/help">Help</a> · <a href="/contact">Contact</a> · <a href="/settings/legal">Terms</a> · <a href="/settings/legal">Privacy</a> · <a href="/copyright">Copyright</a> · <a href="/takedown">Remove an intimate image</a>
</footer>
</body></html>`;
}

// One small stylesheet, inline: the share page is under 1 MB and needs nothing from the app.
// Plain colours here are the page's own, not the app's theme: this page is seen by people who
// never opened the app, in whatever browser, and it must look the same to all of them.
const POLL_STYLE = `<style>
.options{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:12px}
.option{display:grid;grid-template-columns:120px 1fr;gap:12px;background:#fff;border:1px solid #e6e0d6;border-radius:12px;overflow:hidden}
.mini{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:6px;align-content:start}
.mini img,.mini .noimg{width:100%;aspect-ratio:1;object-fit:contain;background:rgba(255,255,255,.6);border-radius:4px;display:block}
.option .meta{padding:10px 10px 10px 0}
.vote{margin-top:8px;padding:10px 16px;border:0;border-radius:999px;background:#d9552b;color:#fff;font-weight:600;font-size:15px;cursor:pointer;min-height:44px}
.vote[disabled]{opacity:.6}
.option.mine h3::after{content:" ✓"}
.bar{height:8px;border-radius:999px;background:#eee7dc;overflow:hidden;margin-top:8px}
.fill{height:100%;width:0;background:#d9552b;border-radius:999px;transition:width .4s}
.pct{margin:4px 0 0;font-size:14px;color:#5f5a52}
.quiet{color:#5f5a52;font-size:13px;margin-top:10px}.quiet a{color:#5f5a52}
.notice{margin:10px 0 0;padding:10px 12px;border:1px solid #e6e0d6;border-radius:8px;background:#fff;font-size:15px}
.turnstile{min-height:0}
</style>`;

// The page's own script: a device id it makes up once and keeps, the invisible bot check, one
// call to cast-vote, and the bars. Plain JS, no build step, under 3 KB.
const POLL_SCRIPT = `
(function(){
  var C=window.KLEIT_POLL, notice=document.getElementById('notice'), before=document.getElementById('before'),
      after=document.getElementById('after'), signup=document.getElementById('signup'), busy=false;
  function say(t){ if(!t){notice.hidden=true;return;} notice.textContent=t; notice.hidden=false; }
  function device(){ try{ var d=localStorage.getItem('kleit_device'); if(!d){ d=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+String(Date.now())).replace(/-/g,''); localStorage.setItem('kleit_device',d);} return d; }catch(e){ return 'nostorage'+String(Date.now())+String(Math.random()).slice(2,10); } }
  function session(){ try{ var raw=localStorage.getItem(C.sessionKey); if(!raw) return null; var s=JSON.parse(raw); return s&&s.access_token?s.access_token:null; }catch(e){ return null; } }
  function post(body){ var h={'Content-Type':'application/json','apikey':C.anonKey}; var tok=session(); if(tok) h['Authorization']='Bearer '+tok;
    return fetch(C.functions+'/cast-vote',{method:'POST',headers:h,body:JSON.stringify(body)}).then(function(r){ return r.json().then(function(j){ j._status=r.status; return j; }); }); }
  function wording(code){ return {
    already_voted:'You already voted from this device. You can change your vote until '+C.closesText+'.',
    too_many_network:'Too many votes from this network right now. Try again later.',
    closed:'This poll has closed.',
    bot_check:"We couldn't confirm you're a person. Try again.",
    blocked:"You can't vote on this poll.",
    not_found:"This poll isn't available.",
    failed:"That didn't go through. Try again in a moment."
  }[code]||"That didn't go through. Try again in a moment."; }
  function show(result){
    var totals=result.totals||[], sum=0; totals.forEach(function(t){ sum+=Number(t.votes)||0; });
    document.querySelectorAll('.option').forEach(function(li){
      var id=li.getAttribute('data-option'), row=totals.filter(function(t){return t.option_id===id;})[0], v=row?Number(row.votes)||0:0,
          pct=sum?Math.round(v/sum*100):0;
      li.classList.toggle('mine', id===result.option_id);
      li.querySelector('.bar').hidden=false; li.querySelector('.fill').style.width=pct+'%';
      var p=li.querySelector('.pct'); p.hidden=false; p.textContent=pct+'%'+(row?' · '+row.raw_votes+(Number(row.raw_votes)===1?' vote':' votes'):'');
      var b=li.querySelector('.vote'); b.textContent=(id===result.option_id)?'Your vote':'Change to this'; b.disabled=C.closed;
    });
    before.hidden=true; after.hidden=false; signup.hidden=false;
  }
  var tsReady=null;
  // The script tag's onload fires before the API is usable - window.turnstile is an empty stub
  // until Cloudflare's own onload callback runs - so wait for render() to exist, not for the tag.
  function turnstileToken(){
    if(!tsReady){ tsReady=new Promise(function(res){
      var giveUp=setTimeout(function(){res(null);},8000);
      function ready(){ if(window.turnstile&&typeof window.turnstile.render==='function'){clearTimeout(giveUp);res(window.turnstile);return true;} return false; }
      if(ready()) return;
      window.__kleitTurnstileReady=ready;
      var s=document.createElement('script');
      s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__kleitTurnstileReady'; s.async=true;
      s.onload=function(){ var tries=0; (function poll(){ if(ready()) return; if(++tries<40) setTimeout(poll,200); })(); };
      s.onerror=function(){clearTimeout(giveUp);res(null);}; document.head.appendChild(s); }); }
    return tsReady.then(function(t){ if(!t) return null; return new Promise(function(res){ var done=setTimeout(function(){res(null);},8000); var host=document.getElementById('turnstile'); host.innerHTML='';
      try { t.render(host,{sitekey:C.siteKey,appearance:'interaction-only',callback:function(tok){clearTimeout(done);res(tok);},'error-callback':function(){clearTimeout(done);res(null);}}); }
      catch(e){ clearTimeout(done); res(null); } }); });
  }
  function vote(optionId, button){
    if(busy) return; busy=true; say(''); var label=button.textContent; button.textContent='…'; button.disabled=true;
    var p=session()?Promise.resolve(null):turnstileToken();
    p.then(function(tok){ return post({code:C.code, option_id:optionId, device_id:device(), token:tok||undefined}); })
     .then(function(j){ if(j.ok){ show(j); } else { say(wording(j.error)); if(j.error==='already_voted'||j.error==='closed'){ return post({code:C.code, device_id:device(), action:'status'}).then(function(s){ if(s.voted) show(s.voted); }); } } })
     .catch(function(){ say(navigator.onLine===false?"You're offline. Your vote didn't go through.":"That didn't go through. Try again in a moment."); })
     .then(function(){ busy=false; button.disabled=C.closed; if(button.textContent==='…') button.textContent=label; });
  }
  document.querySelectorAll('.vote').forEach(function(b){ b.addEventListener('click',function(){ vote(b.getAttribute('data-option'), b); }); if(C.closed) b.disabled=true; });
  if(C.closed) say('This poll has closed.');
  post({code:C.code, device_id:device(), action:'status'}).then(function(s){ if(s&&s.voted) show(s.voted); }).catch(function(){});
})();`;

const STYLE = `<style>
:root{color-scheme:light}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#faf8f4;color:#1f1d1a;line-height:1.4}
.wrap{max-width:640px;margin:0 auto;padding:16px}
.top{padding-bottom:0}.mark{font-weight:700;text-decoration:none;color:#1f1d1a;font-size:20px}
h1{font-size:26px;margin:12px 0 4px}h2{font-size:18px;margin:0 0 6px}h3{font-size:15px;margin:0}
.by,.from,.disclosure,.foot{color:#5f5a52;font-size:14px}.caption{font-size:17px;margin:8px 0 12px}
.canvas{border-radius:12px;padding:12px;margin-top:12px}
.creative{position:relative;width:100%;border-radius:12px;overflow:hidden;margin-top:12px}
.pieces{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.piece{background:rgba(255,255,255,.7);border-radius:8px;overflow:hidden}
.piece img,.noimg{display:block;width:100%;aspect-ratio:1;object-fit:contain;background:#eee7dc}
.meta{padding:8px}.tag{margin:4px 0 0;font-weight:600;font-size:14px}
.buy,.button{display:inline-block;margin-top:8px;padding:10px 14px;border-radius:999px;background:#d9552b;color:#fff;text-decoration:none;font-weight:600;font-size:15px}
.card{margin-top:20px;padding:16px;border:1px solid #e6e0d6;border-radius:12px;background:#fff}
.sources{margin-top:20px}.sources ul{padding-left:18px}
.foot a{color:#5f5a52}
</style>`;
