/**
 * Checks the server's second look for photo metadata (roadmap M2.3; spec 15, 16).
 *
 * Runs on every push, without a browser, against the real fixture the browser test uses - so the
 * same photo proves both halves of the promise: the phone strips it, and the server would notice
 * if a phone ever did not.
 */
import { readFileSync } from "node:fs";
import { carriesMetadata } from "../supabase/functions/_shared/metadata.ts";

type Case = { name: string; bytes: Uint8Array; carries: boolean };

const withGps = new Uint8Array(readFileSync("scripts/fixtures/gps-photo.jpg"));

/** A JPEG with the same shape but no APP1: header, a quantisation table, then the scan. */
function jpegWithout(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // start of image
    0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, // a (nonsense but well-formed) DQT segment
    0xff, 0xda, 0x00, 0x02, // start of scan; nothing after this is a segment
    0xff, 0xe1, 0x00, 0x02, // APP1-looking bytes INSIDE the compressed data - must not count
  ]);
}

/** A JPEG that puts its APP1 after a JFIF APP0, which is the ordinary camera layout. */
function jpegWithApp1AfterApp0(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0
    0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1 "Exif"
    0xff, 0xda, 0x00, 0x02,
  ]);
}

const cases: Case[] = [
  { name: "the real camera photo with GPS in it", bytes: withGps, carries: true },
  { name: "a JPEG with APP1 after the usual APP0", bytes: jpegWithApp1AfterApp0(), carries: true },
  {
    name: "a JPEG with no APP1, where APP1-looking bytes sit inside the compressed data",
    bytes: jpegWithout(),
    carries: false,
  },
  {
    name: "a PNG carrying an eXIf chunk",
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 4, 0x65, 0x58, 0x49, 0x66]),
    carries: true,
  },
  {
    name: "a plain PNG",
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]),
    carries: false,
  },
  {
    name: "a WebP carrying an EXIF chunk",
    bytes: new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x45, 0x58, 0x49, 0x46,
    ]),
    carries: true,
  },
  {
    name: "a plain WebP, which is what the phone uploads",
    bytes: new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
    ]),
    carries: false,
  },
  { name: "something far too short to be a photo", bytes: new Uint8Array([0xff]), carries: false },
  { name: "nothing at all", bytes: new Uint8Array(), carries: false },
];

let failed = 0;
for (const c of cases) {
  const got = carriesMetadata(c.bytes);
  const ok = got === c.carries;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${c.name}: ${got ? "carries metadata" : "clean"}${ok ? "" : ` (wanted ${c.carries ? "carries" : "clean"})`}`);
}

if (failed > 0) {
  console.error(`\nMetadata check FAILED: ${failed} of ${cases.length}`);
  process.exit(1);
}
console.log(`\nMetadata check passed: all ${cases.length} cases.`);
