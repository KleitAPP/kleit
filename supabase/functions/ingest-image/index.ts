/**
 * ingest-image — the app asks for its own photo to be screened, right after uploading it
 * (spec 13.1; M2.5, M2.6).
 *
 * This function does exactly two things: works out whether the caller may ask about this item,
 * and hands the item to the shared pipeline in `_shared/screen.ts`. The pipeline itself is shared
 * with `sweep-images`, which re-runs it for anything this call did not finish - so a slow cold
 * start here is no longer a photo that never appears (open problem CL25).
 *
 * The rule the pipeline is built around, repeated here because it is why the error branch is so
 * short: **every failure leaves the image unscanned, and unscanned is invisible** (migration 010).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

import { screenItem, ScreenFailure, awsKeysFromEnv } from "../_shared/screen.ts";

// supabase-js sends `apikey` and `x-client-info` with every call, and a browser refuses the whole
// request at the preflight if either is missing from this list. Found live on 2026-09-29: the app's
// call never left the browser, so every photo waited for the sweeper - which is safe, and slow.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { problem: "not-configured" });

  // The caller's own token, used ONLY to find out who they are. Never to read anything.
  const authorization = request.headers.get("Authorization") ?? "";
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authorization } },
  });
  const { data: who } = await asCaller.auth.getUser();
  const me = who.user?.id;
  if (!me) return reply(401, { problem: "signed-out" });

  let itemId: string;
  try {
    const asked = await request.json();
    itemId = String(asked?.itemId ?? "");
  } catch {
    return reply(400, { problem: "bad-request" });
  }
  if (!itemId) return reply(400, { problem: "bad-request" });

  // Everything below runs as the server, so the checks have to be ours rather than the database's.
  const server = createClient(url, serviceKey);

  const { data: item } = await server
    .from("items")
    .select("id, owner_id, image_id, image_bucket")
    .eq("id", itemId)
    .maybeSingle();

  // Same answer for "no such item" and "not yours": the id is supplied by the caller, and a
  // different reply for the two would let anyone test which item ids exist.
  if (!item || item.owner_id !== me) return reply(404, { problem: "not-found" });
  if (!item.image_id) return reply(400, { problem: "no-image" });

  // A verdict already given is given again, not re-earned: a picture is downloaded, decoded and
  // sent to the scanner once, however many times the app asks. Five failed tries is where the
  // sweeper stops too, and asking by hand does not buy more.
  const { data: flag } = await server
    .from("item_flags")
    .select("scan_state, attempts")
    .eq("item_id", itemId)
    .maybeSingle();
  if (
    flag &&
    (flag.scan_state === "clean" || flag.scan_state === "review" || flag.scan_state === "blocked")
  ) {
    return reply(200, { state: flag.scan_state });
  }
  if (flag && (flag.attempts ?? 0) >= 5) return reply(429, { problem: "too-many-attempts" });

  // Count the attempt before making it, so a scan that dies half-way still counts as one. The
  // sweeper stops after a few, and without this a photo that crashes the scanner every time
  // would be tried for ever.
  await server.rpc("count_scan_attempt", { p_item_id: itemId });

  try {
    const verdict = await screenItem(
      server,
      { id: item.id, image_id: item.image_id, image_bucket: item.image_bucket },
      awsKeysFromEnv(),
    );
    return reply(200, verdict);
  } catch (problem) {
    if (problem instanceof ScreenFailure) {
      const status = problem.problem === "scanner-not-configured" ? 503 : 502;
      return reply(status, { problem: problem.problem, at: problem.stage });
    }
    console.error("[ingest-image]", problem instanceof Error ? problem.message : problem);
    return reply(502, { problem: "scan-failed" });
  }
});
