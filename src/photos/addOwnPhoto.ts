/**
 * Adding a photo of something you own (roadmap M2.6; design pack S36, S37).
 *
 * Four steps, in an order chosen so that nothing half-done is ever visible:
 *
 *   1. Prepare it on the phone - redraw, drop the location, cap the size (`preparePhoto`).
 *   2. Put the file in YOUR OWN folder in the private closet bucket. Nobody else can read it,
 *      including while the rest of this is still running.
 *   3. Make the item row, pointing at that file.
 *   4. Ask the server to screen it.
 *
 * The item exists between steps 3 and 4 with no screening result, and that is fine, because an
 * item with no screening result is invisible to everyone but its owner by the database's own read
 * policy. There is no moment where an unscanned photo could be seen by somebody else - not because
 * the steps are fast, but because the invisible state is the default and screening is what leaves
 * it.
 */
import { supabase } from "@/integrations/supabase/client";
import { preparePhoto, type Prepared, type PrepareProblem } from "@/photos/prepare";

export type AddProblem =
  PrepareProblem | "signed-out" | "upload-failed" | "save-failed" | "offline";

export type AddResult =
  | { ok: true; itemId: string; state: "clean" | "review" | "blocked" | "checking" }
  | { ok: false; problem: AddProblem };

/**
 * `photo` is either the file as chosen (it is prepared here) or something already prepared - the
 * cutout editor's output, which has been through the same redraw and must not go through it
 * again, because a second JPEG pass would throw away the transparency it just made.
 */
export async function addOwnPhoto(photo: Blob | Prepared): Promise<AddResult> {
  let ready: Prepared;
  if (photo instanceof Blob) {
    const prepared = await preparePhoto(photo);
    if (!prepared.ok) return { ok: false, problem: prepared.problem };
    ready = prepared.photo;
  } else {
    ready = photo;
  }

  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return { ok: false, problem: "signed-out" };

  // The first folder in the path is the account id, which is what the storage policy checks.
  // crypto.randomUUID rather than the file's own name: a name can carry its own story
  // ("IMG_2024_hospital.jpg"), and two people uploading "jumper.webp" must not collide.
  const extension =
    ready.type === "image/png" ? "png" : ready.type === "image/webp" ? "webp" : "jpg";
  const path = `${me}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("closet-photos")
    .upload(path, ready.blob, { contentType: ready.type, upsert: false });
  if (uploadError) return { ok: false, problem: "upload-failed" };

  const { data: item, error: saveError } = await supabase
    .from("items")
    .insert({
      owner_id: me,
      kind: "own",
      image_bucket: "closet-photos",
      image_id: path,
    })
    .select("id")
    .single();
  if (saveError || !item) return { ok: false, problem: "save-failed" };

  // A photo of your own piece IS a closet piece. The closet is the row policy's business
  // (owner-only), so this insert can only ever land in the caller's own closet.
  const { error: closetError } = await supabase
    .from("closet_items")
    .insert({ user_id: me, item_id: item.id });
  if (closetError) return { ok: false, problem: "save-failed" };

  // Step 4. If this does not land, the item simply stays unscanned - which is invisible - and the
  // screen says it is still being checked, which is true. Nothing is lost and nothing leaks.
  try {
    const { data: verdict, error: scanError } = await supabase.functions.invoke("ingest-image", {
      body: { itemId: item.id },
    });
    if (scanError || !verdict?.state) return { ok: true, itemId: item.id, state: "checking" };
    return { ok: true, itemId: item.id, state: verdict.state };
  } catch {
    return { ok: true, itemId: item.id, state: "checking" };
  }
}
