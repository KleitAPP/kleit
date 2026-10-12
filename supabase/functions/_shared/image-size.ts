/**
 * The size of a picture read from its header, before anything decodes it. A decoder allocates
 * width × height × 4 bytes whatever the file weighs: a 2 MB PNG that claims 20,000 × 20,000
 * pixels is 1.6 GB of memory, and the isolate that tries it dies for everyone sharing it. Every
 * server-side decode asks here first and refuses what the phone would never send (the app caps
 * the longest side at 2,048 px; a store picture is rarely over 4,000).
 */

export type Dimensions = { width: number; height: number };

/** The largest picture any server-side decoder here will open: 6,000 × 6,000 (36 megapixels). */
export const MAX_PIXELS = 6000 * 6000;
export const MAX_SIDE = 16384;

function u16be(b: Uint8Array, at: number): number {
  return (b[at]! << 8) | b[at + 1]!;
}
function u32be(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
}
function u16le(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8);
}
function u24le(b: Uint8Array, at: number): number {
  return b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
}

/** Width and height from the header of a PNG, JPEG, GIF or WebP; null when it is none of those. */
export function imageDimensions(bytes: Uint8Array): Dimensions | null {
  const b = bytes;
  // PNG: signature, then the IHDR chunk's width and height at 16 and 20.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: u32be(b, 16), height: u32be(b, 20) };
  }
  // GIF: "GIF87a"/"GIF89a", then the logical screen size, little-endian.
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: u16le(b, 6), height: u16le(b, 8) };
  }
  // JPEG: walk the markers to the first start-of-frame.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) {
        at += 1;
        continue;
      }
      const marker = b[at + 1]!;
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      // Markers with no length: padding and restart marks.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      const length = u16be(b, at + 2);
      const sof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (sof) return { height: u16be(b, at + 5), width: u16be(b, at + 7) };
      if (marker === 0xda) break; // start of scan: no frame header before it means no picture
      at += 2 + length;
    }
    return null;
  }
  // WebP: RIFF....WEBP, then VP8 / VP8L / VP8X.
  if (
    b.length >= 30 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    const kind = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (kind === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (kind === "VP8L") {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return null;
}

/**
 * True when the picture is small enough to decode. A header that cannot be read answers true,
 * because the decoder will refuse what it cannot read and that is the right place for it; a
 * header that reads as enormous answers false before a byte of it is decoded.
 */
export function decodable(bytes: Uint8Array): boolean {
  const size = imageDimensions(bytes);
  if (!size) return true;
  if (size.width <= 0 || size.height <= 0) return false;
  if (size.width > MAX_SIDE || size.height > MAX_SIDE) return false;
  return size.width * size.height <= MAX_PIXELS;
}
