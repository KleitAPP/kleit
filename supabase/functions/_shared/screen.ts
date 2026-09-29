/**
 * screenItem — the screening pipeline for ONE item, with no opinion about who asked (spec 13.1).
 *
 * Two callers share this, and that is the point of the file:
 *
 *   - `ingest-image`, when the app asks straight after an upload, so the person gets an answer
 *     while they are still looking at the screen;
 *   - `sweep-images`, on a timer, for anything the first call did not finish. A cold start plus
 *     a full decode plus an AWS round trip can outlast the app's patience, and before the sweeper
 *     existed a photo whose first call timed out simply sat unscanned for ever (open problem
 *     CL25). Invisible, which is the safe direction - and never appearing, which is useless.
 *
 * The order of the steps is the design: cheapest and most certain first.
 *
 *   1. Does the stored file still carry a location? The app strips that on the phone, before the
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
 * way for a photo pipeline to break. A failure is thrown, never returned, so a caller cannot
 * forget to look at it.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decode, GIF, type Frame, type Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

import { fingerprint, distance, SAME_PICTURE } from "./fingerprint.ts";
import { decide, MIN_CONFIDENCE } from "./screening.ts";
import { detectModerationLabels } from "./aws.ts";
import { carriesMetadata } from "./metadata.ts";

export type ScreenableItem = {
  id: string;
  image_id: string;
  image_bucket: string | null;
};

export type AwsKeys = { accessKeyId: string; secretAccessKey: string };

export type Verdict = {
  state: "clean" | "review" | "blocked";
  keepOutOfFeatured: boolean;
};

export type Stage = "read" | "decode" | "clean" | "fingerprint" | "scan" | "record";

/** Thrown for every failure. `stage` says WHICH step fell over and nothing about why. */
export class ScreenFailure extends Error {
  constructor(
    public readonly stage: Stage,
    public readonly problem: "image-unreadable" | "could-not-clean" | "scanner-not-configured" | "scan-failed",
    cause?: unknown,
  ) {
    super(cause instanceof Error ? cause.message : problem);
  }
}

export async function screenItem(
  server: SupabaseClient,
  item: ScreenableItem,
  aws: AwsKeys | null,
): Promise<Verdict> {
  // Only ever these two buckets. The column's type already forbids anything else, and this
  // repeats it because this code runs as the server and bypasses every row policy: if the type
  // were ever widened, the mistake must not reach a bucket nobody in the app may touch.
  const bucket = item.image_bucket === "closet-photos" ? "closet-photos" : "item-images";

  let stage: Stage = "read";
  const { data: file, error: fileError } = await server.storage.from(bucket).download(item.image_id);
  if (fileError || !file) throw new ScreenFailure(stage, "image-unreadable", fileError);

  try {
    let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
    stage = "decode";
    let picture = firstFrame(await decode(bytes));

    // Step 1. The second look at the metadata. Re-encoding is what removes it, for the same
    // reason the phone redraws rather than editing tags: a decoded picture has no metadata to
    // carry, so nothing can be left behind by a tag we did not think to look for.
    stage = "clean";
    if (carriesMetadata(bytes)) {
      console.warn("[screen] stored file still carried metadata; re-encoding", item.id);
      bytes = await picture.encodeJPEG(86);
      picture = firstFrame(await decode(bytes));
      const { error: replaceError } = await server.storage
        .from(bucket)
        .upload(item.image_id, bytes, { contentType: "image/jpeg", upsert: true });
      // If the clean copy cannot replace the dirty one, stop. Carrying on would scan the clean
      // bytes and mark as visible a stored file that still holds somebody's address.
      if (replaceError) throw new ScreenFailure(stage, "could-not-clean", replaceError);
    }

    // Step 2. A frame of an animation still has pixels; a format we cannot read does not, and
    // that is a refusal rather than a pass.
    stage = "fingerprint";
    const pixels = new Uint8Array(picture.bitmap);
    const hash = fingerprint(pixels, picture.width, picture.height);

    const { data: removed } = await server.from("removed_image_fingerprints").select("image_hash");
    const seenBefore = (removed ?? []).find((row) => distance(row.image_hash, hash) <= SAME_PICTURE);
    if (seenBefore) {
      stage = "record";
      const flagged = await server.from("item_flags").upsert({
        item_id: item.id,
        scan_state: "blocked",
        labels: { reason: "removed-before", matched: seenBefore.image_hash },
        scanned_at: new Date().toISOString(),
      });
      if (flagged.error) throw new Error(`could not record the block: ${flagged.error.message}`);
      const stamped = await server.from("items").update({ image_hash: hash }).eq("id", item.id);
      if (stamped.error) throw new Error(`could not store the fingerprint: ${stamped.error.message}`);
      return { state: "blocked", keepOutOfFeatured: true };
    }

    // Checked, not hoped for. This write was refused for a week by a trigger meant to keep PEOPLE
    // out of this column, and because nothing looked at the error the function went on to report
    // a clean scan while the fingerprint - the thing that stops a removed image coming back - was
    // never stored. A write whose result nobody reads is a wish.
    const stamped = await server.from("items").update({ image_hash: hash }).eq("id", item.id);
    if (stamped.error) throw new Error(`could not store the fingerprint: ${stamped.error.message}`);

    // Step 3. AWS. Anything that goes wrong from here leaves the flag as it is - which is
    // `pending`, which is invisible.
    if (!aws) throw new ScreenFailure(stage, "scanner-not-configured");

    stage = "scan";
    const labels = await detectModerationLabels(bytes, aws, MIN_CONFIDENCE);
    const verdict = decide(labels);
    stage = "record";

    const recorded = await server.from("item_flags").upsert({
      item_id: item.id,
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

    return { state: verdict.state, keepOutOfFeatured: verdict.keepOutOfFeatured };
  } catch (problem) {
    if (problem instanceof ScreenFailure) throw problem;
    // Deliberately no flag write. The image stays unscanned and therefore invisible, and the
    // next attempt - the sweeper's - gets a clean run at it.
    //
    // The reason can contain a storage path or an AWS message and belongs only in the log;
    // "decode" vs "scan" vs "record" is worth its weight the first time something breaks in
    // production - the first real photo through this pipeline failed at `decode`, and without
    // this marker finding that meant guessing.
    console.error("[screen]", item.id, stage, problem instanceof Error ? problem.message : problem);
    throw new ScreenFailure(stage, "scan-failed", problem);
  }
}

/**
 * An animation is screened by its first frame. A frame still has pixels; and the alternative -
 * refusing every GIF - would be a rule about file formats standing in for a rule about pictures.
 * (A first frame that is innocent while a later one is not is a known gap; it is noted in the
 * open problems and is not solved here.)
 */
function firstFrame(decoded: Image | GIF): Image | Frame {
  if (decoded instanceof GIF) {
    const frame = decoded[0];
    if (!frame) throw new Error("animation with no frames");
    return frame;
  }
  return decoded;
}

/** The AWS keys from the function's environment, or null if they are not there. */
export function awsKeysFromEnv(): AwsKeys | null {
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}
