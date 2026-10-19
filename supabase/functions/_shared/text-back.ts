/**
 * What sits behind the words of a text layer (spec 21 #6): a set's background is the owner's
 * and unpredictable, so the text tool puts a scrim behind new words by default, and offers a
 * solid strip and a blur as presets. The numbers live here once, because three things draw a
 * text layer - the canvas (Konva), the shared page (HTML) and the chat picture (imagescript) -
 * and they must agree to the pixel. Pure TypeScript: no DOM, no Deno.
 *
 *   - the tone follows the words: light words get a dark backing, dark words a light one, so
 *     the contrast is at least 4.5:1 over any picture (WCAG 1.4.3)
 *   - the padding and the corner radius scale with the font size, like the words
 *   - "none" is what every text layer saved before this existed reads as (L14: nothing placed
 *     changes later); a new layer starts as "scrim"
 */

export const TEXT_BACKS = ["none", "scrim", "strip", "blur"] as const;
export type TextBack = (typeof TEXT_BACKS)[number];

export function isTextBack(value: unknown): value is TextBack {
  return typeof value === "string" && (TEXT_BACKS as readonly string[]).includes(value);
}

/** The backing a saved style asks for; anything unknown or missing is "none". */
export function textBackOf(value: unknown): TextBack {
  return isTextBack(value) ? value : "none";
}

/** Fractions of the font size. */
export const BACKING = {
  padX: 0.4,
  padY: 0.22,
  radius: 0.28,
  /** The blur's radius, also of the font size (a 48 px face blurs by about 14 px). */
  blur: 0.3,
} as const;

export type Tone = "dark" | "light";

/** Relative luminance of a #rrggbb colour (sRGB, WCAG's formula); 0 for anything unreadable. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

/** Light words want a dark backing; dark words a light one. */
export function backingTone(textColour: string): Tone {
  return luminance(textColour) > 0.4 ? "dark" : "light";
}

/** The backing's colour as [r, g, b, alpha 0..1]; null for "none". */
export function backingRgba(back: TextBack, tone: Tone): [number, number, number, number] | null {
  const dark = tone === "dark";
  switch (back) {
    case "scrim":
      return dark ? [0, 0, 0, 0.6] : [255, 255, 255, 0.78];
    case "strip":
      return dark ? [22, 21, 19, 1] : [255, 255, 255, 1];
    case "blur":
      // A blur alone promises nothing about contrast; a light tint over it helps.
      return dark ? [0, 0, 0, 0.3] : [255, 255, 255, 0.42];
    default:
      return null;
  }
}

export function backingCss(back: TextBack, tone: Tone): string | null {
  const c = backingRgba(back, tone);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${c[3]})` : null;
}

/** The box behind words of a given size: padding on each side and the corner radius, in the same unit as the size. */
export function backingBox(size: number): {
  padX: number;
  padY: number;
  radius: number;
  blur: number;
} {
  return {
    padX: size * BACKING.padX,
    padY: size * BACKING.padY,
    radius: size * BACKING.radius,
    blur: size * BACKING.blur,
  };
}

/**
 * A separable box blur, run three times (close to a gaussian), on RGBA bytes in place. `radius`
 * is in pixels of the given width and height. Alpha is blurred with the colours.
 */
export function boxBlur(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.round(radius));
  if (r === 0 || width === 0 || height === 0) return;
  const scratch = new Float32Array(pixels.length);
  const pass = (
    from: ArrayLike<number>,
    to: Float32Array | Uint8Array | Uint8ClampedArray,
    horizontal: boolean,
  ) => {
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;
    const span = 2 * r + 1;
    const whole = !(to instanceof Float32Array);
    for (let o = 0; o < outer; o++) {
      const at = (i: number) => (horizontal ? (o * width + i) * 4 : (i * width + o) * 4);
      for (let ch = 0; ch < 4; ch++) {
        let sum = 0;
        for (let i = -r; i <= r; i++) sum += from[at(Math.min(inner - 1, Math.max(0, i))) + ch]!;
        for (let i = 0; i < inner; i++) {
          const v = sum / span;
          to[at(i) + ch] = whole ? Math.round(v) : v;
          const leaving = from[at(Math.max(0, i - r)) + ch]!;
          const entering = from[at(Math.min(inner - 1, i + r + 1)) + ch]!;
          sum += entering - leaving;
        }
      }
    }
  };
  for (let n = 0; n < 3; n++) {
    pass(pixels, scratch, true);
    pass(scratch, pixels, false);
  }
}
