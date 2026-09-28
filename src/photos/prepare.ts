/**
 * Getting a photo ready to leave the phone (roadmap M2.3 and M2.6; spec 15, 16).
 *
 * A photo out of a camera carries more than the picture. A JPEG's EXIF block routinely holds the
 * exact GPS coordinates the shot was taken at, the time, the phone's model and sometimes its
 * serial number. Someone photographing a jumper on their bed is not offering their home address,
 * and an app that uploads one without saying so has taken it from them.
 *
 * So nothing is uploaded as it came off the camera. The picture is drawn onto a canvas and
 * re-encoded, which keeps the pixels and discards everything else - there is no metadata to strip
 * because a canvas has none to begin with. That is stronger than editing the EXIF out of the
 * original file: an allow-list of "the tags we remove" is only ever as good as the list.
 *
 * Two things the redraw also fixes, for free:
 *   - **Orientation.** A phone usually stores the picture sideways plus an EXIF tag saying which
 *     way up it goes. Throw the tag away naively and every other photo is on its side. Browsers
 *     apply that tag when decoding (`createImageBitmap` with imageOrientation: "from-image"), so
 *     redrawing bakes the right way up into the pixels before the tag disappears.
 *   - **Size.** A modern phone photo is 12 megapixels and 6 MB of it is detail nobody will see on
 *     a 400 px tile. Capping the longest side keeps uploads inside the bucket's limit and off
 *     people's data plans.
 *
 * The server checks again after upload. This runs on the phone so the data never leaves in the
 * first place; the second check exists because anything a client does can be skipped.
 */

/** Enough for a full-screen view on a high-density phone, and about a tenth of the bytes. */
export const LONGEST_SIDE = 2048;

export type Prepared = {
  blob: Blob;
  width: number;
  height: number;
  /** What it became. WebP everywhere that has it; JPEG is the fallback for older browsers. */
  type: "image/webp" | "image/jpeg";
};

export type PrepareProblem = "not-an-image" | "unreadable" | "too-big";

/** Refused before we even decode it: a 25 MB file is not a garment photo, it is a mistake. */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export async function preparePhoto(
  file: Blob,
  longestSide: number = LONGEST_SIDE,
): Promise<{ ok: true; photo: Prepared } | { ok: false; problem: PrepareProblem }> {
  if (!file.type.startsWith("image/")) return { ok: false, problem: "not-an-image" };
  if (file.size > MAX_INPUT_BYTES) return { ok: false, problem: "too-big" };

  let bitmap: ImageBitmap;
  try {
    // "from-image" is what applies the orientation tag. Without it the redraw would bake in the
    // sideways pixels and then throw away the tag that explained them.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, problem: "unreadable" };
  }

  const scale = Math.min(1, longestSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return { ok: false, problem: "unreadable" };
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await toBlob(canvas, "image/webp", 0.86);
  if (blob && blob.type === "image/webp") {
    return { ok: true, photo: { blob, width, height, type: "image/webp" } };
  }
  const fallback = await toBlob(canvas, "image/jpeg", 0.86);
  if (!fallback) return { ok: false, problem: "unreadable" };
  return { ok: true, photo: { blob: fallback, width, height, type: "image/jpeg" } };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
