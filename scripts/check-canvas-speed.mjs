/**
 * M4.1 — drives /dev/canvas-speed on the deployed test site and prints the numbers
 * (artwork pack §7.6). On a desktop this is the BASELINE, not the gate: the gate is the same
 * page run by hand on the older Android (OW5), and the cap in spec 6.1 #20 is set from that.
 * Fails only if the page itself cannot be driven, or if even the desktop misses a target -
 * which would mean the editor's design has a problem no phone can fix.
 *
 *   KLEIT_TEST_SITE, KLEIT_CHROMIUM (optional)
 */
import { chromium } from "playwright";

const SITE = process.env.KLEIT_TEST_SITE ?? "https://kleit-test.kleitapp-team.workers.dev";
const browser = await chromium.launch(
  process.env.KLEIT_CHROMIUM ? { executablePath: process.env.KLEIT_CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } });
page.setDefaultTimeout(30_000);
let failed = 0;
const rows = [];
try {
  await page.goto(`${SITE}/dev/canvas-speed`);
  await page.waitForFunction(() => typeof window.KleitSpeed?.run === "function");
  for (const pixelRatio of [1, 2]) {
    for (const kind of ["drawn", "raster"]) {
      for (const count of [50, 100, 150]) {
        const r = await page.evaluate(
          ([c, k, pr]) => window.KleitSpeed.run(c, k, pr),
          [count, kind, pixelRatio],
        );
        rows.push(r);
        const ok =
          r.passes.drag && r.passes.firstRender && r.passes.drawer && r.passes.heap !== false;
        if (!ok) failed += 1;
        console.log(
          `${ok ? "ok" : "not ok"} - ${count} ${kind} @${pixelRatio}: drag ${r.dragMedianMs}/${r.dragP95Ms} ms, first render ${r.firstRenderMs} ms, heap ${r.heapMb ?? "?"} MB, drawer ${r.drawerFirstPaintMs} ms`,
        );
      }
    }
  }
} catch (error) {
  failed += 1;
  console.log(
    `not ok - the page could not be driven: ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  await browser.close();
}
console.log(
  "| nodes | kind | pixelRatio | drag median / p95 ms | first render ms | heap MB | drawer ms |",
);
console.log("|---|---|---|---|---|---|---|");
for (const r of rows)
  console.log(
    `| ${r.count} | ${r.kind} | ${r.pixelRatio} | ${r.dragMedianMs} / ${r.dragP95Ms} | ${r.firstRenderMs} | ${r.heapMb ?? "?"} | ${r.drawerFirstPaintMs} |`,
  );
console.log(
  failed === 0
    ? "# canvas speed: every combination inside the targets on this machine"
    : `# canvas speed: ${failed} combination(s) outside the targets`,
);
process.exit(failed === 0 ? 0 : 1);
