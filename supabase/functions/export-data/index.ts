/**
 * export-data (design pack S25; spec 3.7, guardrail 10; privacy policy §5 #1): "Download my
 * data". One ZIP with everything the app holds about the person who asks, and a link that
 * works for seven days.
 *
 * The one rule that keeps this honest: **every row is read AS THE PERSON**, with their own
 * token, so the row policies decide what goes in exactly as they decide what the app shows. The
 * service key is used for two things only - writing the ZIP into the person's own folder of the
 * `exports` bucket (server-write-only, owner-read) and signing the link. Nothing is read with it.
 *
 * Limits: one new export a day (the last one's link is handed back inside that day); closet
 * photos are included up to 20 MB (the bucket allows 25) and the rest are listed by name - they
 * are still in the closet. Votes are server-only rows and are not in the file; the poll totals
 * the person can see are.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DAY = 24 * 60 * 60 * 1000;
const LINK_SECONDS = 7 * 24 * 60 * 60;
const PHOTO_BUDGET = 20 * 1024 * 1024;

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

type Rows = Record<string, unknown>[];

/** A table read as the person. A refused or failed read becomes an empty list with a note. */
// deno-lint-ignore no-explicit-any
type Query = any;

async function rows(
  me: SupabaseClient,
  table: string,
  select: string,
  notes: string[],
  shape?: (q: Query) => Query,
): Promise<Rows> {
  try {
    let query: Query = me.from(table).select(select);
    if (shape) query = shape(query);
    const { data, error } = await query.limit(5000);
    if (error) {
      notes.push(`${table}: not included (${error.message})`);
      return [];
    }
    return (data ?? []) as Rows;
  } catch (problem) {
    notes.push(`${table}: not included (${problem instanceof Error ? problem.message : "error"})`);
    return [];
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply(405, { problem: "method" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return reply(500, { problem: "not-configured" });

  const authorization = request.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(authorization)) return reply(401, { problem: "signed-out" });
  const me = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoError } = await me.auth.getUser();
  const userId = who.user?.id;
  if (whoError || !userId) return reply(401, { problem: "signed-out" });
  const email = who.user?.email ?? null;

  const server = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // One a day: hand back the newest link inside that day instead of making another.
  const { data: existing } = await server.storage.from("exports").list(userId, { limit: 20, sortBy: { column: "created_at", order: "desc" } });
  const newest = (existing ?? []).find((f) => f.name.endsWith(".zip"));
  if (newest?.created_at && Date.now() - Date.parse(newest.created_at) < DAY) {
    const { data: signed } = await server.storage.from("exports").createSignedUrl(`${userId}/${newest.name}`, LINK_SECONDS);
    if (signed?.signedUrl) {
      return reply(200, { url: signed.signedUrl, madeAt: newest.created_at, reused: true, expiresInDays: 7 });
    }
  }

  const notes: string[] = [];
  const files: Record<string, Uint8Array> = {};
  const put = (name: string, value: unknown) => {
    files[name] = strToU8(JSON.stringify(value, null, 2));
  };

  const profile = await rows(me, "profiles", "username, display_name, bio, is_private, findable_by_email, findable_by_phone, suggestable, style_vibes, dm_setting, comments_default, points, terms_version, age_confirmed_at, created_at, updated_at", notes, (q) => q.eq("user_id", userId));
  put("profile.json", { user_id: userId, email, ...(profile[0] ?? {}) });

  put("sets.json", await rows(me, "sets", "id, title, caption, tags, layout, status, visibility, share_code, published_at, created_at, updated_at, deleted_at", notes, (q) => q.eq("owner_id", userId)));
  put("set_items.json", await rows(me, "set_items", "set_id, item_id, position, created_at", notes));
  put("set_versions.json", await rows(me, "set_versions", "set_id, layout, saved_at", notes));
  put("collections.json", await rows(me, "collections", "id, name, visibility, created_at", notes, (q) => q.eq("owner_id", userId)));
  put("collection_entries.json", await rows(me, "collection_entries", "collection_id, set_id, item_id, created_at", notes));
  put("templates.json", await rows(me, "templates", "id, name, layout, kind, is_public, created_at", notes, (q) => q.eq("owner_id", userId)));

  const items = await rows(me, "items", "id, kind, title, price_cents, price_currency, store_name, source_url, source_domain, image_bucket, image_id, color_name, alt_text, credit, takedown_state, created_at, deleted_at", notes, (q) => q.eq("owner_id", userId));
  put("items.json", items);
  put("closet_items.json", await rows(me, "closet_items", "item_id, notes, shareable, created_at, deleted_at", notes));
  put("drawer_items.json", await rows(me, "drawer_items", "item_id, origin, picked_up_from_set_id, created_at", notes));
  put("saved_items.json", await rows(me, "saved_items", "item_id, created_at", notes));
  put("clip_records.json", await rows(me, "clip_records", "item_id, image_id, source_url, trigger, created_at", notes));

  put("comments.json", await rows(me, "comments", "id, set_id, body, created_at, edited_at, deleted_at", notes, (q) => q.eq("author_id", userId)));
  put("likes.json", await rows(me, "likes", "set_id, created_at", notes, (q) => q.eq("user_id", userId)));
  put("reactions.json", await rows(me, "reactions", "set_id, emoji, created_at", notes, (q) => q.eq("user_id", userId)));
  put("following.json", await rows(me, "follows", "followee_id, created_at", notes, (q) => q.eq("follower_id", userId)));
  put("followers.json", await rows(me, "follows", "follower_id, created_at", notes, (q) => q.eq("followee_id", userId)));
  put("follow_requests.json", await rows(me, "follow_requests", "requester_id, target_id, created_at", notes));
  put("blocks.json", await rows(me, "blocks", "blocked_id, created_at", notes, (q) => q.eq("blocker_id", userId)));
  put("mutes.json", await rows(me, "mutes", "muted_id, created_at", notes, (q) => q.eq("muter_id", userId)));

  put("conversations.json", await rows(me, "conversations", "id, user_a, user_b, state, created_at", notes));
  put("messages.json", await rows(me, "messages", "conversation_id, sender_id, body, photo_item_id, created_at, deleted_at", notes));

  put("polls.json", await rows(me, "polls", "id, share_code, question, closes_at, closed_at, created_at", notes, (q) => q.eq("owner_id", userId)));
  put("poll_options.json", await rows(me, "poll_options", "poll_id, set_id, label, sort_order", notes));
  put("poll_totals.json", await rows(me, "poll_totals", "*", notes));

  put("groups.json", await rows(me, "group_members", "group_id, role, state, created_at", notes, (q) => q.eq("user_id", userId)));
  put("group_posts.json", await rows(me, "group_posts", "group_id, set_id, body, created_at", notes, (q) => q.eq("author_id", userId)));
  put("asks.json", await rows(me, "ask_posts", "id, question, closed_at, created_at", notes, (q) => q.eq("author_id", userId)));
  put("ask_answers.json", await rows(me, "ask_answers", "ask_id, set_id, chosen, created_at", notes, (q) => q.eq("author_id", userId)));
  put("contest_entries.json", await rows(me, "contest_entries", "contest_id, set_id, created_at", notes, (q) => q.eq("user_id", userId)));
  put("points.json", await rows(me, "points_ledger", "points, reason, ref, created_at", notes, (q) => q.eq("user_id", userId)));
  put("badges.json", await rows(me, "badges", "badge, awarded_at", notes, (q) => q.eq("user_id", userId)));

  put("notifications.json", await rows(me, "notifications", "kind, actor_id, ref_type, ref_id, bundled_count, created_at, read_at", notes));
  put("push_settings.json", await rows(me, "push_settings", "enabled, timezone, platform, updated_at", notes));
  put("reports_you_sent.json", await rows(me, "reports", "request_ref, target_type, target_id, reason, note, state, created_at", notes, (q) => q.eq("reporter_id", userId)));
  put("strikes.json", await rows(me, "strikes", "id, kind, reason, created_at, expires_at", notes, (q) => q.eq("user_id", userId)));
  put("appeals.json", await rows(me, "appeals", "strike_id, body, state, created_at, decided_at", notes, (q) => q.eq("user_id", userId)));
  put("account_deletion.json", await rows(me, "account_deletions", "state, requested_at, final_at, cancelled_at", notes));

  // Closet photos: the person's own files, read as the person, up to the budget.
  let spent = 0;
  const skipped: string[] = [];
  const own = items.filter((i) => i["image_bucket"] === "closet-photos" && typeof i["image_id"] === "string" && !i["deleted_at"]);
  for (const item of own) {
    const path = item["image_id"] as string;
    if (spent >= PHOTO_BUDGET) {
      skipped.push(path);
      continue;
    }
    const { data, error } = await me.storage.from("closet-photos").download(path);
    if (error || !data) {
      skipped.push(path);
      continue;
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (spent + bytes.length > PHOTO_BUDGET) {
      skipped.push(path);
      continue;
    }
    files[`photos/${path.split("/").pop()}`] = bytes;
    spent += bytes.length;
  }
  if (skipped.length) files["photos-not-included.txt"] = strToU8(["These photos were over the 20 MB limit for one file and are still in your closet:", ...skipped].join("\n"));

  files["README.txt"] = strToU8(
    [
      "Your Kleit data",
      `Made ${new Date().toISOString()} for ${email ?? userId}.`,
      "",
      "Every file is JSON you can open in any text editor. Ids are the app's own; usernames are in profile.json and, for people you follow, in the app.",
      "Votes on your polls are counted in poll_totals.json and never listed one by one - that is how the app treats them too.",
      "Photos you added to your closet are in photos/ (JPEG or PNG). Pictures you clipped from stores are not copied here; items.json has their source links.",
      "",
      notes.length ? "Notes:\n" + notes.join("\n") : "Everything readable by you was included.",
    ].join("\n"),
  );

  const zip = zipSync(files, { level: 6 });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  const { error: upError } = await server.storage.from("exports").upload(`${userId}/${name}`, zip, { contentType: "application/zip", upsert: false });
  if (upError) return reply(502, { problem: "could-not-store", detail: upError.message });
  const { data: signed, error: signError } = await server.storage.from("exports").createSignedUrl(`${userId}/${name}`, LINK_SECONDS);
  if (signError || !signed?.signedUrl) return reply(502, { problem: "could-not-sign" });

  // Older exports go: one at a time is plenty, and the bucket is not a backup.
  const old = (existing ?? []).filter((f) => f.name !== name).map((f) => `${userId}/${f.name}`);
  if (old.length) await server.storage.from("exports").remove(old);

  return reply(200, { url: signed.signedUrl, madeAt: new Date().toISOString(), reused: false, expiresInDays: 7, bytes: zip.length, photos: own.length - skipped.length, photosSkipped: skipped.length });
});
