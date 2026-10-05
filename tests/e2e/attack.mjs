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

async function person(email, username) {
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
  if (!prof) {
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

  // ---------------------------------------------------------------------------
  // 7. Templates (M4.5): a private one is nobody else's; a published one is readable but not
  //    editable; nothing can be made in the victim's name.
  // ---------------------------------------------------------------------------
  const { data: tplPriv } = await victim.client
    .from("templates")
    .insert({
      owner_id: victim.id,
      name: `${XSS} private`,
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
      name: "published",
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
  await admin.from("templates").delete().in("id", [tplPriv.id, tplPub.id]);
} catch (error) {
  check(false, `the run stopped: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  const end = new Date().toISOString();
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
