/**
 * Finding the metadata a photo should not still be carrying (roadmap M2.3; spec 15, 16).
 *
 * The app strips this on the phone, before the photo ever leaves. This is the second look, and it
 * exists because the first one runs on a device we do not control: anything a client does can be
 * skipped by anyone willing to call the upload API directly. A promise enforced only in the app
 * is a promise to the people who use the app nicely.
 *
 * It looks for the container, not for the tags. A JPEG keeps EXIF in an APP1 segment, a PNG in an
 * eXIf chunk, a WebP in an EXIF chunk inside RIFF. Asking "is there a metadata block here at all"
 * cannot be fooled by a tag we forgot to look for - which is the same reason the phone side
 * re-encodes rather than editing tags out.
 */

/** True when the bytes still carry a metadata block that could hold a location. */
export function carriesMetadata(bytes: Uint8Array): boolean {
  return jpegHasApp1(bytes) || pngHasExifChunk(bytes) || webpHasExifChunk(bytes);
}

function jpegHasApp1(bytes: Uint8Array): boolean {
  // Not a JPEG: 0xFFD8 is the only way one can start.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;

  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return false; // Out of step with the segment table; stop guessing.
    const marker = bytes[at + 1]!;
    // Start of scan: the compressed picture begins, and no more segments follow.
    if (marker === 0xda) return false;
    if (marker === 0xd9) return false; // End of image.
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (length < 2) return false;
    // APP1 is where EXIF lives. APP1 is also where XMP lives, which carries location too.
    if (marker === 0xe1) return true;
    at += 2 + length;
  }
  return false;
}

function pngHasExifChunk(bytes: Uint8Array): boolean {
  const PNG = [0x89, 0x50, 0x4e, 0x47];
  if (bytes.length < 8 || !PNG.every((b, i) => bytes[i] === b)) return false;
  return findAscii(bytes, "eXIf") >= 0;
}

function webpHasExifChunk(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const webp = String.fromCharCode(...bytes.subarray(8, 12));
  if (riff !== "RIFF" || webp !== "WEBP") return false;
  return findAscii(bytes, "EXIF") >= 0;
}

/** Where a short ASCII tag first appears in the bytes, or -1. */
function findAscii(bytes: Uint8Array, tag: string): number {
  const needle = Array.from(tag).map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
