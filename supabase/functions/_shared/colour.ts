/**
 * A colour name for a piece, read from its picture (spec 4.4 #4 "suggested name and colour on
 * upload", 9 #1 the colour filter, 21 #7 "colour names beside swatches"). One module for the
 * phone (the closet photo, read on the canvas before it leaves) and the server (`clip-url`, the
 * store picture after it is decoded), so both name the same pixels the same way.
 *
 * It is a guess, in sixteen plain words, and the person can change it. Pixels are mapped one by
 * one to the nearest name by hue, lightness and saturation, and the names vote; the vote is
 * taken from the middle of the picture and ignores what is see-through, so a cutout counts its
 * garment and a store shot counts the garment more than the backdrop. A pale backdrop that still
 * wins hands over to the runner-up when the runner-up is a real share of the picture.
 */

export const COLOUR_NAMES = [
  "black",
  "white",
  "grey",
  "cream",
  "brown",
  "tan",
  "red",
  "pink",
  "orange",
  "yellow",
  "green",
  "olive",
  "teal",
  "blue",
  "navy",
  "purple",
] as const;
export type ColourName = (typeof COLOUR_NAMES)[number];

/** A swatch for each name, for chips (the app never writes a colour itself; these are data). */
export const COLOUR_SWATCHES: Record<ColourName, string> = {
  black: "#1a1a1a",
  white: "#f7f7f7",
  grey: "#8a8a8a",
  cream: "#efe6d2",
  brown: "#6b4a2b",
  tan: "#c9a77c",
  red: "#c3272b",
  pink: "#e89ab8",
  orange: "#e07b2a",
  yellow: "#e5c232",
  green: "#3f8a4f",
  olive: "#6f7a3b",
  teal: "#2e8b8b",
  blue: "#3b6fc4",
  navy: "#1f2c5c",
  purple: "#7b4fa3",
};

export function isColourName(text: unknown): text is ColourName {
  return typeof text === "string" && (COLOUR_NAMES as readonly string[]).includes(text);
}

/** Hue 0–360, saturation and lightness 0–1, from 0–255 channels. */
function hsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = h * 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

/** The name for one pixel. */
export function nameOf(r: number, g: number, b: number): ColourName {
  const [h, s, l] = hsl(r, g, b);
  // How much colour there is at all (the spread of the channels, 0–1): saturation runs away
  // near white, so the pale zone is judged by this instead.
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  // Not enough colour to call it one: by lightness alone - with ivory told from white by its
  // warmth, since an ivory dress is not a white one.
  if (s < 0.12 || l < 0.1 || l > 0.94) {
    if (l < 0.19) return "black";
    if (l > 0.72 && chroma >= 0.08 && h >= 20 && h <= 70) return "cream";
    if (l > 0.9) return "white";
    return "grey";
  }
  // The warm low band: browns and tans before the hue bands claim them as orange or yellow.
  if (h >= 15 && h <= 50) {
    if (l < 0.42 && s < 0.6) return "brown";
    if (l >= 0.42 && l < 0.82 && s < 0.5) return "tan";
    if (l >= 0.82) return "cream";
  }
  if (h < 15 || h >= 345) return l > 0.72 ? "pink" : "red";
  if (h < 42) return "orange";
  if (h < 68) return l > 0.85 && s < 0.5 ? "cream" : "yellow";
  if (h < 165) return l < 0.38 && s < 0.55 ? "olive" : "green";
  if (h < 198) return "teal";
  if (h < 252) return l < 0.3 ? "navy" : "blue";
  if (h < 300) return "purple";
  return l > 0.45 ? "pink" : "purple";
}

/**
 * The name a whole picture votes for. `rgba` is the usual bytes, four per pixel, row by row;
 * only the middle 60% of the width and height is read, every third pixel, and anything
 * see-through is skipped. Null when nothing could be read.
 */
export function dominantColour(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): ColourName | null {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return null;
  const votes = new Map<ColourName, number>();
  const x0 = Math.floor(width * 0.2);
  const x1 = Math.ceil(width * 0.8);
  const y0 = Math.floor(height * 0.2);
  const y1 = Math.ceil(height * 0.8);
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 40000)));
  let counted = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const at = (y * width + x) * 4;
      if (rgba[at + 3]! < 128) continue;
      const name = nameOf(rgba[at]!, rgba[at + 1]!, rgba[at + 2]!);
      votes.set(name, (votes.get(name) ?? 0) + 1);
      counted += 1;
    }
  }
  if (counted === 0) return null;
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (!first) return null;
  // A pale backdrop that wins the vote is usually the backdrop: a real runner-up takes it (a
  // white shirt on a grey card comes out white this way, and a grey one on a white card grey).
  const backdrop = first[0] === "white" || first[0] === "cream" || first[0] === "grey";
  if (backdrop && second && second[1] >= counted * 0.22) return second[0];
  return first[0];
}
