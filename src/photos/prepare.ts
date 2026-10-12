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
  /** What it became. See the note on JPEG below; PNG is the cutout editor's, when something was cut away. */
  type: "image/webp" | "image/jpeg" | "image/png";
};

export type PrepareProblem = "not-an-image" | "unreadable" | "too-big" | "too-small" | "animated";

/**
 * Under this on either side there is no garment to see (spec 4.6 #2): the floor for a closet
 * photo. A profile photo or a picture in a message passes its own, smaller floor.
 */
export const SHORTEST_SIDE = 200;

/** Refused before we even decode it: a 25 MB file is not a garment photo, it is a mistake. */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;

/**
 * The redraw on its own: the photo the right way up, capped, on a canvas with no metadata. This
 * is what the cutout editor starts from (cutout.ts), and what preparePhoto encodes.
 */
export async function prepareCanvas(
  file: Blob,
  longestSide: number = LONGEST_SIDE,
  shortestSide: number = SHORTEST_SIDE,
): Promise<{ ok: true; canvas: HTMLCanvasElement } | { ok: false; problem: PrepareProblem }> {
  if (!file.type.startsWith("image/")) return { ok: false, problem: "not-an-image" };
  if (file.size > MAX_INPUT_BYTES) return { ok: false, problem: "too-big" };
  // No animations (owner's decision, 2026-10-01). Said here, before the upload, so the person
  // hears it at once; the server refuses the same thing again, because this is the app being
  // polite and the server being the lock.
  if (await isAnimatedGif(file)) return { ok: false, problem: "animated" };

  let bitmap: ImageBitmap;
  try {
    // "from-image" is what applies the orientation tag. Without it the redraw would bake in the
    // sideways pixels and then throw away the tag that explained them.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, problem: "unreadable" };
  }

  if (bitmap.width < shortestSide || bitmap.height < shortestSide) {
    bitmap.close();
    return { ok: false, problem: "too-small" };
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
  return { ok: true, canvas };
}

export async function preparePhoto(
  file: Blob,
  longestSide: number = LONGEST_SIDE,
  shortestSide: number = SHORTEST_SIDE,
): Promise<{ ok: true; photo: Prepared } | { ok: false; problem: PrepareProblem }> {
  const prepared = await prepareCanvas(file, longestSide, shortestSide);
  if (!prepared.ok) return prepared;
  const canvas = prepared.canvas;
  const { width, height } = canvas;

  // JPEG, not WebP, and this is a deliberate step backwards.
  //
  // WebP is about a quarter smaller, and the first version used it. Then the very first photo put
  // through the real pipeline came back "still checking": the screening function decodes the
  // stored file to fingerprint it, and the decoder available to it reads JPEG and PNG but NOT
  // WebP. So every upload succeeded, every scan failed, and every photo stayed invisible - the
  // safe direction, but useless.
  //
  // It costs almost nothing to give up. What is stored is the original we keep and scan; what
  // people are actually served is generated from it on the fly (decision 103), so the delivered
  // picture is still WebP or AVIF. The only price is the upload itself being a quarter bigger.
  // Worth revisiting if the server ever gains a WebP decoder.
  const blob = await toBlob(canvas, "image/jpeg", 0.86);
  if (!blob) return { ok: false, problem: "unreadable" };
  return { ok: true, photo: { blob, width, height, type: "image/jpeg" } };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Is this GIF a moving one? A still GIF has one picture inside; an animation has several, and
 * nearly always the NETSCAPE loop block as well. This reads the bytes - a decoded bitmap cannot
 * say how many frames it came from.
 */
export async function isAnimatedGif(file: Blob): Promise<boolean> {
  if (file.type !== "image/gif") return false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 6 || bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return false;
  let controls = 0;
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] !== 0x21) continue;
    // 21 F9 04: one graphic control block per frame.
    if (bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && ++controls > 1) return true;
    // 21 FF 0B "NETSCAPE2.0": the loop block only an animation carries.
    if (bytes[i + 1] === 0xff && bytes[i + 2] === 0x0b) {
      const name = String.fromCharCode(...bytes.slice(i + 3, i + 14));
      if (name === "NETSCAPE2.0") return true;
    }
  }
  return false;
}
