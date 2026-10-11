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
// A third account wears the moderator role for the length of the run (written with the service
// key - a person can never write user_roles - and removed in `finally`). It is the only way the
// moderator path is exercised at all while nobody human has the role (OW16).
const moderator = await person("attack-reviewer@test.kleit", "attackreviewer");
await admin.from("user_roles").upsert({ user_id: moderator.id, role: "moderator" });
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
      embed.headers.get("content-security-policy") === "frame-ancestors *" &&
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
  const sharePage = await fetch(`${SITE}/s/${pub.share_code}`);
  check(
    !(sharePage.headers.get("content-security-policy") ?? "").includes("frame-ancestors *"),
    "stranger: the share page itself does not invite framing",
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
  await admin.storage
    .from("closet-photos")
    .upload(photoPath, jpegBytes, { contentType: "image/jpeg", upsert: true });
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
  const readCleared = await a.storage.from("closet-photos").createSignedUrl(photoPath, 60);
  check(
    !!readCleared.data?.signedUrl,
    "attacker: can read it once the scan has cleared it",
    readCleared.error?.message,
  );
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
  const overturned = await mod.rpc("decide_appeal", {
    p_appeal: appeal.data?.id,
    p_outcome: "overturned",
    p_note: "attack test",
  });
  check(!overturned.error, "moderator: overturns the appeal", overturned.error?.code);
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
  await admin.from("blocks").delete().in("blocker_id", [victim.id, attacker.id]);
  await admin.from("mutes").delete().in("muter_id", [victim.id, attacker.id]);
  await admin.from("follows").delete().in("follower_id", [victim.id, attacker.id]);
  await admin.from("notifications").delete().in("user_id", [victim.id, attacker.id]);
  // The moderator role goes every run, with everything the walk made (strikes, appeals, reports, log rows).
  await admin.from("user_roles").delete().eq("user_id", moderator.id);
  await admin.from("appeals").delete().eq("user_id", attacker.id);
  await admin.from("strikes").delete().eq("user_id", attacker.id);
  await admin.from("moderation_actions").delete().eq("moderator_id", moderator.id);
  await admin.from("reports").delete().in("reporter_id", [victim.id, attacker.id]);
  await admin.from("takedown_requests").delete().eq("name", "attack test (ignore)");
  await admin.from("contact_messages").delete().eq("name", "attack test (ignore)");
  await admin.from("admin_audit_log").delete().eq("reason", "attack test (ignore)");
  await admin.from("profiles").update({ banned_at: null }).eq("user_id", attacker.id);
  await admin.from("comments").delete().in("author_id", [victim.id, attacker.id]);
  await admin.from("likes").delete().in("user_id", [victim.id, attacker.id]);
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
