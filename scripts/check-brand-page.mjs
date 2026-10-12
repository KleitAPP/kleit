/**
 * Proves the brand mini editor (roadmap M9.2; OW23 option a) in a real browser, with no network:
 * the Worker's own code renders /e/brand/<domain> from a stand-in database, a host page on
 * ANOTHER origin frames it, and the page is tapped the way a shopper would tap it.
 *
 *   1. The page: 200, framable, a nonce policy, four slots, the store's pieces, Keep it off.
 *   2. The shapes: a bad domain and a broken address are 404; a store with no pieces says so
 *      and runs no script; the domain is lower-cased and `www.` dropped before it is asked.
 *   3. Inside a frame on another origin: tap a piece, it fills slot 1; tap another, slot 2;
 *      tap slot 1, it clears; the same piece again lands in the first empty slot; the fifth
 *      piece with all four full is refused with a notice; Keep it carries exactly the ids in
 *      slot order, to this site's /keep and nowhere else.
 *   4. Accessibility: no serious or critical WCAG problems in the frame, under its own policy.
 *
 * Run: node scripts/check-brand-page.mjs   (launch-gate runs it with a browser)
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pw from "playwright";

const { chromium } = pw;
const require = createRequire(import.meta.url);

let n = 0;
let failed = 0;
function check(ok, what, detail = "") {
  n += 1;
  console.log(`${ok ? "ok" : "not ok"} ${n} - ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
}

// The Worker, bundled on its own (it reads the library index as JSON).
const out = "/tmp/kleit-worker-check.mjs";
execFileSync(
  "npx",
  [
    "esbuild",
    `${process.cwd()}/worker/index.ts`,
    "--bundle",
    "--format=esm",
    `--outfile=${out}`,
    "--platform=browser",
    "--log-level=warning",
  ],
  { stdio: "inherit" },
);
const worker = (await import(pathToFileURL(out).href)).default;

// The stand-in database: the two questions the page asks.
const SITE = "https://kleit.test";
const DB = "https://db.kleit.test";
const ids = [
  "a1a1a1a1-0000-4000-8000-000000000001",
  "a1a1a1a1-0000-4000-8000-000000000002",
  "a1a1a1a1-0000-4000-8000-000000000003",
  "a1a1a1a1-0000-4000-8000-000000000004",
  "a1a1a1a1-0000-4000-8000-000000000005",
];
const asked = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.startsWith(`${DB}/rest/v1/app_settings`)) return Response.json([{ value: true }]);
  if (url.startsWith(`${DB}/rest/v1/rpc/brand_pieces`)) {
    const body = JSON.parse(init?.body ?? "{}");
    asked.push(body.p_domain);
    if (body.p_domain === "empty.example")
      return Response.json({ id: "empty.example", domain: "empty.example", pieces: [] });
    if (body.p_domain !== "brand.example") return Response.json(null);
    return Response.json({
      id: "brand.example",
      domain: "brand.example",
      pieces: ids.map((id, i) => ({
        id,
        title: i === 4 ? null : `Piece <${i + 1}> "quoted"`,
        price_cents: i === 4 ? null : 1000 * (i + 1),
        price_currency: i === 4 ? null : "USD",
      })),
    });
  }
  throw new Error(`unexpected fetch: ${url}`);
};
const env = {
  ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
  SUPABASE_URL: DB,
  SUPABASE_ANON_KEY: "anon",
};
const ask = (path) => worker.fetch(new Request(`${SITE}${path}`), env);

// 1. The page.
const page1 = await ask("/e/brand/brand.example");
const html1 = await page1.text();
const csp1 = page1.headers.get("content-security-policy") ?? "";
check(page1.status === 200, "the brand page answers 200");
check(csp1.includes("frame-ancestors *"), "it may be framed by any site", csp1.slice(0, 60));
check(
  /script-src 'nonce-[A-Za-z0-9+/=]+' https:\/\/challenges\.cloudflare\.com/.test(csp1) &&
    !csp1.includes("'unsafe-inline'; script") &&
    (html1.match(/<script nonce="/g) ?? []).length === 2,
  "its two scripts run under the response's own nonce",
);
check((html1.match(/class="slot"/g) ?? []).length === 4, "four slots");
check((html1.match(/class="pick"/g) ?? []).length === 5, "five pieces to pick from");
check(
  html1.includes("Piece &lt;1&gt; &quot;quoted&quot;") && !html1.includes("<1>"),
  "a piece's title is written as text, never as markup",
);
check(/aria-disabled="true"[^>]*>Keep it on Kleit/.test(html1), "Keep it starts off");
check(/noindex/.test(page1.headers.get("x-robots-tag") ?? ""), "not for search engines");

// 2. The shapes.
const bad = await ask("/e/brand/not-a-domain");
const broken = await ask("/e/brand/%ZZ");
const upper = await ask("/e/brand/WWW.Brand.Example/");
const empty = await ask("/e/brand/empty.example");
const emptyHtml = await empty.text();
check(
  bad.status === 404 && broken.status === 404,
  "a word with no dot, or a broken address, is 404",
);
check(
  upper.status === 200 &&
    asked.includes("brand.example") &&
    !asked.some((d) => /[A-Z]|www\./.test(d)),
  "the store is asked for in lower case without www.",
  asked.join(","),
);
check(
  empty.status === 200 &&
    /No pieces from empty\.example/.test(emptyHtml) &&
    !/<script/.test(emptyHtml) &&
    (empty.headers.get("content-security-policy") ?? "").includes("script-src 'none'"),
  "a store with no pieces says so and runs no script",
);

// 3. Inside a frame on another origin.
const browser = await chromium.launch(
  process.env.KLEIT_CHROMIUM ? { executablePath: process.env.KLEIT_CHROMIUM } : {},
);
const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await context.newPage();
const consoleProblems = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleProblems.push(m.text());
});
page.on("pageerror", (e) => consoleProblems.push(`pageerror: ${e.message}`));
// Kleit's own pages come from the Worker's code; the pictures are blank squares.
await page.route(`${SITE}/**`, async (route) => {
  const r = await worker.fetch(new Request(route.request().url()), env);
  const headers = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  await route.fulfill({ status: r.status, headers, body: await r.text() });
});
await page.route(`${DB}/functions/v1/item-image**`, (route) =>
  route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    ),
  }),
);
// The brand's site, on its own origin, framing the editor.
await page.route("https://shop.brand.example/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><title>brand.example</title><h1>Our shop</h1><iframe title="Build a look" src="${SITE}/e/brand/brand.example" style="width:100%;height:800px;border:0"></iframe>`,
  }),
);
await page.goto("https://shop.brand.example/looks");
const frame = page.frameLocator('iframe[title="Build a look"]');
await frame.locator(".pick").first().waitFor();
check(
  (await frame.locator(".pick").count()) === 5 &&
    new URL(page.url()).origin === "https://shop.brand.example",
  "the editor loads inside a page on another origin",
);
const slot = (i) => frame.locator(".slot").nth(i);
const keep = frame.locator("#keep");
await frame.locator(".pick").nth(0).click();
check(
  /^Slot 1: Piece <1> "quoted"/.test(await slot(0).getAttribute("aria-label")),
  "the first tap fills slot 1",
  await slot(0).getAttribute("aria-label"),
);
await frame.locator(".pick").nth(1).click();
check(
  /^Slot 2: Piece <2>/.test(await slot(1).getAttribute("aria-label")),
  "the second fills slot 2",
);
check(
  (await keep.getAttribute("href")) === `${SITE}/keep?pieces=${ids[0]},${ids[1]}`,
  "Keep it carries the two ids in slot order",
  await keep.getAttribute("href"),
);
await slot(0).click();
check(
  /^Slot 1, empty/.test(await slot(0).getAttribute("aria-label")),
  "tapping a filled slot clears it",
);
check(
  (await keep.getAttribute("href")) === `${SITE}/keep?pieces=${ids[1]}`,
  "…and Keep it forgets that piece",
);
await frame.locator(".pick").nth(2).click();
check(
  /^Slot 1: Piece <3>/.test(await slot(0).getAttribute("aria-label")),
  "the next piece lands in the first empty slot",
);
await frame.locator(".pick").nth(1).click();
check(
  /^Slot 2: Piece <2>/.test(await slot(1).getAttribute("aria-label")) &&
    (await frame.locator(".slot.filled").count()) === 2,
  "a piece already placed stays where it is when tapped again",
);
await frame.locator(".pick").nth(3).click();
await frame.locator(".pick").nth(4).click();
check((await frame.locator(".slot.filled").count()) === 4, "four pieces fill the four slots");
await frame.locator(".pick").nth(0).click();
const notice = await frame.locator("#notice").innerText();
check(
  /All four slots are full/.test(notice) && (await frame.locator(".slot.filled").count()) === 4,
  "a fifth piece is refused with a notice",
  notice,
);
check(
  /^Slot 4: A piece/.test(await slot(3).getAttribute("aria-label")),
  "a piece with no title is 'A piece'",
);
await slot(1).click(); // clear slot 2
await slot(1).click(); // choose it
check(
  /chosen for the next piece/.test(await slot(1).getAttribute("aria-label")),
  "an empty slot can be chosen for the next piece",
);
await frame.locator(".pick").nth(0).click();
check(
  /^Slot 2: Piece <1>/.test(await slot(1).getAttribute("aria-label")),
  "…and the next piece goes there",
);
const href = await keep.getAttribute("href");
check(
  href === `${SITE}/keep?pieces=${ids[2]},${ids[0]},${ids[3]},${ids[4]}` &&
    (await keep.getAttribute("target")) === "_blank",
  "Keep it carries the four ids in slot order, to this site, in a new tab",
  href,
);
check(
  consoleProblems.length === 0,
  "no script was blocked and nothing threw",
  consoleProblems.join(" | ").slice(0, 200),
);
// KLEIT_SHOT=<file.png> keeps a picture of the framed editor at this point, for a look by eye.
if (process.env.KLEIT_SHOT) await page.screenshot({ path: process.env.KLEIT_SHOT, fullPage: true });

// 4. Accessibility, under the page's own policy (axe goes in through the debugging channel).
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const inner = page.frames().find((f) => f.url().startsWith(`${SITE}/e/brand/`));
await inner.evaluate(AXE);
const found = await inner.evaluate(async () => {
  const r = await window.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  });
  return r.violations.map(
    (v) => `${v.impact} ${v.id}×${v.nodes.length} (${v.nodes[0]?.html.slice(0, 80)})`,
  );
});
check(
  !found.some((v) => /^(serious|critical)/.test(v)),
  "the editor has no serious or critical WCAG problems",
  found.join("; ") || "clean",
);

await browser.close();
console.log(`1..${n}`);
console.log(
  failed === 0
    ? `# brand page: all ${n} checks passed`
    : `# brand page: ${failed} of ${n} checks FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
