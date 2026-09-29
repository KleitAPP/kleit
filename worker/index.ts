// Kleit share-page Worker (technical pack §4.1 "set-preview"; spec 8.2–8.4; roadmap M3.3, M3.5).
//
// Only /s/* and /p/* reach this code (wrangler.jsonc: run_worker_first). Everything else is a static
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
// looking. "Send one back" (an account) comes later, on this same page.
//
// /p/<code> is the poll page (M3.7; spec 7.3): the 2–4 sets, a Vote under each, the privacy line
// and "one vote per device" BEFORE the first tap (design pack G11, G13), then the bars and the
// sign-up card (decision 88). The vote itself goes to the `cast-vote` function, never to the
// database; this page only draws.

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  TURNSTILE_SITE_KEY?: string;
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
  set: { id: string; title: string; layout: { background?: string } | null; pieces: PollPiece[] };
};
type SharedPoll = {
  id: string;
  question: string;
  closes_at: string;
  closed: boolean;
  owner: { username: string; display_name: string };
  options: PollOption[];
};

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
    if (url.pathname.startsWith("/p/")) return pollPage(request, env);
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

async function askDatabase<T extends { id: string }>(
  env: Env,
  fn: string,
  code: string,
): Promise<T | null> {
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
<meta name="twitter:card" content="summary">
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
    <a class="button" href="/welcome">Sign up</a>
  </section>
</main>
<footer class="wrap foot">
  <a href="/settings/legal">Terms</a> · <a href="/settings/legal">Privacy</a> · <a href="/settings/legal">Copyright</a>
</footer>
<script>window.KLEIT_POLL=${config.replace(/</g, "\\u003c")};</script>
<script>${POLL_SCRIPT}</script>
</body></html>`;
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
.pieces{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.piece{background:rgba(255,255,255,.7);border-radius:8px;overflow:hidden}
.piece img,.noimg{display:block;width:100%;aspect-ratio:1;object-fit:contain;background:#eee7dc}
.meta{padding:8px}.tag{margin:4px 0 0;font-weight:600;font-size:14px}
.buy,.button{display:inline-block;margin-top:8px;padding:10px 14px;border-radius:999px;background:#d9552b;color:#fff;text-decoration:none;font-weight:600;font-size:15px}
.card{margin-top:20px;padding:16px;border:1px solid #e6e0d6;border-radius:12px;background:#fff}
.sources{margin-top:20px}.sources ul{padding-left:18px}
.foot a{color:#5f5a52}
</style>`;
