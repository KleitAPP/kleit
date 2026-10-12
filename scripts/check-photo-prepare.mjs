/**
 * Proves that a photo loses its location before it ever leaves the phone (roadmap M2.3, M2.6;
 * spec 15, 16).
 *
 * This is the check behind a promise made to people rather than a feature: a photo of a jumper on
 * someone's bed carries the coordinates of their bed, and they did not offer that. It runs in a
 * real browser, because the stripping is a canvas redraw and a canvas only exists in one.
 *
 * The module under test is the real one - bundled straight out of src/photos/prepare.ts with
 * esbuild - not a copy pasted into this file. A test of a copy proves only that the copy works.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import pw from "playwright";

const { chromium } = pw;

// Bundle the real module into something a plain page can load.
execFileSync(
  "npx",
  [
    "esbuild",
    "src/photos/prepare.ts",
    "--bundle",
    "--format=iife",
    "--global-name=Kleit",
    "--outfile=/tmp/kleit-prepare.js",
  ],
  { stdio: "inherit" },
);

const bundle = readFileSync("/tmp/kleit-prepare.js", "utf8");
const photo = readFileSync("scripts/fixtures/gps-photo.jpg");
const photoBase64 = photo.toString("base64");

const browser = await chromium.launch(
  process.env.KLEIT_CHROMIUM ? { executablePath: process.env.KLEIT_CHROMIUM } : {},
);
const page = await browser.newPage();
await page.goto("about:blank");
await page.addScriptTag({ content: bundle });

const result = await page.evaluate(
  async ({ photoBase64 }) => {
    const bytes = Uint8Array.from(atob(photoBase64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "photo.jpg", { type: "image/jpeg" });

    const prepared = await window.Kleit.preparePhoto(file);
    if (!prepared.ok) return { failedWith: prepared.problem };

    const out = new Uint8Array(await prepared.photo.blob.arrayBuffer());
    const asText = Array.from(out)
      .map((b) => String.fromCharCode(b))
      .join("");

    // A 30 MB blob, to prove the size limit refuses before anything is decoded.
    const huge = new File([new Uint8Array(30 * 1024 * 1024)], "huge.jpg", { type: "image/jpeg" });
    const hugeResult = await window.Kleit.preparePhoto(huge);

    const notAPhoto = new File([new Uint8Array(10)], "notes.txt", { type: "text/plain" });
    const notAPhotoResult = await window.Kleit.preparePhoto(notAPhoto);

    // Same photo again, capped small, to prove the longest side is respected.
    const small = await window.Kleit.preparePhoto(file, 100);

    // A two-frame GIF (1x1, two pictures, the NETSCAPE loop block): refused as a moving picture.
    // And the same bytes with one frame and no loop block: a still, allowed through.
    const gifHead = [
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00,
      0x00, 0xff, 0xff, 0xff,
    ];
    const loop = [
      0x21,
      0xff,
      0x0b,
      ...Array.from("NETSCAPE2.0", (c) => c.charCodeAt(0)),
      0x03,
      0x01,
      0x00,
      0x00,
      0x00,
    ];
    const frame = [
      0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
      0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00,
    ];
    const animated = new File(
      [new Uint8Array([...gifHead, ...loop, ...frame, ...frame, 0x3b])],
      "wave.gif",
      { type: "image/gif" },
    );
    const still = new File([new Uint8Array([...gifHead, ...frame, 0x3b])], "dot.gif", {
      type: "image/gif",
    });
    const animatedResult = await window.Kleit.preparePhoto(animated);
    // The still is 1 px, so the garment floor (spec 4.6 #2) is lifted to prove the animation
    // check alone lets it through; left in place, the same still is refused as too small.
    const stillResult = await window.Kleit.preparePhoto(still, undefined, 1);
    const tinyResult = await window.Kleit.preparePhoto(still);

    return {
      inputBytes: bytes.length,
      outputBytes: out.length,
      width: prepared.photo.width,
      height: prepared.photo.height,
      type: prepared.photo.type,
      hasExifMarker: asText.includes("Exif"),
      hasGpsHint: asText.includes("GPS") || asText.includes("Kleit Test Phone"),
      hugeRefused: hugeResult.ok === false ? hugeResult.problem : "ALLOWED",
      notAPhotoRefused: notAPhotoResult.ok === false ? notAPhotoResult.problem : "ALLOWED",
      smallLongestSide: small.ok ? Math.max(small.photo.width, small.photo.height) : "FAILED",
      animatedRefused: animatedResult.ok === false ? animatedResult.problem : "ALLOWED",
      stillGif: stillResult.ok ? "allowed" : stillResult.problem,
      tinyRefused: tinyResult.ok === false ? tinyResult.problem : "ALLOWED",
    };
  },
  { photoBase64 },
);

await browser.close();

if (result.failedWith) {
  console.error(`✗ the photo could not be prepared at all: ${result.failedWith}`);
  process.exit(1);
}

const checks = [
  {
    ok: !result.hasExifMarker,
    say: "the prepared photo carries no EXIF block at all",
  },
  {
    ok: !result.hasGpsHint,
    say: "the prepared photo carries no GPS coordinates and no camera make",
  },
  {
    // Stored sideways at 200x400 with orientation 6, so displayed it is 400 wide by 200 high.
    ok: result.width === 400 && result.height === 200,
    say: `the photo comes out the right way up (${result.width}x${result.height}, wanted 400x200)`,
  },
  {
    ok: result.type === "image/webp" || result.type === "image/jpeg",
    say: `it is re-encoded (${result.type})`,
  },
  {
    ok: result.animatedRefused === "animated",
    say: `a moving GIF is refused before it is uploaded (${result.animatedRefused})`,
  },
  {
    ok: result.stillGif === "allowed",
    say: `a still GIF is allowed through (${result.stillGif})`,
  },
  {
    ok: result.hugeRefused === "too-big",
    say: `a 30 MB file is refused before it is decoded (${result.hugeRefused})`,
  },
  {
    ok: result.notAPhotoRefused === "not-an-image",
    say: `something that is not an image is refused (${result.notAPhotoRefused})`,
  },
  {
    ok: result.smallLongestSide === 100,
    say: `the longest side is capped where asked (${result.smallLongestSide}, wanted 100)`,
  },
  {
    ok: result.tinyRefused === "too-small",
    say: `a picture under 200 px is refused as too small (spec 4.6 #2) (${result.tinyRefused})`,
  },
];

let failed = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  console.log(`${c.ok ? "✓" : "✗"} ${c.say}`);
}
console.log(`  (${result.inputBytes} bytes in, ${result.outputBytes} bytes out)`);

if (failed > 0) {
  console.error(`\nPhoto preparation check FAILED: ${failed} of ${checks.length}`);
  process.exit(1);
}
console.log(`\nPhoto preparation check passed: all ${checks.length} checks.`);
