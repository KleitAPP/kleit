/**
 * Proves the on-phone store and the network judgement (roadmap M8.5) in a real browser, because
 * IndexedDB only exists in one. Against the real modules bundled out of src/offline/.
 *
 *   1. A cached list comes back as it went in, with the time it was taken.
 *   2. A picture kept as bytes comes back as the same bytes.
 *   3. Edits queue in the order they were made, and leave the queue one at a time.
 *   4. The count is the count.
 *   5. A request that never reached the server is told apart from a refusal.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import pw from "playwright";

const { chromium } = pw;

// One entry file that re-exports both modules; esbuild follows the "@/..." paths through tsconfig.
writeFileSync(
  "/tmp/kleit-offline-entry.ts",
  `export * from "../home/claude/kleit/src/offline/store";\nexport * from "../home/claude/kleit/src/offline/net";\n`.replaceAll(
    "../home/claude/kleit/",
    `${process.cwd()}/`,
  ),
);
execFileSync(
  "npx",
  [
    "esbuild",
    "/tmp/kleit-offline-entry.ts",
    "--bundle",
    "--format=iife",
    "--global-name=KleitOffline",
    "--outfile=/tmp/kleit-offline.js",
    "--external:react",
  ],
  { stdio: "inherit" },
);
const bundle = readFileSync("/tmp/kleit-offline.js", "utf8");

const browser = await chromium.launch(
  process.env.KLEIT_CHROMIUM ? { executablePath: process.env.KLEIT_CHROMIUM } : {},
);
const page = await browser.newPage();
// IndexedDB needs a real origin; about:blank has none. A served page, no network needed.
await page.route("http://kleit.test/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>offline</title>",
  }),
);
await page.goto("http://kleit.test/");
// net.ts imports two React hooks for its `useOnline`; the bundle keeps React external and asks
// for it with require(), so a stub answers. Nothing in these checks renders.
await page.addScriptTag({
  content:
    "window.React = { useState() {}, useEffect() {} }; window.require = (n) => (n === 'react' ? window.React : undefined);",
});
await page.addScriptTag({ content: bundle });

const result = await page.evaluate(async () => {
  const K = window.KleitOffline;
  await K.cachePut("closet", [{ id: "a" }, { id: "b" }]);
  const got = await K.cacheGet("closet");
  const listBack = JSON.stringify(got?.value) === JSON.stringify([{ id: "a" }, { id: "b" }]);
  const stamped = typeof got?.at === "number" && Date.now() - got.at < 10_000;
  const missing = (await K.cacheGet("nothing-here")) === null;

  const bytes = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "image/jpeg" });
  await K.blobPut("item-1", bytes);
  const back = await K.blobGet("item-1");
  const blobBack =
    back instanceof Blob &&
    back.size === 5 &&
    back.type === "image/jpeg" &&
    Array.from(new Uint8Array(await back.arrayBuffer())).join(",") === "1,2,3,4,5";

  await K.outboxAdd({ kind: "save_set_layout", setId: "s1", layout: { caption: "one" }, at: 1 });
  await K.outboxAdd({ kind: "place_item", setId: "s1", slot: 0, itemId: "i1", at: 2 });
  await K.outboxAdd({ kind: "clear_slot", setId: "s1", slot: 1, at: 3 });
  const all = await K.outboxAll();
  const inOrder =
    all.map((e) => e.entry.kind).join(">") === "save_set_layout>place_item>clear_slot";
  const countThree = (await K.outboxCount()) === 3;
  await K.outboxRemove(all[0].key);
  const afterOne = await K.outboxAll();
  const firstGone = afterOne.length === 2 && afterOne[0].entry.kind === "place_item";

  const netErr = K.isNetworkError(new TypeError("Failed to fetch"));
  const authErr = K.isNetworkError({ name: "AuthRetryableFetchError", message: "x" });
  const refusal = K.isNetworkError({ code: "P0006", message: "caption carries a phone number" });
  const nothing = K.isNetworkError(null);

  return {
    listBack,
    stamped,
    missing,
    blobBack,
    inOrder,
    countThree,
    firstGone,
    netErr,
    authErr,
    refusal,
    nothing,
  };
});

await browser.close();

const checks = [
  ["a cached list comes back as it went in", result.listBack === true],
  ["the cache remembers when it was taken", result.stamped === true],
  ["an unknown key is null, not an error", result.missing === true],
  ["a picture kept as bytes comes back as the same bytes", result.blobBack === true],
  ["edits queue in the order they were made", result.inOrder === true],
  ["the count is the count", result.countThree === true],
  ["an edit leaves the queue on its own, the rest stay in order", result.firstGone === true],
  ["a fetch that never reached the server is a network error", result.netErr === true],
  ["a token refresh with no network is a network error", result.authErr === true],
  ["a server refusal is not a network error", result.refusal === false],
  ["nothing is not an error", result.nothing === false],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`\n${failed} offline check(s) failed`);
  process.exit(1);
}
console.log(`\nOffline check passed: ${checks.length} of ${checks.length}`);
