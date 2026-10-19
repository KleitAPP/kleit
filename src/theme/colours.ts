import css from "./kleit-theme.css?raw";

/**
 * The two canvas colours, read from the theme file itself at build time, for the one place a
 * colour has to be written as a value rather than a class: the browser's `theme-color` meta
 * (spec 19 #11), which cannot read a CSS variable. The theme stays the single source of truth
 * (spec 2.1 #16), and scripts/check-theme.mjs still finds no colour named on a screen.
 */
function canvas(afterMarker: string): string {
  const from = css.indexOf(afterMarker);
  const m = /--kl-color-canvas:\s*(#[0-9a-fA-F]{6})/.exec(css.slice(from < 0 ? 0 : from));
  return m?.[1] ?? "#FFFFFF";
}

export const CANVAS_LIGHT = canvas("---- Light");
export const CANVAS_DARK = canvas("---- Dark");
