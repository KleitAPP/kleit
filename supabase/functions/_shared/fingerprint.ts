/**
 * The perceptual fingerprint of an image (spec 13.1 #2 and #5; roadmap M2.5).
 *
 * Two jobs, and they are the same calculation:
 *   - a removed image must never come back (13.1 #5). Someone who has an image taken down and
 *     re-uploads it saves it as a JPEG at 80% quality, or crops two pixels off the edge, and an
 *     exact file hash sees a completely different file. A perceptual hash does not.
 *   - the TAKE IT DOWN Act obliges us to remove "identical copies" within 48 hours (13.3 #3),
 *     and identical to a person means looks the same, not byte-for-byte.
 *
 * The method is dHash: shrink to 9x8 in grey, then ask 64 times "is this pixel brighter than the
 * one to its right?". That gives 64 bits describing the image's structure, which survives
 * recompression, resizing and small colour shifts, and changes completely for a different photo.
 *
 * It is deliberately NOT a security hash. Two different images CAN collide, which is why a match
 * sends an image to a human rather than being the end of the story - except on the removed list,
 * where the cost of a false match (one person has to appeal) is far below the cost of a miss
 * (a removed image is back).
 */

/** The distance between two fingerprints: how many of the 64 answers differ. */
export function distance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    // Each hex character is four bits; count the bits that differ within it.
    let bits = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (bits) {
      differing += bits & 1;
      bits >>= 1;
    }
  }
  return differing;
}

/**
 * How close counts as the same picture.
 *
 * 0 is the same file. 1-6 is the same photo re-saved, resized or lightly cropped. Above about 12
 * two unrelated photos start matching by chance, and a fashion catalogue is full of near-identical
 * white-background product shots, so the threshold has to stay well under that or every plain
 * white tee would match every other one.
 */
export const SAME_PICTURE = 6;

/** Greyscale value of a pixel, weighted the way an eye weights the three colours. */
function grey(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * dHash of RGBA pixel data. `width` and `height` are the source size; the caller has already
 * decoded the file, because decoding is the one part that needs an image library and this part
 * must stay testable with made-up pixels.
 */
export function fingerprint(pixels: Uint8Array, width: number, height: number): string {
  if (width < 1 || height < 1) throw new Error("fingerprint: empty image");
  const COLS = 9;
  const ROWS = 8;
  const small: number[] = [];

  // Box-average down to 9x8. Averaging rather than sampling is what makes the hash survive a
  // resize: a single sampled pixel can land on a speck of dust, a box cannot.
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x0 = Math.floor((col * width) / COLS);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / COLS));
      const y0 = Math.floor((row * height) / ROWS);
      const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / ROWS));
      let total = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const at = (y * width + x) * 4;
          total += grey(pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0);
          count++;
        }
      }
      small.push(count === 0 ? 0 : total / count);
    }
  }

  // 64 comparisons, packed four to a hex character.
  let hex = "";
  let nibble = 0;
  let bitsInNibble = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS - 1; col++) {
      const left = small[row * COLS + col]!;
      const right = small[row * COLS + col + 1]!;
      nibble = (nibble << 1) | (left > right ? 1 : 0);
      bitsInNibble++;
      if (bitsInNibble === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bitsInNibble = 0;
      }
    }
  }
  return hex;
}
