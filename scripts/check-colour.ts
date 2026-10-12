/**
 * Proves the colour naming (spec 4.4 #4, 9 #1; `supabase/functions/_shared/colour.ts`) with no
 * pictures: the bands that turn one pixel into one of sixteen words, and the vote that turns a
 * whole picture into one - the middle of the picture, see-through pixels skipped, a pale backdrop
 * handing over to the garment on it. The phone and the clipper share this file, so a change
 * that renames navy to blue is caught here before it splits the two.
 *
 * Run: bun scripts/check-colour.ts   (CI runs it on every push)
 */
import {
  COLOUR_NAMES,
  dominantColour,
  isColourName,
  nameOf,
  type ColourName,
} from "../supabase/functions/_shared/colour.ts";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ← ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

// 1. One pixel, one word: a swatch per name, in the colours a store photo really has.
const pixels: Array<[string, [number, number, number], ColourName]> = [
  ["ink black", [20, 20, 22], "black"],
  ["charcoal", [40, 40, 44], "black"],
  ["paper white", [250, 250, 250], "white"],
  ["off-white", [238, 238, 236], "white"],
  ["mid grey", [128, 128, 128], "grey"],
  ["heather grey", [160, 158, 164], "grey"],
  ["cream", [245, 236, 214], "cream"],
  ["ivory", [255, 248, 230], "cream"],
  ["chocolate brown", [92, 60, 36], "brown"],
  ["chestnut", [120, 72, 40], "brown"],
  ["camel tan", [196, 160, 112], "tan"],
  ["sand", [214, 190, 150], "tan"],
  ["red", [200, 30, 40], "red"],
  ["burgundy", [120, 20, 40], "red"],
  ["pink", [240, 160, 190], "pink"],
  ["hot pink", [230, 60, 140], "pink"],
  ["orange", [235, 120, 30], "orange"],
  ["rust", [180, 80, 30], "orange"],
  ["yellow", [240, 205, 40], "yellow"],
  ["mustard", [205, 165, 40], "yellow"],
  ["grass green", [60, 150, 70], "green"],
  ["emerald", [20, 130, 90], "green"],
  ["olive", [100, 108, 50], "olive"],
  ["khaki green", [90, 96, 56], "olive"],
  ["teal", [40, 140, 140], "teal"],
  ["blue", [50, 110, 200], "blue"],
  ["sky blue", [130, 180, 230], "blue"],
  ["navy", [25, 35, 85], "navy"],
  ["purple", [120, 70, 170], "purple"],
  ["lavender", [190, 170, 220], "purple"],
];
for (const [label, [r, g, b], want] of pixels) {
  const got = nameOf(r, g, b);
  check(`pixel: ${label} is ${want}`, got === want, got);
}
check(
  "names: sixteen, each a colour name",
  COLOUR_NAMES.length === 16 && COLOUR_NAMES.every(isColourName),
);
check("names: a stranger is not one", !isColourName("ultramarine") && !isColourName(3));

// 2. A picture: width × height pixels, painted by a function of (x, y).
function picture(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y);
      const at = (y * width + x) * 4;
      out[at] = r;
      out[at + 1] = g;
      out[at + 2] = b;
      out[at + 3] = a;
    }
  }
  return out;
}
const RED: [number, number, number, number] = [200, 30, 40, 255];
const WHITE: [number, number, number, number] = [250, 250, 250, 255];
const NAVY: [number, number, number, number] = [25, 35, 85, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

check(
  "picture: a flat red square is red",
  dominantColour(
    picture(40, 40, () => RED),
    40,
    40,
  ) === "red",
);
check(
  "picture: a red coat on a white backdrop is red (the backdrop wins the vote and hands over)",
  dominantColour(
    picture(100, 100, (x, y) => (x >= 35 && x < 65 && y >= 20 && y < 80 ? RED : WHITE)),
    100,
    100,
  ) === "red",
);
check(
  "picture: a white shirt on a white backdrop is white (no real runner-up)",
  dominantColour(
    picture(100, 100, (x, y) => (x === 50 && y === 50 ? RED : WHITE)),
    100,
    100,
  ) === "white",
);
check(
  "picture: a cutout counts only its own pixels, not the see-through around it",
  dominantColour(
    picture(100, 100, (x, y) => (x >= 45 && x < 55 && y >= 45 && y < 55 ? NAVY : CLEAR)),
    100,
    100,
  ) === "navy",
);
check(
  "picture: the border is not read - a navy frame around a red middle is red",
  dominantColour(
    picture(100, 100, (x, y) => (x < 20 || x >= 80 || y < 20 || y >= 80 ? NAVY : RED)),
    100,
    100,
  ) === "red",
);
check(
  "picture: nothing to read is null",
  dominantColour(
    picture(10, 10, () => CLEAR),
    10,
    10,
  ) === null,
);
check("picture: too few bytes is null", dominantColour(new Uint8ClampedArray(8), 10, 10) === null);
check("picture: no size is null", dominantColour(new Uint8ClampedArray(0), 0, 0) === null);
check(
  "picture: a big one is sampled, not read whole, and still right",
  dominantColour(
    picture(900, 900, (x, y) => (x >= 300 && x < 600 && y >= 200 && y < 700 ? RED : WHITE)),
    900,
    900,
  ) === "red",
);
check(
  "picture: a plain Uint8Array is read the same way",
  dominantColour(new Uint8Array(picture(20, 20, () => NAVY)), 20, 20) === "navy",
);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log(`\nColour check passed (${pixels.length + 12} checks)`);
