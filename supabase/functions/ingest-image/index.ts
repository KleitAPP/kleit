/**
 * ingest-image — nothing with a picture in it is visible until this has run (spec 13.1; M2.5).
 *
 * The order of the steps is the design, and it is: cheapest and most certain first.
 *
 *   1. Who is asking, and is this their item? The item id comes from the caller, so it is checked
 *      against the caller's own account before anything else happens.
 *   2. Fingerprint the image and compare it with the list of images that may never come back
 *      (spec 13.1 #5). This costs nothing, needs no outside service, and is the one check that
 *      must never be skipped - it is how a removed image stays removed.
 *   3. Only then ask AWS. It costs money and it can fail.
 *   4. Write the verdict.
 *
 * The rule the whole file is built around: **every failure leaves the image unscanned, and
 * unscanned is invisible** (migration 010's read policy). There is no path through this code that
 * turns a failure into "clean". If AWS is down, photos stop appearing - and that is the correct
 * way for a photo pipeline to break.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decode } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

import { fingerprint, distance, SAME_PICTURE } from "../_shared/fingerprint.ts";
import { decide, MIN_CONFIDENCE } from "../_shared/screening.ts";
import { detectModerationLabels } from "../_shared/aws.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
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
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
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
    .select("id, owner_id, image_id")
    .eq("id", itemId)
    .maybeSingle();

  // Same answer for "no such item" and "not yours": the id is supplied by the caller, and a
  // different reply for the two would let anyone test which item ids exist.
  if (!item || item.owner_id !== me) return reply(404, { problem: "not-found" });
  if (!item.image_id) return reply(400, { problem: "no-image" });

  // Step 2. The fingerprint, and the list of images that may never come back.
  const { data: file, error: fileError } = await server.storage
    .from("item-images")
    .download(item.image_id);
  if (fileError || !file) return reply(502, { problem: "image-unreadable" });

  let hash: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const picture = await decode(bytes);
    // A frame of an animation still has pixels; a format we cannot read does not, and that is a
    // refusal rather than a pass.
    const pixels = new Uint8Array(picture.bitmap);
    hash = fingerprint(pixels, picture.width, picture.height);

    const { data: removed } = await server.from("removed_image_fingerprints").select("image_hash");
    const seenBefore = (removed ?? []).find((row) => distance(row.image_hash, hash) <= SAME_PICTURE);
    if (seenBefore) {
      await server.from("item_flags").upsert({
        item_id: itemId,
        scan_state: "blocked",
        labels: { reason: "removed-before", matched: seenBefore.image_hash },
        scanned_at: new Date().toISOString(),
      });
      await server.from("items").update({ image_hash: hash }).eq("id", itemId);
      return reply(200, { state: "blocked" });
    }

    await server.from("items").update({ image_hash: hash }).eq("id", itemId);

    // Step 3. AWS. Anything that goes wrong from here leaves the flag as it is - which is
    // `pending`, which is invisible.
    if (!accessKeyId || !secretAccessKey) return reply(503, { problem: "scanner-not-configured" });

    const labels = await detectModerationLabels(
      bytes,
      { accessKeyId, secretAccessKey },
      MIN_CONFIDENCE,
    );
    const verdict = decide(labels);

    await server.from("item_flags").upsert({
      item_id: itemId,
      scan_state: verdict.state,
      labels: {
        because: verdict.because,
        keep_out_of_featured: verdict.keepOutOfFeatured,
        all: labels,
      },
      scanned_at: new Date().toISOString(),
    });

    return reply(200, { state: verdict.state, keepOutOfFeatured: verdict.keepOutOfFeatured });
  } catch (problem) {
    // Deliberately no flag write. The image stays unscanned and therefore invisible, and the
    // next attempt gets a clean run at it.
    console.error("[ingest-image]", problem instanceof Error ? problem.message : problem);
    return reply(502, { problem: "scan-failed" });
  }
});
