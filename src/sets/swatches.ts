/**
 * The Quick builder's background swatches (spec 5.1 #6: "about six").
 *
 * These are fixed colours written INTO the set, on purpose, and this is the one place in the
 * app where a colour is spelled out rather than taken from the theme. A set is the person's
 * finished artwork: the background they chose must be the same for every viewer, in light and
 * dark mode, and in the exported picture (lesson L14). A theme token would change under them.
 *
 * Six paper-like tones plus one true white and one true black, so the plain choices are there.
 */
export const SWATCHES: ReadonlyArray<{ id: string; hex: string; name: string }> = [
  { id: "paper", hex: "#F4EFE6", name: "Paper" },
  { id: "white", hex: "#FFFFFF", name: "White" },
  { id: "blush", hex: "#F3DCD4", name: "Blush" },
  { id: "sage", hex: "#DDE5D6", name: "Sage" },
  { id: "sky", hex: "#D9E4EE", name: "Sky" },
  { id: "sand", hex: "#E9DCC3", name: "Sand" },
  { id: "ink", hex: "#1F1D1A", name: "Ink" },
];

export function swatchByHex(hex: string) {
  return SWATCHES.find((s) => s.hex.toLowerCase() === hex.toLowerCase()) ?? SWATCHES[0]!;
}

/** Text that reads on the given background: dark on light, light on dark. Never colour alone, so a tag also carries words. */
export function inkFor(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 140 ? "#1F1D1A" : "#F4EFE6";
}
