import { supabase } from "@/integrations/supabase/client";
import { previewUrl } from "@/search/search";

/**
 * "Save image" (design pack S47; spec 5.2 #3): the set's chat picture - the same versioned JPEG the
 * share page and the link previews use (`set-previews`, drawn by `set-preview` after publish) -
 * handed to the phone's share sheet as a file where the browser can do that, or downloaded where
 * it cannot. Drawn a few seconds after publishing, so the answer can be "not yet".
 *
 * Three sizes, as the spec asks: the chat picture as drawn (square), a Story (9:16, 1080×1920) and
 * a post (4:5, 1080×1350). The two tall ones are the same picture fitted onto the set's own
 * background colour - nothing is re-coloured, nothing is cropped, no watermark (1.6 #17, 6.6 #8).
 */
export type SaveImageResult = "saved" | "not-yet" | "failed";
export type SaveImageShape = "chat" | "story" | "post";

const SIZES: Record<Exclude<SaveImageShape, "chat">, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  post: { w: 1080, h: 1350 },
};

export async function saveSetImage(
  setId: string,
  title: string,
  shape: SaveImageShape = "chat",
): Promise<SaveImageResult> {
  const { data } = await supabase
    .from("sets")
    .select("preview_image_id, layout")
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
  if (shape !== "chat") {
    const background = (data?.layout as { background?: string } | null)?.background;
    const fitted = await fitOnto(blob, SIZES[shape], background);
    if (!fitted) return "failed";
    blob = fitted;
  }
  const name = `${
    (title || "kleit-set")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "kleit-set"
  }${shape === "chat" ? "" : `-${shape}`}.jpg`;
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

/** The chat picture, whole, centred on a canvas of the given size over the set's own colour. */
async function fitOnto(
  source: Blob,
  size: { w: number; h: number },
  background: string | undefined,
): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(source);
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = /^#[0-9a-fA-F]{6}$/.test(background ?? "") ? background! : "#FAF9F7";
    ctx.fillRect(0, 0, size.w, size.h);
    const margin = Math.round(size.w * 0.06);
    const scale = Math.min(
      (size.w - margin * 2) / bitmap.width,
      (size.h - margin * 2) / bitmap.height,
    );
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    ctx.drawImage(bitmap, Math.round((size.w - w) / 2), Math.round((size.h - h) / 2), w, h);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9),
    );
  } catch {
    return null;
  }
}
