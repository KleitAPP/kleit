/**
 * The attacks a signed-in stranger can try, run against the deployed test site on every deploy
 * (WA11: nothing Claude builds is tested until someone attacks it; L23: the real test of
 * anything protective is an attempt, on the live thing).
 *
 * Two throwaway accounts: a VICTIM who owns things, and an ATTACKER who tries to read, change
 * and spoof them. Sessions are minted the way the 6-digit code mints them (see core-loop.mjs).
 * Everything created is soft-deleted or left harmless at the end; nothing is ever destroyed.
 *
 *   KLEIT_TEST_SITE, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
 */
import { createClient } from "@supabase/supabase-js";

const SITE = process.env.KLEIT_TEST_SITE ?? "https://kleit-test.kleitapp-team.workers.dev";
const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error("SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY are required");
  process.exit(2);
}
const FN = `${URL_}/functions/v1`;
const admin = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let n = 0;
let failed = 0;
function check(ok, what, detail = "") {
  n += 1;
  console.log(`${ok ? "ok" : "not ok"} ${n} - ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
}

/** Points a test run gave a test account are taken back in `finally` (the ledger rows first). */
async function takeBackPoints(userId, points) {
  if (points <= 0) return;
  const { data: profile } = await admin
    .from("profiles")
    .select("points")
    .eq("user_id", userId)
    .single();
  await admin
    .from("profiles")
    .update({ points: Math.max(0, (profile?.points ?? 0) - points) })
    .eq("user_id", userId);
}

async function person(email, username, { claim = true } = {}) {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let user = list?.users.find((u) => u.email === email) ?? null;
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw new Error(`createUser: ${error.message}`);
    user = data.user;
  }
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`generateLink: ${error.message}`);
  const client = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: v, error: vErr } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (vErr || !v.session) throw new Error(`verifyOtp: ${vErr?.message ?? "no session"}`);
  const { data: prof } = await client
    .from("profiles")
    .select("username")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!prof && claim) {
    const { error: claimErr } = await client.rpc("claim_profile", {
      p_username: username,
      p_display_name: username,
      p_terms_version: "v0.1",
    });
    if (claimErr) throw new Error(`claim_profile ${username}: ${claimErr.message}`);
  }
  return { id: user.id, client, token: v.session.access_token, username };
}

async function call(fn, token, body, extraHeaders = {}) {
  const r = await fetch(`${FN}/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* not json */
  }
  return { status: r.status, json };
}

const victim = await person("attack-victim@test.kleit", "attackvictim");
const attacker = await person("attack-attacker@test.kleit", "attackattacker");
// A third account wears the moderator role for the length of the run (written with the service
// key - a person can never write user_roles - and removed in `finally`). It is the only way the
// moderator path is exercised at all while nobody human has the role (OW16).
const moderator = await person("attack-reviewer@test.kleit", "attackreviewer");
await admin.from("user_roles").upsert({ user_id: moderator.id, role: "moderator" });
// A second one, because an appeal is decided by a different person than the one who struck or
// blocked (spec 13.4 #4; migration 113).
const second = await person("attack-reviewer2@test.kleit", "attackreviewertwo");
await admin.from("user_roles").upsert({ user_id: second.id, role: "moderator" });
const stamp = new Date().toISOString();
await admin
  .from("sets")
  .update({ deleted_at: stamp })
  .in("owner_id", [victim.id, attacker.id])
  .is("deleted_at", null);
await admin
  .from("polls")
  .update({ deleted_at: stamp })
  .in("owner_id", [victim.id, attacker.id])
  .is("deleted_at", null);

try {
  // ---------------------------------------------------------------------------
  // The victim's things: a public set with a hostile title, a private set, an own item, a poll.
  // ---------------------------------------------------------------------------
  const XSS = `<img src=x onerror="alert(1)"> "'&<script>alert(2)</script>`;
  const { data: pub } = await victim.client
    .from("sets")
    .insert({
      owner_id: victim.id,
      title: XSS,
      status: "draft",
      layout: {
        version: 1,
        template: "",
        background: "#F4EFE6",
        caption: `</p><script>alert(3)</script>`,
      },
    })
    .select("id, share_code")
    .single();
  await victim.client
    .from("sets")
    .update({ status: "published", visibility: "public" })
    .eq("id", pub.id);
  const { data: priv } = await victim.client
    .from("sets")
    .insert({
      owner_id: victim.id,
      title: "private things",
      status: "published",
      visibility: "only_me",
    })
    .select("id, share_code")
    .single();
  const { data: item } = await victim.client
    .from("items")
    .insert({ owner_id: victim.id, kind: "own", title: "victim piece" })
    .select("id")
    .single();
  const { data: pub2 } = await victim.client
    .from("sets")
    .insert({ owner_id: victim.id, title: "second", status: "published", visibility: "public" })
    .select("id")
    .single();
  const { data: poll } = await victim.client
    .from("polls")
    .insert({ owner_id: victim.id, question: "attack poll" })
    .select("id, share_code")
    .single();
  await victim.client.from("poll_options").insert([
    { poll_id: poll.id, set_id: pub.id, label: "a", sort_order: 0 },
    { poll_id: poll.id, set_id: pub2.id, label: "b", sort_order: 1 },
  ]);

  // 1. XSS: the share page escapes what the victim typed.
  const html = await (await fetch(`${SITE}/s/${pub.share_code}`)).text();
  check(
    !html.includes("<img src=x") && !html.includes("<script>alert"),
    "share page: a hostile title and caption are escaped",
    `${html.includes("&lt;img") ? "escaped" : "NOT escaped"}`,
  );
  const pollHtml = await (await fetch(`${SITE}/p/${poll.share_code}`)).text();
  check(
    !pollHtml.includes("<img src=x") && !pollHtml.includes("<script>alert"),
    "poll page: the hostile set title is escaped there too",
  );

  // 2. Reading across accounts.
  const end0 = new Date().toISOString();
  const a = attacker.client;
  const { data: seesPriv } = await a.from("sets").select("id").eq("id", priv.id);
  check((seesPriv ?? []).length === 0, "attacker: cannot read the victim's only-me set");
  const { data: seesPub } = await a.from("sets").select("id").eq("id", pub.id);
  check((seesPub ?? []).length === 1, "attacker: can read the victim's public set (as intended)");
  const { data: seesItem } = await a.from("items").select("id").eq("id", item.id);
  check((seesItem ?? []).length === 0, "attacker: cannot read the victim's own piece");
  const { data: seesCloset } = await a.from("closet_items").select("id").eq("user_id", victim.id);
  check((seesCloset ?? []).length === 0, "attacker: cannot read the victim's closet");
  const votesRead = await a.from("votes").select("id").limit(1);
  check(
    votesRead.error?.code === "42501",
    "attacker: the votes table is refused outright",
    votesRead.error?.code ?? "no error",
  );
  const { data: totalsBefore } = await a
    .from("poll_totals")
    .select("option_id")
    .eq("poll_id", poll.id);
  check((totalsBefore ?? []).length === 0, "attacker: no poll totals before voting");
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const raw = await anon.rpc("set_by_share_code", { p_code: pub.share_code });
  check(
    raw.error?.code === "42501",
    "stranger: the raw-row share function is not callable",
    raw.error?.code ?? "no error",
  );
  const reserved = await anon.from("reserved_usernames").select("username").limit(1);
  check(
    reserved.error?.code === "42501",
    "stranger: the reserved-username list is not readable",
    reserved.error?.code ?? "no error",
  );

  // 3. Writing across accounts.
  const { data: hijack } = await a
    .from("sets")
    .update({ title: "hijacked" })
    .eq("id", pub.id)
    .select("id");
  check((hijack ?? []).length === 0, "attacker: cannot change the victim's set");
  const { data: stillTitle } = await victim.client
    .from("sets")
    .select("title")
    .eq("id", pub.id)
    .single();
  check(stillTitle.title === XSS, "attacker: the victim's title is unchanged");
  const fakeItem = await a
    .from("set_items")
    .insert({ set_id: pub.id, item_id: item.id, position: { slot: 0 } });
  check(!!fakeItem.error, "attacker: cannot put a piece on the victim's set", fakeItem.error?.code);
  const fakeOption = await a
    .from("poll_options")
    .insert({ poll_id: poll.id, set_id: pub.id, label: "x", sort_order: 2 });
  check(
    !!fakeOption.error,
    "attacker: cannot add an option to the victim's poll",
    fakeOption.error?.code,
  );
  const steal = await a.from("sets").insert({ owner_id: victim.id, title: "planted" });
  check(!!steal.error, "attacker: cannot create a set in the victim's name", steal.error?.code);
  const resetOther = await a.rpc("reset_share_code", { p_set_id: pub.id });
  const { data: codeAfter } = await victim.client
    .from("sets")
    .select("share_code")
    .eq("id", pub.id)
    .single();
  check(
    codeAfter.share_code === pub.share_code,
    "attacker: cannot reset the victim's share link",
    resetOther.error?.code ?? String(resetOther.data),
  );
  const reopen = await a.rpc("reopen_poll", { p_poll_id: poll.id });
  check(reopen.data !== true, "attacker: cannot reopen the victim's poll");

  // 4. Functions with another person's ids: the same answer as "does not exist".
  const prevOther = await call("set-preview", attacker.token, { set_id: pub.id });
  check(
    prevOther.status === 404,
    "attacker: set-preview for the victim's set is 404",
    String(prevOther.status),
  );
  const prevNone = await call("set-preview", attacker.token, {
    set_id: "00000000-0000-4000-8000-000000000000",
  });
  check(
    prevNone.status === 404,
    "attacker: set-preview for a made-up set is the same 404",
    String(prevNone.status),
  );
  const scanOther = await call("ingest-image", attacker.token, { itemId: item.id });
  const scanNone = await call("ingest-image", attacker.token, {
    itemId: "00000000-0000-4000-8000-000000000000",
  });
  check(
    scanOther.status === 404 && scanNone.status === 404,
    "attacker: ingest-image cannot tell the victim's item from a made-up one",
    `${scanOther.status}/${scanNone.status}`,
  );
  const imgOwn = await fetch(`${FN}/item-image?item=${item.id}`, { redirect: "manual" });
  check(
    imgOwn.status === 404,
    "stranger: item-image refuses the victim's unshared own piece",
    String(imgOwn.status),
  );

  // 5. Votes: a signed-in stranger votes once, cannot repeat, can change; a network burst is cut.
  const v1 = await call("cast-vote", attacker.token, {
    code: poll.share_code,
    option_id: null,
    device_id: "attackerdevice000001",
    action: "status",
  });
  check(v1.status === 200 && v1.json?.voted === null, "attacker: no vote yet", String(v1.status));
  const { data: options } = await victim.client
    .from("poll_options")
    .select("id")
    .eq("poll_id", poll.id)
    .order("sort_order");
  const [optA, optB] = options.map((o) => o.id);
  const v2 = await call("cast-vote", attacker.token, {
    code: poll.share_code,
    option_id: optA,
    device_id: "attackerdevice000001",
  });
  check(
    v2.status === 200 && v2.json?.ok === true,
    "attacker: a first vote with a session (no Turnstile needed) lands",
    String(v2.status),
  );
  const v3 = await call("cast-vote", attacker.token, {
    code: poll.share_code,
    option_id: optA,
    device_id: "attackerdevice000001",
  });
  check(
    v3.status === 409 && v3.json?.error === "already_voted",
    "attacker: the same vote again is refused",
    `${v3.status} ${v3.json?.error}`,
  );
  const v4 = await call("cast-vote", attacker.token, {
    code: poll.share_code,
    option_id: optA,
    device_id: "attackerdevice000002",
  });
  check(
    v4.status === 409 && v4.json?.error === "already_voted",
    "attacker: a new device id does not buy a second vote for an account",
    `${v4.status} ${v4.json?.error}`,
  );
  const v5 = await call("cast-vote", attacker.token, {
    code: poll.share_code,
    option_id: optB,
    device_id: "attackerdevice000001",
  });
  check(
    v5.status === 200 && v5.json?.changed === true,
    "attacker: changing the vote is allowed",
    String(v5.status),
  );
  const { data: totalsAfter } = await a
    .from("poll_totals")
    .select("option_id, raw_votes")
    .eq("poll_id", poll.id);
  check(
    (totalsAfter ?? []).length === 2 && totalsAfter.reduce((s, t) => s + t.raw_votes, 0) === 1,
    "attacker: sees totals after voting, and they count one vote",
  );
  const noToken = await call("cast-vote", null, {
    code: poll.share_code,
    option_id: optA,
    device_id: "guestdevice0000000001",
  });
  check(
    noToken.status === 403 && noToken.json?.error === "bot_check",
    "guest: no Turnstile token is refused",
    `${noToken.status} ${noToken.json?.error}`,
  );
  let burstRefusedAt = 0;
  for (let i = 1; i <= 22; i++) {
    const r = await call("cast-vote", null, {
      code: poll.share_code,
      option_id: optA,
      device_id: `burstdevice000000${String(i).padStart(4, "0")}`,
      token: "test-key-accepts-anything",
    });
    if (r.status === 429 && r.json?.error === "too_many_network") {
      burstRefusedAt = i;
      break;
    }
    if (r.status !== 200) {
      burstRefusedAt = -r.status;
      break;
    }
  }
  // The attacker's own vote came from this same network, so it counts: 1 + 19 guests = 20, and
  // the twentieth guest is the one refused.
  check(
    burstRefusedAt === 20,
    "guest: the twentieth vote from one network in an hour is refused",
    `refused at ${burstRefusedAt}`,
  );
  const { data: weights } = await admin
    .from("votes")
    .select("weight")
    .eq("poll_id", poll.id)
    .eq("weight", 0.5);
  check(
    (weights ?? []).length === 15,
    "guest: past five, the burst's votes weigh half",
    `${(weights ?? []).length} half-weight`,
  );

  // 6. Impersonation and the signed-out profile door.
  const brand = await a.rpc("username_status", { candidate: "kleit_official" });
  check(brand.data === "reserved", "attacker: @kleit_official is refused", String(brand.data));
  const profilePage = await fetch(`${SITE}/u/${victim.username}`, { redirect: "manual" });
  const profileHtml = await profilePage.text();
  check(
    profilePage.status === 200 && !profileHtml.includes("attackvictim"),
    "stranger: /u/<name> serves only the app shell; nothing about the person is in it",
    String(profilePage.status),
  );

  // 7. Share codes: a wrong code, the private set's code and a draft all give one 404.
  const wrong = await fetch(`${SITE}/s/0000000000000000`);
  const privPage = await fetch(`${SITE}/s/${priv.share_code}`);
  const wrongText = await wrong.text();
  const privText = await privPage.text();
  check(
    wrong.status === 404 && privPage.status === 404 && wrongText === privText,
    "stranger: a private set's code and a wrong code are the same page",
    `${wrong.status}/${privPage.status}`,
  );
  // The embed (M9.3) answers the same questions the same way, and only it may be framed.
  const embed = await fetch(`${SITE}/e/${pub.share_code}`);
  const embedHtml = await embed.text();
  const embedPriv = await fetch(`${SITE}/e/${priv.share_code}`);
  check(
    embed.status === 200 &&
      (embed.headers.get("content-security-policy") ?? "").includes("frame-ancestors *") &&
      /noindex/.test(embed.headers.get("x-robots-tag") ?? "") &&
      /Open on Kleit/.test(embedHtml) &&
      !/Sign up/.test(embedHtml),
    "stranger: the public set embeds (framable, noindex, no sign-up card)",
    `${embed.status} csp=${embed.headers.get("content-security-policy")}`,
  );
  check(
    embedPriv.status === 404 && !/attackvictim/.test(await embedPriv.text()),
    "stranger: the private set's embed is the same not-available page",
    String(embedPriv.status),
  );
  // 7b. The brand mini editor (M9.2): a store's page lists its cleared store pieces and nothing
  //     else - not a clip still being checked, not a person's own piece, not who clipped what.
  //     The rows are the victim's, written by the server (the guard lets no member write a
  //     store piece by hand); they go in `finally`.
  const brandDomain = "attack-brand.kleit.example";
  const { data: brandRows, error: brandSeedError } = await admin
    .from("items")
    .insert([
      {
        owner_id: victim.id,
        kind: "product",
        title: `attack brand cleared (ignore) ${XSS}`,
        price_cents: 1200,
        price_currency: "USD",
        source_url: `https://${brandDomain}/coat`,
        source_domain: brandDomain,
        image_id: `${victim.id}/attack-brand-ignore.jpg`,
        image_bucket: "item-images",
      },
      {
        owner_id: victim.id,
        kind: "product",
        title: "attack brand pending (ignore)",
        price_cents: 1200,
        price_currency: "USD",
        source_url: `https://${brandDomain}/pending`,
        source_domain: brandDomain,
        image_id: `${victim.id}/attack-brand-ignore-2.jpg`,
        image_bucket: "item-images",
      },
    ])
    .select("id, kind, title");
  // On its own: a bulk insert through the API wants every row shaped the same.
  const { data: brandOwnRow } = await admin
    .from("items")
    .insert({
      owner_id: victim.id,
      kind: "own",
      title: "attack brand own (ignore)",
      source_domain: brandDomain,
    })
    .select("id")
    .single();
  const brandCleared = (brandRows ?? []).find((r) => /cleared/.test(r.title));
  const brandPending = (brandRows ?? []).find((r) => /pending/.test(r.title));
  const brandOwn = brandOwnRow ?? undefined;
  const brandStamp = new Date().toISOString();
  await admin.from("item_flags").upsert([
    { item_id: brandCleared?.id, scan_state: "clean", scanned_at: brandStamp },
    // A cleared own piece: still never a store's.
    { item_id: brandOwn?.id, scan_state: "clean", scanned_at: brandStamp },
  ]);
  const brandPage = await fetch(`${SITE}/e/brand/${brandDomain}`);
  const brandHtml = await brandPage.text();
  const brandCsp = brandPage.headers.get("content-security-policy") ?? "";
  check(
    brandPage.status === 200 &&
      !!brandCleared &&
      brandHtml.includes(brandCleared.id) &&
      !brandHtml.includes(brandPending?.id ?? "-") &&
      !brandHtml.includes(brandOwn?.id ?? "-"),
    "stranger: a brand's page lists the cleared store piece, not the clip still being checked nor a person's own piece",
    brandSeedError
      ? `seed failed: ${brandSeedError.message}`
      : `${brandPage.status} cleared=${brandHtml.includes(brandCleared?.id ?? "-")} pending=${brandHtml.includes(brandPending?.id ?? "-")} own=${brandHtml.includes(brandOwn?.id ?? "-")}`,
  );
  check(
    !brandHtml.includes("attackvictim") &&
      !brandHtml.includes(victim.id) &&
      !brandHtml.includes("<img src=x") &&
      !brandHtml.includes("<script>alert"),
    "stranger: the brand page names nobody and writes the piece's title as text",
  );
  check(
    brandCsp.includes("frame-ancestors *") &&
      /script-src 'nonce-[A-Za-z0-9+/=]+';/.test(brandCsp) &&
      !brandCsp.includes("challenges.cloudflare.com") &&
      /noindex/.test(brandPage.headers.get("x-robots-tag") ?? "") &&
      (brandHtml.match(/<script nonce="/g) ?? []).length === 2 &&
      !/<script>/.test(brandHtml),
    "stranger: the brand page may be framed, runs only its own two scripts, and is not indexed",
    brandCsp.slice(0, 100),
  );
  const brandBad = await fetch(`${SITE}/e/brand/attackvictim`);
  const brandNone = await fetch(`${SITE}/e/brand/nobody-${Date.now()}.example`);
  const brandNoneHtml = await brandNone.text();
  check(
    brandBad.status === 404 &&
      brandNone.status === 200 &&
      /No pieces from/.test(brandNoneHtml) &&
      !/<script/.test(brandNoneHtml),
    "stranger: a store name with no dot is 404; a store nobody clipped from is an empty page with no script",
    `${brandBad.status}/${brandNone.status}`,
  );
  const { data: doorAnon } = await anon.rpc("brand_pieces", { p_domain: brandDomain });
  const doorPiece = doorAnon?.pieces?.[0] ?? {};
  check(
    Array.isArray(doorAnon?.pieces) &&
      doorAnon.pieces.length === 1 &&
      doorPiece.id === brandCleared?.id &&
      Object.keys(doorPiece).sort().join() === "id,price_cents,price_currency,title",
    "stranger: the door itself answers the one cleared piece, with its id, title and price and nothing else",
    Object.keys(doorPiece).sort().join(),
  );
  // Keep it writes through the signed-in person's own rows: a cleared store piece may come
  // along, a clip still being checked or a stranger's own piece never - whatever the link says.
  const { data: keepDraft } = await a
    .from("sets")
    .insert({ owner_id: attacker.id, title: "attack keep (ignore)", status: "draft" })
    .select("id")
    .single();
  const keepPending = await a
    .from("set_items")
    .insert({ set_id: keepDraft?.id, item_id: brandPending?.id, position: { slot: 0 } });
  const keepOwn = await a
    .from("set_items")
    .insert({ set_id: keepDraft?.id, item_id: brandOwn?.id, position: { slot: 1 } });
  const keepCleared = await a
    .from("set_items")
    .insert({ set_id: keepDraft?.id, item_id: brandCleared?.id, position: { slot: 2 } });
  check(
    keepPending.error?.code === "42501" && keepOwn.error?.code === "42501" && !keepCleared.error,
    "attacker: a kept look can carry the cleared store piece, never the pending clip or the victim's own piece",
    `${keepPending.error?.code ?? "written"} / ${keepOwn.error?.code ?? "written"} / ${keepCleared.error?.code ?? "ok"}`,
  );
  // 7d. The catalogue's facts (migration 102): a colour is one of sixteen words and only the
  //     owner names it; "sold out" is the server's; the colour filter is a plain equality; a
  //     point for the clipper comes only from the trigger, when somebody else publishes.
  const recolourOther = await a
    .from("items")
    .update({ color_name: "red" })
    .eq("id", brandCleared?.id)
    .select("id");
  const { data: brandAfterOther } = await admin
    .from("items")
    .select("color_name")
    .eq("id", brandCleared?.id)
    .maybeSingle();
  check(
    (recolourOther.data ?? []).length === 0 && brandAfterOther?.color_name === null,
    "attacker: cannot name the colour of the victim's clip",
    recolourOther.error?.code ?? "no rows",
  );
  const soldOutOwn = await victim.client
    .from("items")
    .update({ sold_out: true })
    .eq("id", brandCleared?.id);
  const strangeColour = await victim.client
    .from("items")
    .update({ color_name: "ultramarine" })
    .eq("id", brandCleared?.id);
  const realColour = await victim.client
    .from("items")
    .update({ color_name: "red" })
    .eq("id", brandCleared?.id)
    .select("id");
  check(
    soldOutOwn.error?.code === "42501" &&
      strangeColour.error?.code === "23514" &&
      !realColour.error &&
      (realColour.data ?? []).length === 1,
    "victim: cannot mark their own clip sold out (the watch does), cannot name a colour outside the sixteen, can name it red",
    `${soldOutOwn.error?.code ?? "written"} / ${strangeColour.error?.code ?? "written"} / ${realColour.error?.code ?? "ok"}`,
  );
  const byRed = await a.rpc("search_items", { q: "attack brand", p_colour: "red" });
  const byBlue = await a.rpc("search_items", { q: "attack brand", p_colour: "blue" });
  const byOdd = await a.rpc("search_items", { q: "attack brand", p_colour: "red' or 1=1 --" });
  check(
    (byRed.data ?? []).some((r) => r.id === brandCleared?.id) &&
      !(byBlue.data ?? []).some((r) => r.id === brandCleared?.id) &&
      !byOdd.error &&
      (byOdd.data ?? []).length === 0,
    "attacker: the colour filter finds the red piece, not under blue, and an odd word is a word that matches nothing",
    `${byRed.error?.message ?? (byRed.data ?? []).length} / ${byBlue.error?.message ?? (byBlue.data ?? []).length} / ${byOdd.error?.message ?? (byOdd.data ?? []).length}`,
  );
  const fakePoint = await a
    .from("points_ledger")
    .insert({ user_id: attacker.id, points: 100, reason: "clip_used", ref: "x" });
  check(
    fakePoint.error?.code === "42501",
    "attacker: cannot write a clip point into the ledger",
    fakePoint.error?.code,
  );
  // The point itself: the attacker publishes the kept look (the victim's cleared clip is on it).
  const { data: victimPointsBefore } = await admin
    .from("profiles")
    .select("points")
    .eq("user_id", victim.id)
    .single();
  const publishKept = await a
    .from("sets")
    .update({ status: "published", visibility: "public" })
    .eq("id", keepDraft?.id)
    .select("id");
  const { data: victimPointsAfter } = await admin
    .from("profiles")
    .select("points")
    .eq("user_id", victim.id)
    .single();
  check(
    !publishKept.error &&
      (publishKept.data ?? []).length === 1 &&
      (victimPointsAfter?.points ?? 0) === (victimPointsBefore?.points ?? 0) + 1,
    "victim: earns one point when the attacker publishes a set with the victim's clip on it",
    `${victimPointsBefore?.points ?? "?"} → ${victimPointsAfter?.points ?? "?"}${publishKept.error ? ` (${publishKept.error.code})` : ""}`,
  );

  // 7c. Build around this piece (migration 100): the lock takes a cleared store piece only, and
  //     an answer must carry it. The attacker asks; the victim answers.
  const lockOwn = await a
    .from("ask_posts")
    .insert({ author_id: attacker.id, question: "attack build-around (ignore)", item_id: item.id });
  const lockPending = await a.from("ask_posts").insert({
    author_id: attacker.id,
    question: "attack build-around (ignore)",
    item_id: brandPending?.id,
  });
  const { data: lockOk, error: lockErr } = await a
    .from("ask_posts")
    .insert({
      author_id: attacker.id,
      question: "attack build-around (ignore)",
      item_id: brandCleared?.id,
    })
    .select("id")
    .single();
  check(
    lockOwn.error?.code === "42501" && lockPending.error?.code === "42501" && !lockErr && !!lockOk,
    "attacker: a build-around locks a cleared store piece, never the victim's own piece or a pending clip",
    `${lockOwn.error?.code ?? "written"} / ${lockPending.error?.code ?? "written"} / ${lockErr?.code ?? "ok"}`,
  );
  const moveLock = await a
    .from("ask_posts")
    .update({ item_id: null })
    .eq("id", lockOk?.id ?? "")
    .select("item_id");
  check(
    !!moveLock.error || (moveLock.data ?? []).length === 0,
    "attacker: the lock cannot be moved or cleared once asked",
    moveLock.error?.code ?? `${(moveLock.data ?? []).length} row(s)`,
  );
  await victim.client
    .from("set_items")
    .insert({ set_id: pub2.id, item_id: brandCleared?.id, position: { slot: 3 } });
  const answerWithout = await victim.client
    .from("ask_answers")
    .insert({ ask_id: lockOk?.id, author_id: victim.id, set_id: pub.id });
  const answerWith = await victim.client
    .from("ask_answers")
    .insert({ ask_id: lockOk?.id, author_id: victim.id, set_id: pub2.id });
  check(
    answerWithout.error?.code === "42501" && !answerWith.error,
    "victim: answers a build-around only with a set that has the piece on it",
    `${answerWithout.error?.code ?? "written"} / ${answerWith.error?.code ?? "ok"}`,
  );
  await admin
    .from("set_items")
    .delete()
    .eq("set_id", pub2.id)
    .eq("item_id", brandCleared?.id ?? "");
  const sharePage = await fetch(`${SITE}/s/${pub.share_code}`);
  const shareCsp = sharePage.headers.get("content-security-policy") ?? "";
  check(
    shareCsp.includes("frame-ancestors 'none'") && shareCsp.includes("script-src 'none'"),
    "stranger: the share page refuses framing and runs no script at all",
    shareCsp.slice(0, 80),
  );
  const pollHead = await fetch(`${SITE}/p/${poll.share_code}`);
  const pollCsp = pollHead.headers.get("content-security-policy") ?? "";
  check(
    /script-src 'nonce-[A-Za-z0-9+/=]+' https:\/\/challenges\.cloudflare\.com/.test(pollCsp) &&
      pollCsp.includes("frame-ancestors 'none'"),
    "stranger: the poll page's scripts are its own (a nonce) and Turnstile's, nothing else",
    pollCsp.slice(0, 80),
  );
  // The two forms run their own scripts the same way (the contact page once shipped a nonce in
  // its tags and a policy without it - a form with no script posts nothing).
  const formPaths = [
    "/contact",
    "/takedown",
    "/copyright",
    "/impersonation",
    "/trademark",
    "/counter-notice",
  ];
  const formPages = await Promise.all(formPaths.map((path) => fetch(`${SITE}${path}`)));
  const formTitles = await Promise.all(
    formPages.map(async (r) => (await r.text()).match(/<title>([^<]*)/)?.[1] ?? ""),
  );
  check(
    formPages.every((r) =>
      /script-src 'nonce-[A-Za-z0-9+/=]+' https:\/\/challenges\.cloudflare\.com/.test(
        r.headers.get("content-security-policy") ?? "",
      ),
    ),
    "stranger: the contact, claim and counter-notice pages' scripts are their own and Turnstile's",
    formPages.map((r) => r.status).join("/"),
  );
  // Each of them is the Worker's own page, not the app shell the assets' SPA fallback serves
  // for a path the Worker is not told to answer first (2026-10-19: the two newest claim forms
  // were missing from wrangler's list and the live site showed the shell in their place).
  check(
    formTitles[0]?.startsWith("Contact us") &&
      formTitles[1]?.startsWith("Remove an intimate image") &&
      formTitles[2]?.startsWith("Report a copyright problem") &&
      formTitles[3]?.startsWith("Report an account pretending") &&
      formTitles[4]?.startsWith("Report a trademark problem") &&
      formTitles[5]?.startsWith("Send a counter-notice"),
    "stranger: every form page is the Worker's own, not the app shell",
    formTitles.join(" | ").slice(0, 160),
  );
  // The six legal pages (spec 19 #4) are the Worker's own too - the stores need a public privacy
  // policy, and until 2026-10-19 every footer sent a visitor to a screen inside the app that
  // bounced them to /welcome - and they carry no script at all.
  const legalPaths = [
    "/terms",
    "/privacy",
    "/guidelines",
    "/copyright-policy",
    "/cookies",
    "/accessibility",
  ];
  const legalPages = await Promise.all(legalPaths.map((path) => fetch(`${SITE}${path}`)));
  const legalTitles = await Promise.all(
    legalPages.map(async (r) => (await r.text()).match(/<title>([^<]*)/)?.[1] ?? ""),
  );
  check(
    legalTitles.every((title) =>
      /^Kleit (Terms|Privacy|Community|Copyright|Cookie|Accessibility)/.test(title),
    ) &&
      legalPages.every((r) =>
        /script-src 'none'/.test(r.headers.get("content-security-policy") ?? ""),
      ),
    "stranger: the six legal pages are the Worker's own and run no script",
    legalTitles.join(" | ").slice(0, 200),
  );
  // A layout is JSON the owner writes; a quote inside a "number" closed the style attribute it
  // was written into (the server-code review, 2026-10-12). The victim's own Creative set
  // carries the payload; the page must draw it as a number or not at all.
  const { data: creative } = await victim.client
    .from("sets")
    .insert({
      owner_id: victim.id,
      title: "attack layout (ignore)",
      status: "published",
      visibility: "public",
      layout: {
        version: 2,
        canvas: { w: '1080"><script>alert(4)</script>', h: 1350 },
        background: "#F4EFE6",
        order: ["t1", 42, null],
        texts: {
          t1: {
            kind: "text",
            x: 10,
            y: 10,
            w: 400,
            h: 100,
            rotation: '0deg)"><script>alert(5)</script><i x="',
            opacity: "1;background:url(https://evil.example/x)",
            text: {
              text: "words",
              font: "pacifico",
              size: 48,
              colour: "red;background:url(https://evil.example/y)",
              align: 'left"><script>alert(6)</script>',
            },
          },
        },
      },
    })
    .select("id, share_code")
    .single();
  const layoutPage = creative ? await (await fetch(`${SITE}/s/${creative.share_code}`)).text() : "";
  check(
    !!creative &&
      !layoutPage.includes("<script>alert") &&
      !layoutPage.includes("evil.example") &&
      layoutPage.includes("rotate(0deg)"),
    "stranger: a hostile layout draws as numbers, never as markup or a beacon",
    creative ? (layoutPage.includes("<script>alert") ? "SCRIPT IN PAGE" : "clean") : "no set",
  );

  // ---------------------------------------------------------------------------
  // 7. Templates (M4.5): a private one is nobody else's; a published one is readable but not
  //    editable; nothing can be made in the victim's name.
  // ---------------------------------------------------------------------------
  const { data: tplPriv } = await victim.client
    .from("templates")
    .insert({
      owner_id: victim.id,
      name: `<b>x</b> private`,
      kind: "slot",
      is_public: false,
      layout: {
        version: 2,
        canvas: { w: 1080, h: 1350, shape: "portrait" },
        background: "#F4EFE6",
        slots: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }],
        order: [],
      },
    })
    .select("id")
    .single();
  const { data: tplPub } = await victim.client
    .from("templates")
    .insert({
      owner_id: victim.id,
      name: "attack-test template (ignore)",
      kind: "slot",
      is_public: true,
      layout: {
        version: 2,
        canvas: { w: 1080, h: 1350, shape: "portrait" },
        background: "#F4EFE6",
        slots: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }],
        order: [],
      },
    })
    .select("id")
    .single();
  const { data: seesTplPriv } = await a.from("templates").select("id").eq("id", tplPriv.id);
  check((seesTplPriv ?? []).length === 0, "attacker: cannot read the victim's private template");
  const { data: seesTplPub } = await a.from("templates").select("id").eq("id", tplPub.id);
  check(
    (seesTplPub ?? []).length === 1,
    "attacker: can read the victim's published template (as intended)",
  );
  const { data: tplHijack } = await a
    .from("templates")
    .update({ name: "hijacked", is_public: false })
    .eq("id", tplPub.id)
    .select("id");
  check((tplHijack ?? []).length === 0, "attacker: cannot change the victim's template");
  const { data: tplGone } = await a.from("templates").delete().eq("id", tplPub.id).select("id");
  check((tplGone ?? []).length === 0, "attacker: cannot delete it");
  const tplSteal = await a
    .from("templates")
    .insert({ owner_id: victim.id, name: "planted", kind: "slot", layout: {} });
  check(
    !!tplSteal.error,
    "attacker: cannot make a template in the victim's name",
    tplSteal.error?.code,
  );

  // ---------------------------------------------------------------------------
  // 8. The social milestone (M5): notifications are the owner's alone; a private set takes no
  //    comment or like from a stranger; a message across the victim's "no one" setting is
  //    refused; a follow request cannot be forged or approved by the wrong person.
  // ---------------------------------------------------------------------------
  const { data: notes } = await a.from("notifications").select("id").eq("user_id", victim.id);
  check((notes ?? []).length === 0, "attacker: cannot read the victim's notifications");
  const plant = await a
    .from("notifications")
    .insert({ user_id: victim.id, kind: "like", actor_id: attacker.id });
  check(!!plant.error, "attacker: cannot plant a notification", plant.error?.code);
  const privComment = await a
    .from("comments")
    .insert({ set_id: priv.id, author_id: attacker.id, body: "hello?" });
  check(
    !!privComment.error,
    "attacker: cannot comment on the victim's only-me set",
    privComment.error?.code,
  );
  // Text screening (migration 062): a phone number is refused outright; an eating-disorder
  // phrase is saved for its author only, and the set's owner never sees it.
  const phoneComment = await a
    .from("comments")
    .insert({ set_id: pub.id, author_id: attacker.id, body: "text me 555-123-4567" });
  check(
    phoneComment.error?.code === "P0006",
    "attacker: a phone number in a comment is refused",
    phoneComment.error?.code ?? "no error",
  );
  const heldComment = await a
    .from("comments")
    .insert({ set_id: pub.id, author_id: attacker.id, body: "attack-test thinspo (ignore)" })
    .select("id, held_at")
    .single();
  check(
    !!heldComment.data?.held_at,
    "attacker: a risky comment is saved as held",
    heldComment.error?.code,
  );
  const ownerSees = await victim.client
    .from("comments")
    .select("id")
    .eq("id", heldComment.data?.id ?? "00000000-0000-4000-8000-000000000000");
  check(
    (ownerSees.data ?? []).length === 0,
    "victim: does not see the held comment on their own set",
  );
  const privLike = await a.from("likes").insert({ user_id: attacker.id, set_id: priv.id });
  check(!!privLike.error, "attacker: cannot like the victim's only-me set", privLike.error?.code);
  await victim.client.from("profiles").update({ dm_setting: "nobody" }).eq("user_id", victim.id);
  const dm = await a.rpc("send_message", { p_to: victim.id, p_body: "psst" });
  check(!!dm.error, "attacker: a message to someone set to 'No one' is refused", dm.error?.code);
  await victim.client.from("profiles").update({ dm_setting: "followers" }).eq("user_id", victim.id);
  const forgedReq = await a
    .from("follow_requests")
    .insert({ requester_id: victim.id, target_id: attacker.id });
  check(
    !!forgedReq.error,
    "attacker: cannot forge a follow request in the victim's name",
    forgedReq.error?.code,
  );
  const { data: approved } = await a.rpc("approve_follow_request", { p_requester: victim.id });
  check(approved !== true, "attacker: cannot approve a request that was never made");

  // ---------------------------------------------------------------------------
  // 9. Discovery (M6): a search and the feeds, as the attacker, never show the victim's only-me
  //    set; a follow fills the following feed; a mute empties it; a block empties everything.
  // ---------------------------------------------------------------------------
  const found = await a.rpc("search_sets", { q: "second" });
  const foundIds = (found.data ?? []).map((s) => s.id);
  check(
    foundIds.includes(pub2.id) && !foundIds.includes(priv.id),
    "attacker: search finds the public set and never the only-me one",
    found.error?.message,
  );
  const foundPriv = await a.rpc("search_sets", { q: "private" });
  check(
    !(foundPriv.data ?? []).some((s) => s.id === priv.id),
    "attacker: searching the only-me set's own words finds nothing",
  );
  const follow = await a
    .from("follows")
    .insert({ follower_id: attacker.id, followee_id: victim.id });
  check(!follow.error, "attacker: can follow a public account", follow.error?.code);
  const feed1 = await a.rpc("feed_following", {});
  const feed1Ids = (feed1.data ?? []).map((s) => s.id);
  check(
    feed1Ids.includes(pub.id) && feed1Ids.includes(pub2.id) && !feed1Ids.includes(priv.id),
    "attacker: the following feed has the public set, not the only-me one",
    feed1.error?.message,
  );

  // Photos in messages (migration 059/060): the victim (followed by the attacker, so the message
  // is not a request) sends one; the attacker may read the file only once the scan has cleared
  // it, and a stranger with no session never can. The "file" is a tiny JPEG written with the
  // service key; its row is deleted in `finally` with the victim's other items.
  const photoPath = `${victim.id}/messages/attack-test-photo-ignore.jpg`;
  const jpegBytes = Uint8Array.from(
    atob(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
    ),
    (c) => c.charCodeAt(0),
  );
  // Storage's 429s (WA22) hit uploads too: without this the read below was blamed for an object
  // that was never written ("Object not found", 2026-10-19).
  let photoUp = await admin.storage
    .from("closet-photos")
    .upload(photoPath, jpegBytes, { contentType: "image/jpeg", upsert: true });
  for (let n = 0; photoUp.error && n < 5; n++) {
    await new Promise((r) => setTimeout(r, 3000));
    photoUp = await admin.storage
      .from("closet-photos")
      .upload(photoPath, jpegBytes, { contentType: "image/jpeg", upsert: true });
  }
  check(!photoUp.error, "setup: the message photo's file is in the bucket", photoUp.error?.message);
  const { data: photoItem } = await admin
    .from("items")
    .insert({
      owner_id: victim.id,
      kind: "own",
      title: "attack-test message photo (ignore)",
      image_bucket: "closet-photos",
      image_id: photoPath,
    })
    .select("id")
    .single();
  // The attacker's setting is "followers": the victim must follow them to write at all, and the
  // attacker already follows the victim, so the conversation opens as a normal one.
  await victim.client.from("follows").insert({ follower_id: victim.id, followee_id: attacker.id });
  const sentPhoto = await victim.client.rpc("send_message", {
    p_to: attacker.id,
    p_body: "",
    p_photo: photoItem?.id,
  });
  check(
    !sentPhoto.error,
    "victim: sends a photo with no words to a follower",
    sentPhoto.error?.code,
  );
  const readUnscanned = await a.storage.from("closet-photos").createSignedUrl(photoPath, 60);
  check(
    !readUnscanned.data?.signedUrl,
    "attacker: cannot read the photo's file before the scan has cleared it",
  );
  await admin
    .from("item_flags")
    .upsert({ item_id: photoItem?.id, scan_state: "clean", scanned_at: new Date().toISOString() });
  // Storage answers 429 "Too many connections" now and then (WA22), and once a bare "Internal
  // Server Error" (2026-10-19): wait any Storage error out, as the core loop does.
  let readCleared = await a.storage.from("closet-photos").createSignedUrl(photoPath, 60);
  for (let n = 0; readCleared.error && n < 5; n++) {
    await new Promise((r) => setTimeout(r, 3000));
    readCleared = await a.storage.from("closet-photos").createSignedUrl(photoPath, 60);
  }
  check(
    !!readCleared.data?.signedUrl,
    "attacker: can read it once the scan has cleared it",
    readCleared.error?.message,
  );

  // 7e. The scanner's "review" verdict (spec 13.1 #3; migration 113): the photo is listed for a
  // moderator, nobody else; blocked by the first moderator; appealed by its owner, once; the
  // first moderator cannot decide that appeal; the second allows it and the flag clears.
  await admin.from("item_flags").upsert({
    item_id: photoItem?.id,
    scan_state: "review",
    scanned_at: new Date().toISOString(),
    labels: { because: ["attack test"] },
  });
  const scanAsAttacker = await a.rpc("scan_review_queue", {});
  check(
    (scanAsAttacker.data ?? []).length === 0,
    "attacker: sees nothing in the scan review",
    String((scanAsAttacker.data ?? []).length),
  );
  const scanQueue = await moderator.client.rpc("scan_review_queue", {});
  check(
    (scanQueue.data ?? []).some((r) => r.item_id === photoItem?.id),
    "moderator: the review photo is in the scan review",
    scanQueue.error?.code,
  );
  const scanBlocked = await moderator.client.rpc("scan_decide", {
    p_item: photoItem?.id,
    p_outcome: "blocked",
    p_note: "attack test (ignore)",
  });
  check(!scanBlocked.error, "moderator: blocks it", scanBlocked.error?.code);
  const strangerAppeal = await a
    .from("appeals")
    .insert({ item_id: photoItem?.id, user_id: attacker.id, body: "not mine" });
  check(
    !!strangerAppeal.error,
    "attacker: cannot appeal somebody else's photo",
    strangerAppeal.error?.code,
  );
  const photoAppeal = await victim.client
    .from("appeals")
    .insert({ item_id: photoItem?.id, user_id: victim.id, body: "attack test appeal (ignore)" })
    .select("id")
    .single();
  check(!photoAppeal.error, "victim: appeals the blocked photo", photoAppeal.error?.code);
  // The moderator-only picture door logs each view (spec 13.4 #9), refuses everyone else, and
  // answers only while the reason is true - here, while the appeal is open.
  const peek = await a.functions.invoke(`mod-image?item=${photoItem?.id}&why=appeal`, {
    method: "GET",
  });
  check(
    !!peek.error,
    "attacker: the moderator picture door is shut",
    peek.error ? "refused" : "opened",
  );
  const look = await moderator.client.functions.invoke(
    `mod-image?item=${photoItem?.id}&why=appeal`,
    {
      method: "GET",
    },
  );
  check(!!look.data?.url, "moderator: opens the picture through the door", look.error?.message);
  const { data: viewLog } = await admin
    .from("admin_audit_log")
    .select("id")
    .eq("admin_id", moderator.id)
    .eq("what", "private_view")
    .eq("target_id", photoItem?.id ?? "");
  check((viewLog ?? []).length === 1, "and the view is in the log", String((viewLog ?? []).length));
  await admin
    .from("admin_audit_log")
    .delete()
    .eq("admin_id", moderator.id)
    .eq("what", "private_view");
  const blockerDecides = await moderator.client.rpc("decide_appeal", {
    p_appeal: photoAppeal.data?.id,
    p_outcome: "overturned",
    p_note: "",
  });
  check(
    blockerDecides.error?.code === "P0004",
    "moderator: the one who blocked cannot decide the appeal",
    blockerDecides.error?.code ?? "allowed",
  );
  const allowed = await second.client.rpc("decide_appeal", {
    p_appeal: photoAppeal.data?.id,
    p_outcome: "overturned",
    p_note: "attack test",
  });
  check(!allowed.error, "second moderator: allows the photo", allowed.error?.code);
  const { data: flagAfter } = await admin
    .from("item_flags")
    .select("scan_state")
    .eq("item_id", photoItem?.id ?? "")
    .maybeSingle();
  check(flagAfter?.scan_state === "clean", "the photo is clean again", flagAfter?.scan_state);

  // 7f. Messages are screened (spec 13.2 #1): a held phrase in a message is never refused, but
  // files one urgent report on the conversation, against the sender, with the messages as evidence.
  const heldDm = await a.rpc("send_message", { p_to: victim.id, p_body: "any thinspo tips" });
  check(
    !heldDm.error,
    "attacker: a message with a held phrase still sends (never held, never refused)",
    heldDm.error?.code,
  );
  const { data: dmReport } = await admin
    .from("reports")
    .select("id, priority, evidence, target_owner_id")
    .eq("target_type", "conversation")
    .eq("reporter_id", attacker.id)
    .eq("state", "open")
    .maybeSingle();
  check(
    dmReport?.priority === "normal" &&
      dmReport?.target_owner_id === attacker.id &&
      Array.isArray(dmReport?.evidence),
    "but it files a report on the conversation, against the sender, with evidence, at normal priority",
    JSON.stringify(dmReport).slice(0, 120),
  );
  // An urgent report reaches every moderator at once (spec 13.4 #1: phone alerts) - as a
  // notification row, which is also the push's source. The victim files one on the attacker's
  // profile as an intimate image; it is dismissed straight after.
  const urgentRef = await victim.client.rpc("file_report", {
    p_type: "profile",
    p_id: attacker.id,
    p_reason: "intimate_image",
    p_note: "attack test (ignore)",
  });
  const { data: urgentRow } = await admin
    .from("reports")
    .select("id")
    .eq("request_ref", urgentRef.data ?? "")
    .maybeSingle();
  const { data: alerts } = await admin
    .from("notifications")
    .select("user_id")
    .eq("kind", "mod_urgent")
    .eq("ref_id", urgentRow?.id ?? "")
    .in("user_id", [moderator.id, second.id]);
  check(
    (alerts ?? []).length === 2,
    "moderators: both were told of the urgent report",
    String((alerts ?? []).length),
  );
  await moderator.client.rpc("moderate", {
    p_report: urgentRow?.id,
    p_action: "dismiss",
    p_note: "attack test",
  });
  const readAnon = await anon.storage.from("closet-photos").createSignedUrl(photoPath, 60);
  check(!readAnon.data?.signedUrl, "stranger: cannot read a message photo with no session");
  const stolenPhoto = await a.rpc("send_message", {
    p_to: victim.id,
    p_body: "mine now",
    p_photo: photoItem?.id,
  });
  check(
    !!stolenPhoto.error,
    "attacker: cannot send the victim's photo as their own",
    stolenPhoto.error?.code,
  );

  // The moderator path (M7.2), walked by a machine: the queue holds the word list's report on
  // the held comment; a dismiss lets the comment show; a strike on a report about the attacker
  // reaches their own strikes; an appeal; an overturn ends the strike. A member is refused
  // every door on the way (checked above).
  const mod = moderator.client;
  const queue = await mod.rpc("moderation_queue", {});
  const heldReport = (queue.data ?? []).find((r) => r.target_id === heldComment.data?.id);
  check(
    !!heldReport,
    "moderator: the held comment's report is in the queue",
    queue.error?.code ?? `${(queue.data ?? []).length} rows`,
  );
  const dismissed = await mod.rpc("moderate", {
    p_report: heldReport?.id,
    p_action: "dismiss",
    p_note: "attack test: a wardrobe",
  });
  check(!dismissed.error, "moderator: dismisses it", dismissed.error?.code);
  const ownerSeesNow = await victim.client
    .from("comments")
    .select("id")
    .eq("id", heldComment.data?.id ?? "00000000-0000-4000-8000-000000000000");
  check((ownerSeesNow.data ?? []).length === 1, "victim: sees the comment once it is dismissed");
  const reportRef = await victim.client.rpc("file_report", {
    p_type: "profile",
    p_id: attacker.id,
    p_reason: "harassment",
    p_note: "attack test (ignore)",
  });
  check(
    typeof reportRef.data === "string" && /^K-/.test(reportRef.data),
    "victim: reports the attacker's profile and gets a K- reference",
    reportRef.error?.code,
  );
  const { data: reportRow } = await admin
    .from("reports")
    .select("id")
    .eq("request_ref", reportRef.data ?? "")
    .maybeSingle();
  const struck = await mod.rpc("moderate", {
    p_report: reportRow?.id,
    p_action: "strike",
    p_note: "attack test strike (ignore)",
  });
  check(!struck.error, "moderator: strikes", struck.error?.code);
  const myStrikes = await a.rpc("my_strikes", {});
  const strike = (myStrikes.data ?? []).find((x) => x.reason === "attack test strike (ignore)");
  check(!!strike, "attacker: sees the strike under their own strikes", myStrikes.error?.code);
  const appeal = await a
    .from("appeals")
    .insert({ strike_id: strike?.id, user_id: attacker.id, body: "attack test appeal (ignore)" })
    .select("id")
    .single();
  check(!appeal.error, "attacker: appeals once", appeal.error?.code);
  const appealTwice = await a
    .from("appeals")
    .insert({ strike_id: strike?.id, user_id: attacker.id, body: "again" });
  check(
    !!appealTwice.error,
    "attacker: cannot appeal the same strike twice",
    appealTwice.error?.code,
  );
  const samePerson = await mod.rpc("decide_appeal", {
    p_appeal: appeal.data?.id,
    p_outcome: "overturned",
    p_note: "attack test",
  });
  check(
    samePerson.error?.code === "P0004",
    "moderator: the one who struck cannot decide the appeal (a second person does)",
    samePerson.error?.code ?? "allowed",
  );
  const overturned = await second.client.rpc("decide_appeal", {
    p_appeal: appeal.data?.id,
    p_outcome: "overturned",
    p_note: "attack test",
  });
  check(!overturned.error, "second moderator: overturns the appeal", overturned.error?.code);
  // A harassment report is not urgent: no moderator was woken for it (spec 13.4 #1).
  const { data: calmAlerts } = await admin
    .from("notifications")
    .select("user_id")
    .eq("kind", "mod_urgent")
    .eq("ref_id", reportRow?.id ?? "");
  check(
    (calmAlerts ?? []).length === 0,
    "moderators: a normal report wakes nobody",
    String((calmAlerts ?? []).length),
  );
  const strikesAfter = await a.rpc("my_strikes", {});
  const ended = (strikesAfter.data ?? []).find((x) => x.id === strike?.id);
  check(
    !!ended &&
      new Date(ended.expires_at).getTime() <= Date.now() + 5000 &&
      ended.appeal_state === "overturned",
    "attacker: the strike has ended and the appeal reads overturned",
  );

  // The rest of the moderator's doors, walked the same way: a lookup with a reason that lands
  // in the audit log; a suspension that refuses the attacker's next write and is lifted; a
  // takedown request resolved as removed, taking the picture with it; a contact message closed.
  const lookup = await mod.rpc("admin_user_lookup", {
    p_username: "attackvictim",
    p_reason: "attack test (ignore)",
  });
  check(
    !lookup.error && (lookup.data ?? []).length === 1,
    "moderator: looks a person up with a reason",
    lookup.error?.code,
  );
  const { data: audit } = await admin
    .from("admin_audit_log")
    .select("id")
    .eq("reason", "attack test (ignore)")
    .limit(1);
  check((audit ?? []).length === 1, "server: the lookup is in the audit log with its reason");
  const suspended = await mod.rpc("set_suspended", {
    p_user: attacker.id,
    p_on: true,
    p_reason: "attack test (ignore)",
  });
  check(!suspended.error, "moderator: suspends the attacker", suspended.error?.code);
  const whileSuspended = await a
    .from("comments")
    .insert({ set_id: pub.id, author_id: attacker.id, body: "still here?" });
  check(
    !!whileSuspended.error,
    "attacker: cannot write while suspended",
    whileSuspended.error?.code ?? "no error",
  );
  const lifted = await mod.rpc("set_suspended", {
    p_user: attacker.id,
    p_on: false,
    p_reason: "attack test (ignore)",
  });
  check(!lifted.error, "moderator: lifts it", lifted.error?.code);
  const { data: tdRow } = await admin
    .from("takedown_requests")
    .insert({
      request_ref: `T-ATK${Date.now().toString(36).toUpperCase().slice(-5)}`,
      kind: "intimate",
      name: "attack test (ignore)",
      email: "attack-test@example.com",
      urls: [`${SITE}/item/${photoItem?.id}`],
      details: "attack test (ignore)",
    })
    .select("id")
    .single();
  const resolved = await mod.rpc("takedown_resolve", {
    p_id: tdRow?.id,
    p_outcome: "removed",
    p_note: "attack test",
    p_item: photoItem?.id,
  });
  check(!resolved.error, "moderator: resolves a takedown request as removed", resolved.error?.code);
  const { data: removedItem } = await admin
    .from("items")
    .select("takedown_state")
    .eq("id", photoItem?.id ?? "")
    .maybeSingle();
  check(
    removedItem?.takedown_state === "removed",
    "server: the picture is marked removed",
    removedItem?.takedown_state,
  );
  const readRemoved = await a.storage.from("closet-photos").createSignedUrl(photoPath, 60);
  check(!readRemoved.data?.signedUrl, "attacker: a taken-down message photo can no longer be read");

  // 7g. A copyright takedown (migration 115; spec 13.3 #4): the uploader gets a 90-day copyright
  // strike; the counter-notice, through the public door with no account, is listed for a
  // moderator and nobody else; restoring brings the picture back and ends the strike.
  const { data: copyItem } = await admin
    .from("items")
    .insert({
      owner_id: attacker.id,
      kind: "own",
      title: "attack-test copyright photo (ignore)",
      image_bucket: "closet-photos",
      image_id: `${attacker.id}/attack-test-copyright-ignore.jpg`,
    })
    .select("id")
    .single();
  // A reference in the takedown form's own alphabet (no 0, 1, I or O), as the door checks it.
  const copyRef =
    "T-ATK" +
    Array.from(
      { length: 5 },
      () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
    ).join("");
  const { data: copyTd } = await admin
    .from("takedown_requests")
    .insert({
      request_ref: copyRef,
      kind: "copyright",
      name: "attack test (ignore)",
      email: "attack-test@example.com",
      urls: [`${SITE}/item/${copyItem?.id}`],
      work: "attack test (ignore)",
      statements: true,
      signature: "attack test (ignore)",
    })
    .select("id")
    .single();
  const copyResolved = await mod.rpc("takedown_resolve", {
    p_id: copyTd?.id,
    p_outcome: "removed",
    p_note: "attack test",
    p_item: copyItem?.id,
  });
  check(
    !copyResolved.error,
    "moderator: resolves a copyright takedown as removed",
    copyResolved.error?.code,
  );
  const copyStrikes = await a.rpc("my_strikes", {});
  const copyStrike = (copyStrikes.data ?? []).find(
    (x) => x.kind === "copyright" && String(x.reason).includes(copyRef),
  );
  check(
    !!copyStrike && new Date(copyStrike.expires_at).getTime() < Date.now() + 91 * 86400000,
    "attacker: has a 90-day copyright strike naming the notice",
    copyStrikes.error?.code,
  );
  const counterBody = {
    kind: "counter",
    takedown_ref: copyRef,
    name: "attack test (ignore)",
    email: "attack-test@example.com",
    address: "1 Test Street, Testville, TS 00000",
    phone: "",
    details: "attack test counter-notice (ignore)",
    statements: true,
    consent: true,
    signature: "attack test (ignore)",
    token: "attack-test",
  };
  const counterShort = await call("takedown-request", null, { ...counterBody, consent: false });
  check(
    counterShort.status === 400,
    "stranger: a counter-notice without the consent is refused",
    String(counterShort.status),
  );
  const counter = await call("takedown-request", null, counterBody);
  check(
    counter.status === 200 && /^C-/.test(counter.json?.ref ?? ""),
    "stranger: files the counter-notice with no account and gets a C- reference",
    `${counter.status} ${JSON.stringify(counter.json)}`,
  );
  const counterAgain = await call("takedown-request", null, counterBody);
  check(
    counterAgain.status === 409,
    "stranger: not a second one while the first is open",
    String(counterAgain.status),
  );
  const counterIntimate = await call("takedown-request", null, {
    ...counterBody,
    takedown_ref: "T-NOSUCHAB",
  });
  check(
    counterIntimate.status === 404,
    "stranger: a counter-notice on an unknown notice is refused",
    String(counterIntimate.status),
  );
  const counterQueueAsAttacker = await a.rpc("counter_notice_queue", {});
  check(
    (counterQueueAsAttacker.data ?? []).length === 0,
    "attacker: sees no counter-notices",
    String((counterQueueAsAttacker.data ?? []).length),
  );
  const counterQueue = await mod.rpc("counter_notice_queue", {});
  const counterRow = (counterQueue.data ?? []).find((c) => c.takedown_ref === copyRef);
  check(
    !!counterRow,
    "moderator: the counter-notice is listed with its notice",
    counterQueue.error?.code,
  );
  const counterByAttacker = await a.rpc("counter_notice_resolve", {
    p_id: counterRow?.id,
    p_outcome: "restored",
    p_note: "",
  });
  check(
    counterByAttacker.error?.code === "42501",
    "attacker: cannot restore it",
    counterByAttacker.error?.code ?? "allowed",
  );
  const tooSoon = await mod.rpc("counter_notice_resolve", {
    p_id: counterRow?.id,
    p_outcome: "restored",
    p_note: "attack test",
  });
  check(
    tooSoon.error?.code === "P0006",
    "moderator: cannot restore before the notice's date",
    tooSoon.error?.code ?? "allowed",
  );
  await admin
    .from("counter_notices")
    .update({ restore_after: new Date(Date.now() - 3600_000).toISOString() })
    .eq("id", counterRow?.id ?? "");
  const restored = await mod.rpc("counter_notice_resolve", {
    p_id: counterRow?.id,
    p_outcome: "restored",
    p_note: "attack test",
  });
  check(
    !restored.error,
    "moderator: restores the picture once the date has passed",
    restored.error?.code,
  );
  const { data: backItem } = await admin
    .from("items")
    .select("takedown_state")
    .eq("id", copyItem?.id ?? "")
    .maybeSingle();
  check(
    backItem?.takedown_state === "none",
    "server: the picture is back",
    backItem?.takedown_state,
  );
  const strikesAfterRestore = await a.rpc("my_strikes", {});
  const endedCopy = (strikesAfterRestore.data ?? []).find((x) => x.id === copyStrike?.id);
  check(
    !!endedCopy && new Date(endedCopy.expires_at).getTime() <= Date.now() + 5000,
    "attacker: the copyright strike has ended",
  );
  const guestClient = createClient(URL_, ANON, { auth: { persistSession: false } });
  const counterStatus = await guestClient.rpc("counter_notice_status", {
    p_ref: counter.json?.ref ?? "",
  });
  check(
    counterStatus.data?.[0]?.state === "restored",
    "stranger: can check the counter-notice by reference",
    counterStatus.error?.code ?? JSON.stringify(counterStatus.data).slice(0, 80),
  );
  const { data: ctRow } = await admin
    .from("contact_messages")
    .insert({
      request_ref: `C-ATK${Date.now().toString(36).toUpperCase().slice(-5)}`,
      topic: "other",
      name: "attack test (ignore)",
      email: "attack-test@example.com",
      message: "attack test (ignore)",
    })
    .select("id")
    .single();
  const closedMsg = await mod.rpc("contact_resolve", {
    p_id: ctRow?.id,
    p_outcome: "closed",
    p_note: "attack test",
  });
  check(!closedMsg.error, "moderator: closes a contact message", closedMsg.error?.code);

  await a.from("mutes").insert({ muter_id: attacker.id, muted_id: victim.id });
  const feed2 = await a.rpc("feed_following", {});
  check(
    !(feed2.data ?? []).some((s) => s.owner_id === victim.id),
    "attacker: after muting, the feed is empty",
  );
  await a.from("mutes").delete().eq("muter_id", attacker.id);
  const blocked = await victim.client
    .from("blocks")
    .insert({ blocker_id: victim.id, blocked_id: attacker.id });
  check(!blocked.error, "victim: blocks the attacker", blocked.error?.code);
  const feed3 = await a.rpc("feed_following", {});
  const found3 = await a.rpc("search_sets", { q: "second" });
  check(
    !(feed3.data ?? []).some((s) => s.owner_id === victim.id) &&
      !(found3.data ?? []).some((s) => s.owner_id === victim.id),
    "attacker: once blocked, neither the feed nor search shows the victim's sets",
  );

  // Suggested people (migration 110): the reviewer, labelled a stylist for a moment, is
  // suggested to the attacker; not once they turned "suggest my account" off; the victim never,
  // blocked as they are; and nobody signed out is told anything. The labels go in `finally`.
  await admin
    .from("profiles")
    .update({ label: "stylist" })
    .in("user_id", [moderator.id, victim.id]);
  const suggested1 = await a.rpc("suggested_people", { p_limit: 30 });
  check(
    (suggested1.data ?? []).some((p) => p.user_id === moderator.id && p.why === "label") &&
      !(suggested1.data ?? []).some((p) => p.user_id === victim.id),
    "attacker: a labelled account is suggested, with its reason; the victim who blocked them never is",
    suggested1.error?.message ?? `${(suggested1.data ?? []).length} suggested`,
  );
  await admin.from("profiles").update({ suggestable: false }).eq("user_id", moderator.id);
  const suggested2 = await a.rpc("suggested_people", { p_limit: 30 });
  check(
    !(suggested2.data ?? []).some((p) => p.user_id === moderator.id),
    'attacker: an account that said "don\'t suggest me" is not suggested',
    suggested2.error?.message,
  );
  await admin.from("profiles").update({ suggestable: true }).eq("user_id", moderator.id);
  const suggestedAnon = await anon.rpc("suggested_people", { p_limit: 5 });
  check(
    suggestedAnon.error?.code === "42501",
    "stranger: suggestions need an account",
    suggestedAnon.error?.code ?? `${(suggestedAnon.data ?? []).length} rows`,
  );
  await admin.from("profiles").update({ label: "none" }).in("user_id", [moderator.id, victim.id]);

  // M7.5: the contact form and its inbox (migration 053), and the hidden-account share links
  // (migration 055), attacked on the live site.
  const inbox = await a.from("contact_messages").select("id").limit(1);
  check(
    (inbox.data ?? []).length === 0,
    "attacker: cannot read the contact inbox",
    inbox.error?.code ?? `${(inbox.data ?? []).length} rows`,
  );
  const td = await a.from("takedown_requests").select("id").limit(1);
  check(
    (td.data ?? []).length === 0,
    "attacker: cannot read the takedown requests",
    td.error?.code ?? `${(td.data ?? []).length} rows`,
  );
  const resolve = await a.rpc("contact_resolve", {
    p_id: "00000000-0000-4000-8000-000000000000",
    p_outcome: "answered",
  });
  check(
    resolve.error?.code === "42501",
    "attacker: cannot mark a message answered",
    resolve.error?.code ?? "no error",
  );
  const contactNoToken = await fetch(`${FN}/contact-form`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ topic: "spam", name: "x", email: "x@example.com", message: "no token" }),
  });
  check(
    contactNoToken.status === 400 || contactNoToken.status === 403,
    "stranger: the contact door refuses a message with a bad topic or no bot check",
    String(contactNoToken.status),
  );
  const wrongVerb = await fetch(`${FN}/contact-form`, { headers: { apikey: ANON } });
  check(
    wrongVerb.status === 405,
    "stranger: the contact door answers GET with 405",
    String(wrongVerb.status),
  );
  const sitemap = await fetch(`${SITE}/sitemap.xml`);
  const sitemapBody = await sitemap.text();
  check(
    sitemap.status === 200 && sitemapBody.includes("<urlset") && !sitemapBody.includes("<loc>"),
    "stranger: the sitemap is well-formed and empty while indexing is off on the test site",
    String(sitemap.status),
  );
  const pageLive = await fetch(`${SITE}/s/${pub.share_code}`);
  check(
    pageLive.status === 200,
    "stranger: the victim's public share page opens",
    String(pageLive.status),
  );
  await admin.from("profiles").update({ deactivated_at: end0 }).eq("user_id", victim.id);
  const pageDark = await fetch(`${SITE}/s/${pub.share_code}`);
  check(
    pageDark.status === 404,
    "stranger: the share page goes dark while the victim is on a break",
    String(pageDark.status),
  );
  await admin.from("profiles").update({ deactivated_at: null }).eq("user_id", victim.id);
  const pageBack = await fetch(`${SITE}/s/${pub.share_code}`);
  check(
    pageBack.status === 200,
    "stranger: and comes back when the victim does",
    String(pageBack.status),
  );

  // Lock down (spec 7.1 #5): one call, and every link the victim ever sent is dead - the share
  // page, the embed, and the attacker's own signed-in read of the public set.
  const { data: locked, error: lockError } = await victim.client.rpc("lock_down");
  const lockedPage = await fetch(`${SITE}/s/${pub.share_code}`);
  const lockedEmbed = await fetch(`${SITE}/e/${pub.share_code}`);
  const { data: afterLock } = await attacker.client.from("sets").select("id").eq("id", pub.id);
  check(
    !lockError && typeof locked === "number" && locked >= 2,
    "victim: Lock down touches every set in one call",
    lockError ? lockError.message : `${locked} sets`,
  );
  check(
    lockedPage.status === 404 && lockedEmbed.status === 404 && (afterLock ?? []).length === 0,
    "stranger and attacker: after Lock down the old link, the embed and the read are all dead",
    `${lockedPage.status}/${lockedEmbed.status}/${(afterLock ?? []).length}`,
  );
  const { error: notYours } = await attacker.client.rpc("lock_down");
  const { data: otherStillLocked } = await admin
    .from("sets")
    .select("visibility")
    .eq("id", pub.id)
    .maybeSingle();
  check(
    !notYours && otherStillLocked?.visibility === "only_me",
    "attacker: their own Lock down changes nothing of the victim's",
  );

  // The beta invites (migration 087) and the admin contest tools (085) are the admins' alone.
  const invites = await a.from("beta_invites").select("code").limit(1);
  const mint = await a.rpc("mint_beta_invites", { p_label: "x", p_count: 1, p_uses: 1, p_days: 1 });
  const probe = await anon.rpc("check_beta_invite", { p_code: "ABCD2345" });
  check(
    (invites.data ?? []).length === 0 && mint.error?.code === "42501" && !!probe.error,
    "attacker: cannot read or mint beta invites; a stranger cannot probe codes",
    `${(invites.data ?? []).length} rows / ${mint.error?.code ?? "minted"} / ${probe.error?.code ?? "answered"}`,
  );
  const watch = await a.rpc("record_price_check", { p_item: pub.id, p_status: "ok", p_cents: 1 });
  const claimWatch = await a.rpc("claim_price_checks", { p_limit: 1 });
  check(
    watch.error?.code === "42501" && claimWatch.error?.code === "42501",
    "attacker: cannot record a price reading or claim the watch's list",
    `${watch.error?.code ?? "recorded"} / ${claimWatch.error?.code ?? "claimed"}`,
  );
  const themes = await a.from("contest_themes").select("id").limit(1);
  const feature = await a.rpc("feature_set", { p_set: pub.id, p_on: true });
  const startC = await a.rpc("start_contest", {
    p_title: "attack (ignore)",
    p_theme: "",
    p_days: 1,
  });
  check(
    (themes.data ?? []).length === 0 &&
      feature.error?.code === "42501" &&
      startC.error?.code === "42501",
    "attacker: cannot see the theme queue, feature a set or start a challenge",
    `${(themes.data ?? []).length} rows / ${feature.error?.code ?? "featured"} / ${startC.error?.code ?? "started"}`,
  );
  // The weekly recap (089) answers the signed-in with their own week; a stranger gets nothing.
  const recapAnon = await anon.rpc("weekly_recap");
  const recapMine = await a.rpc("weekly_recap");
  check(
    !!recapAnon.error && !recapMine.error && typeof recapMine.data?.me?.sets_published === "number",
    "attacker: a stranger gets no weekly recap; a member gets their own week",
    `${recapAnon.error?.code ?? "answered"} / ${recapMine.error?.code ?? "ok"}`,
  );
  // Labels (090) are the server's: not on your own row, not through the admins' door.
  const selfLabel = await a.from("profiles").update({ label: "staff" }).eq("user_id", attacker.id);
  const doorLabel = await a.rpc("set_account_label", {
    p_username: attacker.username,
    p_label: "brand",
  });
  const { data: stillPlain } = await a
    .from("profiles")
    .select("label")
    .eq("user_id", attacker.id)
    .maybeSingle();
  check(
    selfLabel.error?.code === "42501" &&
      doorLabel.error?.code === "42501" &&
      stillPlain?.label === "none",
    "attacker: cannot label their own account as staff or brand",
    `${selfLabel.error?.code ?? "updated"} / ${doorLabel.error?.code ?? "labelled"} / ${stillPlain?.label}`,
  );
  // A song (091) is a link to one of the three services, never anywhere else, and a cover
  // comes only from their picture hosts: the share page draws both for strangers.
  const { data: ownSet } = await a
    .from("sets")
    .insert({ owner_id: attacker.id, title: "attack song (ignore)" })
    .select("id")
    .single();
  const songElsewhere = await a
    .from("sets")
    .update({ song_url: "https://evil.example/song", song_title: "x" })
    .eq("id", ownSet?.id ?? "");
  const coverElsewhere = await a
    .from("sets")
    .update({
      song_url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      song_title: "x",
      song_cover_url: "https://evil.example/pixel.gif",
    })
    .eq("id", ownSet?.id ?? "");
  check(
    !!ownSet && songElsewhere.error?.code === "23514" && coverElsewhere.error?.code === "23514",
    "attacker: their own set's song cannot link elsewhere or carry a cover from elsewhere",
    `${songElsewhere.error?.code ?? "saved"} / ${coverElsewhere.error?.code ?? "saved"}`,
  );
  // The profile photo (092) is pointed at through one door and served by the picture gate: not
  // by hand, not at an address of their own, not at somebody else's picture.
  const photoByHand = await a
    .from("profiles")
    .update({ avatar_item_id: item.id })
    .eq("user_id", attacker.id);
  const pixelByHand = await a
    .from("profiles")
    .update({ avatar_url: "https://evil.example/pixel.gif" })
    .eq("user_id", attacker.id);
  const theirs = await a.rpc("set_profile_photo", { p_item: item.id });
  check(
    photoByHand.error?.code === "42501" &&
      pixelByHand.error?.code === "42501" &&
      theirs.error?.code === "P0010",
    "attacker: cannot set a profile photo by hand, point it elsewhere, or at the victim's picture",
    `${photoByHand.error?.code ?? "set"} / ${pixelByHand.error?.code ?? "set"} / ${theirs.error?.code ?? "set"}`,
  );
  // The third review (095). A profile is made through claim_profile only: an account with no
  // profile cannot write its own row by hand and skip the sign-up rules.
  const nobody = await person("attack-nobody@test.kleit", "attacknobody", { claim: false });
  const rowByHand = await nobody.client.from("profiles").insert({
    user_id: nobody.id,
    username: "attacknobody",
    age_confirmed_at: new Date().toISOString(),
    terms_version: "v0.1",
  });
  const { data: noRow } = await admin
    .from("profiles")
    .select("user_id")
    .eq("user_id", nobody.id)
    .maybeSingle();
  check(
    rowByHand.error?.code === "42501" && !noRow,
    "attacker: an account cannot write its own profile row by hand (claim_profile is the door)",
    rowByHand.error?.code ?? "written",
  );
  // A store piece is clipped by the server: by hand, a piece pointing Buy anywhere is refused.
  const fakeProduct = await a.from("items").insert({
    owner_id: attacker.id,
    kind: "product",
    title: "attack fake product (ignore)",
    source_url: "https://evil.example/go",
    source_domain: "evil.example",
  });
  const ownPointing = await a.from("items").insert({
    owner_id: attacker.id,
    kind: "own",
    title: "attack pointing piece (ignore)",
    source_url: "https://evil.example/go",
  });
  check(
    fakeProduct.error?.code === "42501" && ownPointing.error?.code === "42501",
    "attacker: cannot write a store piece, or a piece pointing elsewhere, by hand",
    `${fakeProduct.error?.code ?? "written"} / ${ownPointing.error?.code ?? "written"}`,
  );
  // published_at is the server's stamp: a set published by hand with a far-future stamp is
  // stamped now, and the stamp cannot be moved afterwards.
  const { data: stamped } = await a
    .from("sets")
    .insert({
      owner_id: attacker.id,
      title: "attack song (ignore)",
      status: "published",
      visibility: "only_me",
      published_at: "2099-01-01T00:00:00Z",
    })
    .select("id, published_at")
    .single();
  const stampAge = stamped ? Math.abs(Date.now() - new Date(stamped.published_at).getTime()) : NaN;
  const moveStamp = await a
    .from("sets")
    .update({ published_at: "2099-01-01T00:00:00Z" })
    .eq("id", stamped?.id ?? "");
  check(
    stampAge < 5 * 60 * 1000 && moveStamp.error?.code === "42501",
    "attacker: a set published by hand is stamped now, and the stamp stays put",
    `${Number.isNaN(stampAge) ? "no set" : `${Math.round(stampAge / 1000)}s`} / ${moveStamp.error?.code ?? "moved"}`,
  );
  // A challenge entry never arrives already picked. The week's own challenge when it is open;
  // a throwaway one otherwise (gone in `finally`).
  const { data: openOnes } = await admin
    .from("contests")
    .select("id")
    .lte("opens_at", new Date().toISOString())
    .gt("closes_at", new Date().toISOString())
    .order("opens_at", { ascending: false })
    .limit(1);
  let contestId = openOnes?.[0]?.id ?? null;
  if (!contestId) {
    const { data: made } = await admin
      .from("contests")
      .insert({
        title: "attack contest (ignore)",
        opens_at: new Date(Date.now() - 60_000).toISOString(),
        closes_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      })
      .select("id")
      .single();
    contestId = made?.id ?? null;
  }
  const { data: entrySet } = await a
    .from("sets")
    .insert({
      owner_id: attacker.id,
      title: "attack song (ignore)",
      status: "published",
      visibility: "public",
    })
    .select("id")
    .single();
  const pickedByHand = await a.from("contest_entries").insert({
    contest_id: contestId,
    user_id: attacker.id,
    set_id: entrySet?.id ?? "",
    picked_at: new Date().toISOString(),
  });
  const plainEntry = await a
    .from("contest_entries")
    .insert({ contest_id: contestId, user_id: attacker.id, set_id: entrySet?.id ?? "" })
    .select("picked_at")
    .single();
  check(
    !!contestId &&
      pickedByHand.error?.code === "42501" &&
      !plainEntry.error &&
      plainEntry.data?.picked_at === null,
    "attacker: cannot enter a challenge already picked; a plain entry arrives unpicked",
    `${contestId ? "" : "no contest / "}${pickedByHand.error?.code ?? "picked"} / ${plainEntry.error?.code ?? "entered"}`,
  );
  await a.from("contest_entries").delete().eq("contest_id", contestId).eq("user_id", attacker.id);
} catch (error) {
  check(false, `the run stopped: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  // The victim is never left on a break by a run that stopped halfway.
  await admin.from("profiles").update({ deactivated_at: null }).eq("user_id", victim.id);
  const end = new Date().toISOString();
  // The message photo and its file go every run (L29): the row by owner and title, the file by path.
  await admin
    .from("items")
    .delete()
    .eq("owner_id", victim.id)
    .eq("title", "attack-test message photo (ignore)");
  await admin.storage
    .from("closet-photos")
    .remove([`${victim.id}/messages/attack-test-photo-ignore.jpg`]);
  // The test accounts' templates go every run, whatever happened above: a published one would
  // otherwise sit in every person's builder row (it did, three times over, on 2026-10-05).
  await admin.from("templates").delete().in("owner_id", [victim.id, attacker.id]);
  await admin.from("contest_entries").delete().eq("user_id", attacker.id);
  await admin.from("contests").delete().eq("title", "attack contest (ignore)");
  await admin.from("sets").delete().eq("owner_id", attacker.id).eq("title", "attack song (ignore)");
  // The brand page's rows (7b): the kept draft first (its rows point at the pieces), then the
  // pieces and their flags. The clip point the kept look earned the victim (7d) goes too, and the
  // profile's count with it, so the number is the same every run.
  await admin.from("sets").delete().eq("owner_id", attacker.id).eq("title", "attack keep (ignore)");
  const { data: clipPoints } = await admin
    .from("points_ledger")
    .delete()
    .eq("user_id", victim.id)
    .eq("reason", "clip_used")
    .select("points");
  await takeBackPoints(
    victim.id,
    (clipPoints ?? []).reduce((n, r) => n + r.points, 0),
  );
  // The first-set badge the kept look's publish gave the attacker (039's trigger) goes with it.
  await admin.from("badges").delete().eq("user_id", attacker.id).eq("badge", "first_set");
  // And the attacker's publish points for that kept look (its row is gone, so the ledger's
  // reference points at nothing): the ledger row goes, and the count with it.
  const { data: attackerPublishes } = await admin
    .from("points_ledger")
    .select("id, ref, points")
    .eq("user_id", attacker.id)
    .eq("reason", "publish");
  const { data: attackerSets } = await admin.from("sets").select("id").eq("owner_id", attacker.id);
  const attackerSetIds = new Set((attackerSets ?? []).map((r) => r.id));
  const orphanPublishes = (attackerPublishes ?? []).filter((r) => !attackerSetIds.has(r.ref));
  if (orphanPublishes.length) {
    await admin
      .from("points_ledger")
      .delete()
      .in(
        "id",
        orphanPublishes.map((r) => r.id),
      );
    await takeBackPoints(
      attacker.id,
      orphanPublishes.reduce((n, r) => n + r.points, 0),
    );
  }
  await admin.from("ask_posts").delete().eq("question", "attack build-around (ignore)");
  const { data: brandLeft } = await admin
    .from("items")
    .select("id")
    .eq("owner_id", victim.id)
    .like("title", "attack brand %");
  const brandIds = (brandLeft ?? []).map((r) => r.id);
  if (brandIds.length) {
    await admin.from("item_flags").delete().in("item_id", brandIds);
    await admin.from("items").delete().in("id", brandIds);
  }
  await admin.from("sets").delete().eq("owner_id", victim.id).eq("title", "attack layout (ignore)");
  await admin.from("blocks").delete().in("blocker_id", [victim.id, attacker.id]);
  // The labels the suggestion check lent (110) come off whatever happened above.
  await admin
    .from("profiles")
    .update({ label: "none", suggestable: true })
    .in("user_id", [moderator.id, victim.id]);
  await admin.from("mutes").delete().in("muter_id", [victim.id, attacker.id]);
  await admin.from("follows").delete().in("follower_id", [victim.id, attacker.id]);
  await admin.from("notifications").delete().in("user_id", [victim.id, attacker.id]);
  // The moderator role goes every run, with everything the walk made (strikes, appeals, reports, log rows).
  await admin.from("user_roles").delete().in("user_id", [moderator.id, second.id]);
  await admin.from("appeals").delete().in("user_id", [attacker.id, victim.id]);
  await admin.from("strikes").delete().eq("user_id", attacker.id);
  await admin.from("moderation_actions").delete().in("moderator_id", [moderator.id, second.id]);
  // The urgent alerts the run's reports sent to every moderator - the owner's real account among
  // them - go with the reports, whoever received them.
  const { data: runReports } = await admin
    .from("reports")
    .select("id")
    .in("reporter_id", [victim.id, attacker.id]);
  if (runReports?.length) {
    await admin
      .from("notifications")
      .delete()
      .eq("kind", "mod_urgent")
      .in(
        "ref_id",
        runReports.map((r) => r.id),
      );
  }
  await admin.from("reports").delete().in("reporter_id", [victim.id, attacker.id]);
  await admin.from("takedown_requests").delete().eq("name", "attack test (ignore)");
  await admin
    .from("items")
    .delete()
    .eq("owner_id", attacker.id)
    .eq("title", "attack-test copyright photo (ignore)");
  await admin.from("removed_image_fingerprints").delete().like("reason", "takedown:%:T-ATK%");
  await admin.from("contact_messages").delete().eq("name", "attack test (ignore)");
  await admin.from("admin_audit_log").delete().eq("reason", "attack test (ignore)");
  await admin.from("profiles").update({ banned_at: null }).eq("user_id", attacker.id);
  await admin.from("comments").delete().in("author_id", [victim.id, attacker.id]);
  await admin.from("likes").delete().in("user_id", [victim.id, attacker.id]);
  // The outside check's copies of the run's messages, and the hourly evidence note the queue
  // wrote for the moderators, go with the conversations.
  const { data: runMessages } = await admin
    .from("messages")
    .select("id")
    .in("sender_id", [victim.id, attacker.id]);
  if (runMessages?.length) {
    await admin
      .from("text_checks")
      .delete()
      .eq("kind", "message")
      .in(
        "target_id",
        runMessages.map((m) => m.id),
      );
  }
  await admin
    .from("admin_audit_log")
    .delete()
    .in("admin_id", [moderator.id, second.id])
    .eq("what", "dm_evidence");
  await admin
    .from("conversations")
    .delete()
    .or(`user_a.in.(${victim.id},${attacker.id}),user_b.in.(${victim.id},${attacker.id})`);
  await admin
    .from("sets")
    .update({ deleted_at: end })
    .in("owner_id", [victim.id, attacker.id])
    .is("deleted_at", null);
  await admin
    .from("polls")
    .update({ deleted_at: end })
    .in("owner_id", [victim.id, attacker.id])
    .is("deleted_at", null);
}

console.log(`1..${n}`);
console.log(
  failed === 0 ? `# attack: all ${n} checks held` : `# attack: ${failed} of ${n} checks FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
