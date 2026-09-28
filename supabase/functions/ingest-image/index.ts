/**
 * ingest-image — nothing with a picture in it is visible until this has run (spec 13.1; M2.5).
 *
 * The order of the steps is the design, and it is: cheapest and most certain first.
 *
 *   1. Who is asking, and is this their item? The item id comes from the caller, so it is checked
 *      against the caller's own account before anything else happens.
 *   1b. Does the stored file still carry a location? The app strips that on the phone, before the
 *      photo ever leaves - this is the second look, because anything a client does can be skipped
 *      by anyone willing to call the upload API directly. If it is still there, the file is
 *      re-encoded here and the stored copy replaced, so what we keep never carries it.
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
import { carriesMetadata } from "../_shared/metadata.ts";

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
    .select("id, owner_id, image_id, image_bucket")
    .eq("id", itemId)
    .maybeSingle();

  // Same answer for "no such item" and "not yours": the id is supplied by the caller, and a
  // different reply for the two would let anyone test which item ids exist.
  if (!item || item.owner_id !== me) return reply(404, { problem: "not-found" });
  if (!item.image_id) return reply(400, { problem: "no-image" });

  // Step 2. The fingerprint, and the list of images that may never come back.
  // Only ever these two. The column's type already forbids anything else, and this repeats it
  // because this code runs as the server and bypasses every row policy: if the type were ever
  // widened, the mistake must not reach a bucket nobody in the app may touch.
  const bucket = item.image_bucket === "closet-photos" ? "closet-photos" : "item-images";

  const { data: file, error: fileError } = await server.storage
    .from(bucket)
    .download(item.image_id);
  if (fileError || !file) return reply(502, { problem: "image-unreadable" });

  let hash: string;
  let stage: "read" | "decode" | "clean" | "fingerprint" | "scan" | "record" = "read";
  try {
    let bytes = new Uint8Array(await file.arrayBuffer());
    stage = "decode";
    let picture = await decode(bytes);

    // Step 1b. The second look at the metadata. Re-encoding is what removes it, for the same
    // reason the phone redraws rather than editing tags: a decoded picture has no metadata to
    // carry, so nothing can be left behind by a tag we did not think to look for.
    stage = "clean";
    if (carriesMetadata(bytes)) {
      console.warn("[ingest-image] stored file still carried metadata; re-encoding", itemId);
      bytes = await picture.encodeJPEG(86);
      picture = await decode(bytes);
      const { error: replaceError } = await server.storage
        .from(bucket)
        .upload(item.image_id, bytes, { contentType: "image/jpeg", upsert: true });
      // If the clean copy cannot replace the dirty one, stop. Carrying on would scan the clean
      // bytes and mark as visible a stored file that still holds somebody's address.
      if (replaceError) return reply(502, { problem: "could-not-clean" });
    }

    // A frame of an animation still has pixels; a format we cannot read does not, and that is a
    // refusal rather than a pass.
    stage = "fingerprint";
    const pixels = new Uint8Array(picture.bitmap);
    hash = fingerprint(pixels, picture.width, picture.height);

    const { data: removed } = await server.from("removed_image_fingerprints").select("image_hash");
    const seenBefore = (removed ?? []).find((row) => distance(row.image_hash, hash) <= SAME_PICTURE);
    if (seenBefore) {
      stage = "record";
      const flagged = await server.from("item_flags").upsert({
        item_id: itemId,
        scan_state: "blocked",
        labels: { reason: "removed-before", matched: seenBefore.image_hash },
        scanned_at: new Date().toISOString(),
      });
      if (flagged.error) throw new Error(`could not record the block: ${flagged.error.message}`);
      const stamped = await server.from("items").update({ image_hash: hash }).eq("id", itemId);
      if (stamped.error) throw new Error(`could not store the fingerprint: ${stamped.error.message}`);
      return reply(200, { state: "blocked" });
    }

    // Checked, not hoped for. This write was refused for a week by a trigger meant to keep PEOPLE
    // out of this column, and because nothing looked at the error the function went on to report
    // a clean scan while the fingerprint - the thing that stops a removed image coming back - was
    // never stored. A write whose result nobody reads is a wish.
    const stamped = await server.from("items").update({ image_hash: hash }).eq("id", itemId);
    if (stamped.error) throw new Error(`could not store the fingerprint: ${stamped.error.message}`);

    // Step 3. AWS. Anything that goes wrong from here leaves the flag as it is - which is
    // `pending`, which is invisible.
    if (!accessKeyId || !secretAccessKey) return reply(503, { problem: "scanner-not-configured" });

    stage = "scan";
    const labels = await detectModerationLabels(
      bytes,
      { accessKeyId, secretAccessKey },
      MIN_CONFIDENCE,
    );
    const verdict = decide(labels);
    stage = "record";

    const recorded = await server.from("item_flags").upsert({
      item_id: itemId,
      scan_state: verdict.state,
      labels: {
        because: verdict.because,
        keep_out_of_featured: verdict.keepOutOfFeatured,
        all: labels,
      },
      scanned_at: new Date().toISOString(),
    });
    // If the verdict cannot be recorded, there IS no verdict. Answering "clean" here would tell
    // the app a photo had passed while the database still says it was never scanned - which is
    // invisible - so the person would be told it worked and then find it nowhere.
    if (recorded.error) throw new Error(`could not record the verdict: ${recorded.error.message}`);

    return reply(200, { state: verdict.state, keepOutOfFeatured: verdict.keepOutOfFeatured });
  } catch (problem) {
    // Deliberately no flag write. The image stays unscanned and therefore invisible, and the
    // next attempt gets a clean run at it.
    //
    // `at` says WHICH step fell over and nothing about why. That distinction matters: the reason
    // can contain a storage path or an AWS message and belongs only in the log, but "decode" vs
    // "scan" vs "store" is worth its weight the first time something breaks in production - the
    // first real photo through this pipeline failed at `decode`, and without this marker finding
    // that meant guessing.
    console.error("[ingest-image]", stage, problem instanceof Error ? problem.message : problem);
    return reply(502, { problem: "scan-failed", at: stage });
  }
});
