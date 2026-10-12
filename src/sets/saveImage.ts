import { supabase } from "@/integrations/supabase/client";
import { previewUrl } from "@/search/search";

/**
 * "Save image" (design pack S47): the set's chat picture - the same versioned JPEG the share page
 * and the link previews use (`set-previews`, drawn by `set-preview` after publish) - handed to the
 * phone's share sheet as a file where the browser can do that, or downloaded where it cannot.
 * Drawn a few seconds after publishing, so the answer can be "not yet".
 */
export type SaveImageResult = "saved" | "not-yet" | "failed";

export async function saveSetImage(setId: string, title: string): Promise<SaveImageResult> {
  const { data } = await supabase
    .from("sets")
    .select("preview_image_id")
    .eq("id", setId)
    .maybeSingle();
  const url = previewUrl({ preview_image_id: data?.preview_image_id ?? null });
  if (!url) return "not-yet";
  let blob: Blob;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return res.status === 404 ? "not-yet" : "failed";
    blob = await res.blob();
  } catch {
    return "failed";
  }
  const name = `${
    (title || "kleit-set")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "kleit-set"
  }.jpg`;
  const file = new File([blob], name, { type: "image/jpeg" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: title || "Kleit" });
      return "saved";
    } catch {
      // The person closed the sheet, or the browser said no after all: fall through to a download.
    }
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return "saved";
}
