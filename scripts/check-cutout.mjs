/**
 * Proves the cutout editor's logic (roadmap M2.6; spec 4.4 #3, #6) in a real browser, because a
 * mask is a canvas and a canvas only exists in one.
 *
 * What is proven, each against the real module bundled out of src/photos/cutout.ts:
 *   1. An untouched cutout is the photo, pixel for pixel, and finishes as JPEG.
 *   2. An erase stroke makes exactly that area transparent and nothing else.
 *   3. Restore over the erased area puts the photo back.
 *   4. Undo is exact: after erase + undo, the mask is byte-identical to the start.
 *   5. Reset after several strokes is byte-identical to the start.
 *   6. Anything cut away finishes as a transparent PNG; the PNG really carries the hole.
 *   7. The photo itself is never painted on.
 *   8. A starting mask from the phone (M8.3): the cutout begins from it, not from "keep all";
 *      restore can bring back what the phone cut; Reset goes back to the phone's mask; and the
 *      result is a transparent PNG even with no strokes.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import pw from "playwright";

const { chromium } = pw;

execFileSync(
  "npx",
  [
    "esbuild",
    "src/photos/cutout.ts",
    "--bundle",
    "--format=iife",
    "--global-name=KleitCutout",
    "--outfile=/tmp/kleit-cutout.js",
  ],
  { stdio: "inherit" },
);

const bundle = readFileSync("/tmp/kleit-cutout.js", "utf8");

const browser = await chromium.launch(
  process.env.KLEIT_CHROMIUM ? { executablePath: process.env.KLEIT_CHROMIUM } : {},
);
const page = await browser.newPage();
await page.goto("about:blank");
await page.addScriptTag({ content: bundle });

const result = await page.evaluate(async () => {
  const K = window.KleitCutout;

  // A 200x100 photo: left half red, right half blue. Opaque everywhere.
  const source = document.createElement("canvas");
  source.width = 200;
  source.height = 100;
  const g = source.getContext("2d");
  g.fillStyle = "rgb(255,0,0)";
  g.fillRect(0, 0, 100, 100);
  g.fillStyle = "rgb(0,0,255)";
  g.fillRect(100, 0, 100, 100);
  const sourceBytes = Array.from(g.getImageData(0, 0, 200, 100).data);

  const alphaAt = (canvas, x, y) => canvas.getContext("2d").getImageData(x, y, 1, 1).data[3];
  const maskBytes = (cutout) =>
    Array.from(cutout.mask.getContext("2d").getImageData(0, 0, 200, 100).data);
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  const cutout = K.startCutout(source);
  const startMask = maskBytes(cutout);

  // 1. Untouched.
  const untouched = K.renderCutout(cutout);
  const untouchedBytes = Array.from(untouched.getContext("2d").getImageData(0, 0, 200, 100).data);
  const untouchedIsPhoto = same(untouchedBytes, sourceBytes);
  const untouchedType = (await K.finishCutout(cutout)).type;

  // 2. Erase a dot in the middle of the red half.
  K.addStroke(cutout, { brush: "erase", size: 20, points: [{ x: 50, y: 50 }] });
  const afterErase = K.renderCutout(cutout);
  const erasedCentre = alphaAt(afterErase, 50, 50);
  const untouchedFarAway = alphaAt(afterErase, 150, 50);
  const untouchedNearEdge = alphaAt(afterErase, 50, 20);

  // 3. Restore over it.
  K.addStroke(cutout, { brush: "restore", size: 30, points: [{ x: 50, y: 50 }] });
  const restoredCentre = alphaAt(K.renderCutout(cutout), 50, 50);

  // 4. Undo the restore, then undo the erase: back to the start exactly.
  K.undoStroke(cutout);
  const afterUndoRestore = alphaAt(K.renderCutout(cutout), 50, 50);
  K.undoStroke(cutout);
  const undoIsExact = same(maskBytes(cutout), startMask);

  // 5. Several strokes, then reset.
  K.addStroke(cutout, {
    brush: "erase",
    size: 10,
    points: [
      { x: 10, y: 10 },
      { x: 190, y: 90 },
    ],
  });
  K.addStroke(cutout, { brush: "erase", size: 40, points: [{ x: 150, y: 50 }] });
  K.addStroke(cutout, { brush: "restore", size: 10, points: [{ x: 150, y: 50 }] });
  const strokesBeforeReset = cutout.strokes.length;
  K.resetCutout(cutout);
  const resetIsExact = same(maskBytes(cutout), startMask) && cutout.strokes.length === 0;

  // 6. A cut finishes as PNG, and the PNG really has the hole.
  K.addStroke(cutout, { brush: "erase", size: 20, points: [{ x: 50, y: 50 }] });
  const finished = await K.finishCutout(cutout);
  const bitmap = await createImageBitmap(finished.blob);
  const check = document.createElement("canvas");
  check.width = bitmap.width;
  check.height = bitmap.height;
  check.getContext("2d").drawImage(bitmap, 0, 0);
  const pngHoleAlpha = alphaAt(check, 50, 50);
  const pngKeptAlpha = alphaAt(check, 150, 50);

  // 7. The source was never painted on.
  const sourceUntouched = same(Array.from(g.getImageData(0, 0, 200, 100).data), sourceBytes);

  // 8. The phone's cutout as the starting mask: the left half gone, the right half kept.
  const base = document.createElement("canvas");
  base.width = 200;
  base.height = 100;
  const bg = base.getContext("2d");
  bg.fillStyle = "#000";
  bg.fillRect(100, 0, 100, 100);
  const withBase = K.startCutout(source, base);
  const baseLeftGone = alphaAt(K.renderCutout(withBase), 50, 50);
  const baseRightKept = alphaAt(K.renderCutout(withBase), 150, 50);
  const baseNeedsPng = K.hasCutAnything(withBase) === true;
  const baseFinishedType = (await K.finishCutout(withBase)).type;
  K.addStroke(withBase, { brush: "restore", size: 30, points: [{ x: 50, y: 50 }] });
  const baseRestored = alphaAt(K.renderCutout(withBase), 50, 50);
  K.resetCutout(withBase);
  const baseAfterReset = alphaAt(K.renderCutout(withBase), 50, 50);
  // A mask of the wrong size is ignored, never stretched over the photo.
  const wrong = document.createElement("canvas");
  wrong.width = 10;
  wrong.height = 10;
  const wrongSizeIgnored = K.startCutout(source, wrong).base === null;

  return {
    baseLeftGone,
    baseRightKept,
    baseNeedsPng,
    baseFinishedType,
    baseRestored,
    baseAfterReset,
    wrongSizeIgnored,
    untouchedIsPhoto,
    untouchedType,
    erasedCentre,
    untouchedFarAway,
    untouchedNearEdge,
    restoredCentre,
    afterUndoRestore,
    undoIsExact,
    strokesBeforeReset,
    resetIsExact,
    finishedType: finished.type,
    pngHoleAlpha,
    pngKeptAlpha,
    sourceUntouched,
  };
});

await browser.close();

const checks = [
  ["an untouched cutout is the photo, pixel for pixel", result.untouchedIsPhoto === true],
  ["an untouched cutout finishes as JPEG", result.untouchedType === "image/jpeg"],
  ["erase makes the stroked area transparent", result.erasedCentre === 0],
  [
    "erase leaves the rest of the photo alone",
    result.untouchedFarAway === 255 && result.untouchedNearEdge === 255,
  ],
  ["restore puts the photo back", result.restoredCentre === 255],
  ["undo takes back exactly one stroke", result.afterUndoRestore === 0],
  ["undo is exact - the mask is byte-identical to the start", result.undoIsExact === true],
  [
    "reset after several strokes is byte-identical to the start",
    result.strokesBeforeReset === 3 && result.resetIsExact === true,
  ],
  ["a cut finishes as PNG", result.finishedType === "image/png"],
  [
    "the PNG really carries the hole, and only the hole",
    result.pngHoleAlpha === 0 && result.pngKeptAlpha === 255,
  ],
  ["the photo itself is never painted on", result.sourceUntouched === true],
  [
    "the phone's mask is the starting point: its cut is gone, its kept part is kept",
    result.baseLeftGone === 0 && result.baseRightKept === 255,
  ],
  [
    "a phone cutout finishes as a transparent PNG even with no strokes",
    result.baseNeedsPng === true && result.baseFinishedType === "image/png",
  ],
  ["restore brings back what the phone cut", result.baseRestored === 255],
  ["reset goes back to the phone's mask, not to the whole photo", result.baseAfterReset === 0],
  ["a mask of the wrong size is ignored", result.wrongSizeIgnored === true],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}
console.log(JSON.stringify(result));
if (failed) {
  console.error(`\n${failed} cutout check(s) failed`);
  process.exit(1);
}
console.log(`\nCutout check passed: ${checks.length} of ${checks.length}`);
