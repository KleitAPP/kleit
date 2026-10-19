/**
 * mod-image (spec 13.4 #2 and #9; the safety walk of 2026-10-19): the one way a moderator sees a
 * picture the world may not - a photo the scanner sent for review, a blocked photo under appeal,
 * or the picture of a reported piece or profile. The caller must be signed in AND a moderator
 * (my_roles, as that person); the answer is a signed address good for two minutes, as JSON for
 * the moderation screen to open blurred and sharpen on a tap. Every answer writes a row in
 * admin_audit_log first ("every admin view of private photos ... is recorded"): the moderator,
 * the piece, and why - one of three fixed reasons, never free text from the browser, and each
 * checked against the database before the address is signed (a piece in review, under an open
 * appeal, or named by an open report).
 *
 * GET ?item=<uuid>&why=queue|scan-review|appeal
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WHY: Record<string, string> = {
  queue: "the review queue: a reported piece or profile photo",
  "scan-review": "the scan review: a photo the scanner sent to a person",
  appeal: "an appeal on a blocked photo",
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "GET") return reply(405, { problem: "method" });
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
  const [{ data: roles, error }, { data: who }] = await Promise.all([me.rpc("my_roles"), me.auth.getUser()]);
  if (error || !who?.user) return reply(401, { problem: "signed-out" });
  const list = (roles ?? []) as string[];
  if (!list.includes("moderator") && !list.includes("admin")) return reply(403, { problem: "moderators-only" });

  const params = new URL(request.url).searchParams;
  const itemId = params.get("item") ?? "";
  const why = params.get("why") ?? "";
  if (!UUID.test(itemId) || !Object.hasOwn(WHY, why)) return reply(404, { problem: "not-found" });

  const server = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: item } = await server
    .from("items")
    .select("id, image_id, image_bucket, owner_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item?.image_id) return reply(404, { problem: "not-found" });

  // The reason has to be true of the piece right now (the read-back of 2026-10-19): a photo in
  // the scanner's review, a blocked photo with an open appeal, or a piece named by an open report
  // (itself, or the profile whose photo it is). Any other picture is the same 404.
  let fits = false;
  if (why === "scan-review") {
    const { data: flag } = await server.from("item_flags").select("scan_state").eq("item_id", itemId).maybeSingle();
    fits = flag?.scan_state === "review";
  } else if (why === "appeal") {
    const { count } = await server
      .from("appeals")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId)
      .eq("state", "open");
    fits = (count ?? 0) > 0;
  } else {
    const { count: onItem } = await server
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("target_type", "item")
      .eq("target_id", itemId)
      .in("state", ["open", "reviewing"]);
    fits = (onItem ?? 0) > 0;
    if (!fits && item.owner_id) {
      const { data: profile } = await server
        .from("profiles")
        .select("avatar_item_id")
        .eq("user_id", item.owner_id)
        .maybeSingle();
      if (profile?.avatar_item_id === itemId) {
        const { count: onProfile } = await server
          .from("reports")
          .select("id", { count: "exact", head: true })
          .eq("target_type", "profile")
          .eq("target_id", item.owner_id)
          .in("state", ["open", "reviewing"]);
        fits = (onProfile ?? 0) > 0;
      }
    }
  }
  if (!fits) return reply(404, { problem: "not-found" });

  // The log row goes first: no row, no picture.
  const logged = await server
    .from("admin_audit_log")
    .insert({ admin_id: who.user.id, what: "private_view", target_id: itemId, reason: WHY[why] });
  if (logged.error) return reply(500, { problem: "not-logged" });

  const bucket = item.image_bucket === "closet-photos" ? "closet-photos" : "item-images";
  const { data: signed } = await server.storage.from(bucket).createSignedUrl(item.image_id, 120);
  if (!signed?.signedUrl) return reply(404, { problem: "not-found" });
  return reply(200, { url: signed.signedUrl, seconds: 120 });
});
