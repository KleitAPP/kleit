/**
 * Checks the perceptual fingerprint does the one thing it is for (roadmap M2.5, spec 13.1 #5):
 * recognise the same picture after it has been re-saved, resized or brightened, and NOT recognise
 * a different one. Runs on every push, because a fingerprint that quietly stops matching lets a
 * removed image back in and nothing else in the system would notice.
 *
 * The images are drawn here rather than loaded from files so the check has no fixtures to rot.
 */
import { fingerprint, distance, SAME_PICTURE } from "../supabase/functions/_shared/fingerprint.ts";

type Draw = (x: number, y: number, w: number, h: number) => [number, number, number];

function make(width: number, height: number, draw: Draw): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = draw(x, y, width, height);
      const at = (y * width + x) * 4;
      pixels[at] = r;
      pixels[at + 1] = g;
      pixels[at + 2] = b;
      pixels[at + 3] = 255;
    }
  }
  return pixels;
}

// A photo-ish thing: a bright blob off-centre on a gradient, so it has real structure.
const photo: Draw = (x, y, w, h) => {
  const dx = x / w - 0.62;
  const dy = y / h - 0.38;
  const blob = Math.exp(-(dx * dx + dy * dy) * 26) * 200;
  const base = 40 + (x / w) * 90 + (y / h) * 40;
  return [Math.min(255, base + blob), Math.min(255, base * 0.8 + blob), Math.min(255, base * 0.6 + blob)];
};

// A different photo: the same kind of thing, somewhere else, the other way up.
const other: Draw = (x, y, w, h) => {
  const dx = x / w - 0.2;
  const dy = y / h - 0.8;
  const blob = Math.exp(-(dx * dx + dy * dy) * 30) * 210;
  const base = 150 - (x / w) * 100 - (y / h) * 30;
  return [Math.max(0, base + blob), Math.max(0, base + blob * 0.7), Math.max(0, base * 1.1)];
};

const brighter: Draw = (x, y, w, h) => {
  const [r, g, b] = photo(x, y, w, h);
  return [Math.min(255, r + 28), Math.min(255, g + 28), Math.min(255, b + 28)];
};

// Recompression: nudge every pixel a little, the way a lossy encoder does.
const requantised: Draw = (x, y, w, h) => {
  const [r, g, b] = photo(x, y, w, h);
  const wobble = ((x * 7 + y * 13) % 11) - 5;
  return [Math.min(255, Math.max(0, r + wobble)), Math.min(255, Math.max(0, g + wobble)), Math.min(255, Math.max(0, b + wobble))];
};

const cases: { name: string; a: { w: number; h: number; d: Draw }; b: { w: number; h: number; d: Draw }; same: boolean }[] = [
  { name: "the same file twice", a: { w: 400, h: 300, d: photo }, b: { w: 400, h: 300, d: photo }, same: true },
  { name: "the same photo at half the size", a: { w: 400, h: 300, d: photo }, b: { w: 200, h: 150, d: photo }, same: true },
  { name: "the same photo at four times the size", a: { w: 400, h: 300, d: photo }, b: { w: 1600, h: 1200, d: photo }, same: true },
  { name: "the same photo brightened", a: { w: 400, h: 300, d: photo }, b: { w: 400, h: 300, d: brighter }, same: true },
  { name: "the same photo saved again as a lossy JPEG", a: { w: 400, h: 300, d: photo }, b: { w: 400, h: 300, d: requantised }, same: true },
  { name: "a different photo", a: { w: 400, h: 300, d: photo }, b: { w: 400, h: 300, d: other }, same: false },
  { name: "a different photo, resized", a: { w: 400, h: 300, d: photo }, b: { w: 900, h: 600, d: other }, same: false },
];

let failed = 0;
for (const c of cases) {
  const a = fingerprint(make(c.a.w, c.a.h, c.a.d), c.a.w, c.a.h);
  const b = fingerprint(make(c.b.w, c.b.h, c.b.d), c.b.w, c.b.h);
  const d = distance(a, b);
  const matched = d <= SAME_PICTURE;
  const ok = matched === c.same;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${c.name}: distance ${d} → ${matched ? "same picture" : "different"} (wanted ${c.same ? "same" : "different"})`);
}

// A fingerprint is 16 hex characters, always. A shorter one would silently compare as closer.
const len = fingerprint(make(50, 50, photo), 50, 50).length;
if (len !== 16) {
  console.log(`✗ a fingerprint should be 16 characters, got ${len}`);
  failed++;
} else {
  console.log("✓ a fingerprint is always 16 characters");
}

if (failed > 0) {
  console.error(`\nFingerprint check FAILED: ${failed} of ${cases.length + 1}`);
  process.exit(1);
}
console.log(`\nFingerprint check passed: all ${cases.length + 1} cases.`);
