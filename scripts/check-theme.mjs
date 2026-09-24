#!/usr/bin/env node
// Kleit theme guard (roadmap M1.3 "Done when"; spec 2.1 #16; design pack §8.3 #2, §10.4).
//  1. No screen or Kleit component names a colour, font or size directly — only theme settings.
//  2. Every text colour passes 4.5:1 on canvas, surface and surface-2, in light AND dark.
// Run: node scripts/check-theme.mjs   (exits 1 on any failure; CI runs it on every push)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/routes", "src/screens", "src/app", "src/components/kleit", "src/brand"];
const SKIP = [/routeTree\.gen\.ts$/, /\.svg$/, /README\.md$/];
const RULES = [
  [/#[0-9a-fA-F]{3,8}\b(?![\w-])/g, "hex colour"],
  [/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/g, "colour function"],
  [/\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/g, "Tailwind palette colour"],
  [/-\[(?:#|rgb|hsl|oklch)[^\]]*\]/g, "arbitrary colour value"],
  [/\b(?:text|leading|tracking|rounded|p[trblxy]?|m[trblxy]?|gap|w|h|size|min-w|min-h|max-w|max-h|top|left|right|bottom|inset)-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g, "arbitrary size value"],
  [/font-family\s*:/g, "font-family"],
  [/fontFamily\s*:/g, "fontFamily"],
];

function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|css)$/.test(p) && !SKIP.some((re) => re.test(p))) out.push(p);
  }
  return out;
}

let failures = 0;
for (const file of ROOTS.flatMap((r) => walk(r))) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").replace(/\{\/\*.*?\*\/\}/g, "");
    if (/^\s*(\*|\/\*)/.test(line)) return; // comment lines
    for (const [re, what] of RULES) {
      for (const m of code.matchAll(re)) {
        console.error(`✗ ${file}:${i + 1}  ${what}: ${m[0]}`);
        failures++;
      }
    }
  });
}

// ---- contrast ----
const css = readFileSync("src/theme/kleit-theme.css", "utf8");
function block(selector) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`theme block not found: ${selector}`);
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  const vars = {};
  for (const m of css.slice(open, close).matchAll(/(--kl-color-[\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)) vars[m[1]] = m[2];
  return vars;
}
const light = block(':root,\n[data-theme="light"]');
const dark = { ...light, ...block('[data-theme="dark"] {') };
const lum = (hex) => {
  const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const TEXT = ["ink", "ink-soft", "brand", "positive", "warning", "danger"];
const GROUNDS = ["canvas", "surface", "surface-2"];
for (const [name, t] of [["light", light], ["dark", dark]]) {
  const pairs = TEXT.flatMap((fg) => GROUNDS.map((bg) => [fg, bg]));
  pairs.push(["brand-ink", "brand"]);
  for (const [fg, bg] of pairs) {
    const r = ratio(t[`--kl-color-${fg}`], t[`--kl-color-${bg}`]);
    const ok = r >= 4.5;
    if (!ok) failures++;
    console.log(`${ok ? "✓" : "✗"} ${name.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)}:1`);
  }
}

if (failures) { console.error(`\n${failures} theme problem(s).`); process.exit(1); }
console.log("\nTheme check passed: no hard-coded colours, fonts or sizes; every text colour ≥ 4.5:1 in both themes.");
