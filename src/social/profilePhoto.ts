import { supabase } from "@/integrations/supabase/client";
import { myScanStates } from "@/items/items";

/**
 * The profile photo (spec 3.5; migration 092). A photo of your own, in your own avatar folder,
 * screened like every photo on Kleit (`ingest-image`), pointed at through `set_profile_photo()`
 * and served by the same gate as every other picture (`item-image`): nothing shows until the
 * scan clears, and nothing is uploaded anywhere public.
 */
export type PhotoState = "clean" | "review" | "blocked" | "checking";

/** The address of somebody's profile photo, or undefined when they have none. */
export function avatarSrc(itemId: string | null | undefined): string | undefined {
  const base = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
  if (!base || !itemId) return undefined;
  return `${base}/functions/v1/item-image?item=${itemId}`;
}

export type UploadResult =
  | { ok: true; itemId: string; state: PhotoState }
  | { ok: false; problem: "unreadable" | "signed-out" | "upload-failed" | "refused" };

/** Upload, screen, and make it the profile photo. The state says whether it already shows. */
export async function uploadProfilePhoto(file: Blob): Promise<UploadResult> {
  const { preparePhoto } = await import("@/photos/prepare");
  // Capped at 1024 - a face needs no more - and no garment floor: a small old photo is fine here.
  const prepared = await preparePhoto(file, 1024, 1);
  if (!prepared.ok) return { ok: false, problem: "unreadable" };
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return { ok: false, problem: "signed-out" };
  const ready = prepared.photo;
  const extension =
    ready.type === "image/png" ? "png" : ready.type === "image/webp" ? "webp" : "jpg";
  const path = `${me}/avatar/${crypto.randomUUID()}.${extension}`;
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
      title: "Profile photo",
    })
    .select("id")
    .single();
  if (saveError || !item) return { ok: false, problem: "upload-failed" };

  let state: PhotoState = "checking";
  try {
    const { data } = await supabase.functions.invoke("ingest-image", { body: { itemId: item.id } });
    const verdict = (data as { state?: string } | null)?.state;
    if (verdict === "clean" || verdict === "review" || verdict === "blocked") state = verdict;
  } catch {
    // Unscanned stays invisible; the sweeper picks it up and the photo appears when it clears.
  }
  if (state === "blocked" || state === "review") return { ok: false, problem: "refused" };
  const { error } = await supabase.rpc("set_profile_photo", { p_item: item.id });
  if (error) return { ok: false, problem: "upload-failed" };
  return { ok: true, itemId: item.id, state };
}

export async function removeProfilePhoto(): Promise<boolean> {
  const { error } = await supabase.rpc("set_profile_photo", {});
  return !error;
}

/** Whether the person's own current photo has cleared (it shows to others only once it has). */
export async function myPhotoState(itemId: string): Promise<PhotoState> {
  const states = await myScanStates([itemId]);
  const s = states.get(itemId);
  return s === "clean" || s === "review" || s === "blocked" ? s : "checking";
}
