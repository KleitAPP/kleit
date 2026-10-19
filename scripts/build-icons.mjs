/**
 * The app icons and launch screens, generated from the mark (roadmap M8.7; project rule: every
 * icon is generated from `src/brand/kleit-mark.svg`, never drawn twice).
 *
 *   node scripts/build-icons.mjs
 *
 * Needs `sharp` (not a project dependency: `npm i -g sharp`, or run it where sharp is present).
 * The PNGs it writes are committed, so the build never needs it; run it again only when the
 * mark or the colours change, and commit what changes.
 *
 * What it makes:
 *   web     public/favicon.ico (16/32/48, the small mark), public/favicon.svg (the small mark,
 *           light and dark), public/apple-touch-icon.png (180), public/icon-192.png,
 *           public/icon-512.png, public/icon-512-maskable.png and public/manifest.webmanifest
 *           (spec 19 #11); extension/icons/icon-*.png
 *           `node scripts/build-icons.mjs --web` writes the web files only.
 *   iOS     Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png (1024, opaque - Apple's rule)
 *           Assets.xcassets/Splash.imageset/splash-2732x2732*.png
 *   Android mipmap-<density>/ic_launcher_foreground.png (the adaptive layer; the mark inside the safe
 *           circle), mipmap-<density>/ic_launcher.png and ic_launcher_round.png (older launchers),
 *           values/ic_launcher_background.xml (the colour behind the layer),
 *           drawable-<density>/splash.png + drawable/splash_window.xml + values/splash.xml
 *           (the launch window)
 *
 * The icon is the mark in white on the Studio accent (#C0442B): the one brand-coloured thing in
 * the app, and the only surface that reads at 48 px among a hundred other icons. The launch
 * screen is the mark in ink on the paper canvas (#FAF9F7), the first screen's own colours, so
 * the app does not flash a different colour before it is up - and in dark mode the dark canvas
 * with the light ink, for the same reason (values-night, drawable-night, the -dark appearance).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

// sharp from the project if it is there, else from a global install named by SHARP_HOME
// (a directory; e.g. SHARP_HOME=/usr/local/lib/node_modules_global).
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  const home = process.env.SHARP_HOME;
  if (!home)
    throw new Error(
      "sharp is not installed; npm i -g sharp and set SHARP_HOME to its node_modules dir",
    );
  sharp = createRequire(join(home, "x.js"))("sharp");
}

const ROOT = new URL("..", import.meta.url).pathname;
const MARK = readFileSync(join(ROOT, "src/brand/kleit-mark.svg"), "utf8");
// The mark's drawing, without its own <svg> wrapper, in a literal colour.
const inner = (colour) =>
  MARK.replace(/^[\s\S]*?<defs>/, "<defs>")
    .replace(/<\/svg>\s*$/, "")
    .replaceAll("currentColor", colour)
    .replaceAll("kleit-mark-pin", "pin");
const MARK_W = 104;
const MARK_H = 140;
// The small variant (pin filled in, strokes fattened) for 24 px and below: the favicon.
const MARK_SMALL = readFileSync(join(ROOT, "src/brand/kleit-mark-small.svg"), "utf8");
const innerSmall = (colour) =>
  MARK_SMALL.replace(/^[\s\S]*?<g /, "<g ")
    .replace(/<\/svg>\s*$/, "")
    .replaceAll("currentColor", colour);
const WEB_ONLY = process.argv.includes("--web");

const ACCENT = "#C0442B";
const PAPER = "#FAF9F7";
const INK = "#161513";
// Dark mode's canvas and ink (src/theme/kleit-theme.css), for the night launch window.
const PAPER_DARK = "#151412";
const INK_DARK = "#F2F0EB";

/** A square picture: the mark, `markHeight` tall, centred on a flat colour (or on nothing). */
function picture(size, markHeight, colour, background, small = false) {
  const k = markHeight / MARK_H;
  const w = MARK_W * k;
  const x = (size - w) / 2;
  const y = (size - markHeight) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ""}
<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(5)})">${small ? innerSmall(colour) : inner(colour)}</g>
</svg>`;
}

/** An .ico holding PNG frames (every current browser reads PNG inside ICO): 6-byte header, one 16-byte entry per frame, then the frames. */
function ico(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = 6 + 16 * frames.length;
  for (const { size, data } of frames) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // colours in palette: none
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.data)]);
}

async function png(svg, path) {
  mkdirSync(join(path, ".."), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(path);
  console.log("wrote", path.replace(ROOT, ""));
}

// The web (spec 19 #11): the tab's favicon - the small mark on the accent, as an .ico of three
// PNG frames for every browser and as an SVG that follows light and dark for the ones that read
// it - the home-screen icon phones use when the site is added to a home screen, the manifest
// icons (one maskable, the mark inside the safe circle like Android's adaptive layer), and the
// manifest itself. Until 2026-10-19 favicon.ico was still the generator's gradient heart.
{
  const frames = [];
  for (const size of [16, 32, 48]) {
    const data = await sharp(
      Buffer.from(picture(size, Math.round(size * 0.68), "#FFFFFF", ACCENT, true)),
    )
      .png()
      .toBuffer();
    frames.push({ size, data });
  }
  writeFileSync(join(ROOT, "public/favicon.ico"), ico(frames));
  console.log("wrote public/favicon.ico");
  // The SVG favicon: the mark in ink on nothing, light and dark by the browser's setting.
  const k = 18 / MARK_H;
  const x = (24 - MARK_W * k) / 2;
  writeFileSync(
    join(ROOT, "public/favicon.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
<style>:root{color:${INK}}@media (prefers-color-scheme:dark){:root{color:${INK_DARK}}}</style>
<g transform="translate(${x.toFixed(2)} 3) scale(${k.toFixed(5)})">${innerSmall("currentColor")}</g>
</svg>
`,
  );
  console.log("wrote public/favicon.svg");
}
await png(picture(180, 106, "#FFFFFF", ACCENT), join(ROOT, "public/apple-touch-icon.png"));
await png(picture(192, 112, "#FFFFFF", ACCENT), join(ROOT, "public/icon-192.png"));
await png(picture(512, 300, "#FFFFFF", ACCENT), join(ROOT, "public/icon-512.png"));
await png(picture(512, 246, "#FFFFFF", ACCENT), join(ROOT, "public/icon-512-maskable.png"));
writeFileSync(
  join(ROOT, "public/manifest.webmanifest"),
  JSON.stringify(
    {
      name: "Kleit",
      short_name: "Kleit",
      description: "Put an outfit together and send it to friends to vote on.",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: PAPER,
      theme_color: PAPER,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log("wrote public/manifest.webmanifest");
if (WEB_ONLY) process.exit(0);

// The browser extension's icons (M9.1): the same icon at the four sizes Chrome asks for.
for (const size of [16, 32, 48, 128]) {
  await png(
    picture(size, Math.round(size * 0.58), "#FFFFFF", ACCENT),
    join(ROOT, `extension/icons/icon-${size}.png`),
  );
}

// iOS: one 1024 icon, opaque.
await png(
  picture(1024, 600, "#FFFFFF", ACCENT),
  join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"),
);

// Android adaptive icon: the foreground layer is 108 dp with the visible safe circle at 66 dp,
// so the mark sits well inside it; the background is the flat accent (values/ic_launcher_background.xml).
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, scale] of Object.entries(DENSITIES)) {
  const dir = join(ROOT, `android/app/src/main/res/mipmap-${name}`);
  await png(
    picture(108 * scale, 52 * scale, "#FFFFFF", null),
    join(dir, "ic_launcher_foreground.png"),
  );
  // Older launchers draw these as they are: the full icon, square and round (the launcher rounds it).
  await png(picture(48 * scale, 28 * scale, "#FFFFFF", ACCENT), join(dir, "ic_launcher.png"));
  await png(picture(48 * scale, 28 * scale, "#FFFFFF", ACCENT), join(dir, "ic_launcher_round.png"));
}
writeFileSync(
  join(ROOT, "android/app/src/main/res/values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ACCENT}</color>\n</resources>\n`,
);

// Launch screens: the mark in ink on paper, the first screen's own colours.
//
// Android draws the launch window from drawable/splash_window.xml: the paper colour, and the
// mark centred at its own size - never a square picture stretched to the window, which is what
// a plain bitmap as `android:background` becomes. The mark is 120 dp tall, one PNG per density.
// Android 12+ shows its own launch screen first (the app icon on `windowSplashScreenBackground`,
// also paper; styles.xml).
for (const [name, scale] of Object.entries(DENSITIES)) {
  await png(
    picture(140 * scale, 120 * scale, INK, null),
    join(ROOT, `android/app/src/main/res/drawable-${name}/splash.png`),
  );
  await png(
    picture(140 * scale, 120 * scale, INK_DARK, null),
    join(ROOT, `android/app/src/main/res/drawable-night-${name}/splash.png`),
  );
}
await png(picture(140, 120, INK, null), join(ROOT, "android/app/src/main/res/drawable/splash.png"));
await png(
  picture(140, 120, INK_DARK, null),
  join(ROOT, "android/app/src/main/res/drawable-night/splash.png"),
);
writeFileSync(
  join(ROOT, "android/app/src/main/res/drawable/splash_window.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<!-- The launch window (scripts/build-icons.mjs): paper, and the mark centred at its own size. -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splash_background"/>
    <item>
        <bitmap android:src="@drawable/splash" android:gravity="center"/>
    </item>
</layer-list>
`,
);
writeFileSync(
  join(ROOT, "android/app/src/main/res/values/splash.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="splash_background">${PAPER}</color>\n</resources>\n`,
);
mkdirSync(join(ROOT, "android/app/src/main/res/values-night"), { recursive: true });
writeFileSync(
  join(ROOT, "android/app/src/main/res/values-night/splash.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="splash_background">${PAPER_DARK}</color>\n</resources>\n`,
);

// iOS: one square image set, drawn aspect-fill by LaunchScreen.storyboard, so the paper fills
// any screen and the centred mark stays whole.
const splash = picture(2732, 420, INK, PAPER);
const splashDark = picture(2732, 420, INK_DARK, PAPER_DARK);
const SPLASH_FILES = [
  ["splash-2732x2732-2.png", "1x"],
  ["splash-2732x2732-1.png", "2x"],
  ["splash-2732x2732.png", "3x"],
];
for (const [name] of SPLASH_FILES) {
  await png(splash, join(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset", name));
  await png(
    splashDark,
    join(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset", name.replace(".png", "-dark.png")),
  );
}
// The image set's own index: the same picture per scale, with a dark appearance for each.
writeFileSync(
  join(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset/Contents.json"),
  JSON.stringify(
    {
      images: SPLASH_FILES.flatMap(([filename, scale]) => [
        { idiom: "universal", filename, scale },
        {
          idiom: "universal",
          filename: filename.replace(".png", "-dark.png"),
          scale,
          appearances: [{ appearance: "luminosity", value: "dark" }],
        },
      ]),
      info: { version: 1, author: "xcode" },
    },
    null,
    2,
  ) + "\n",
);
