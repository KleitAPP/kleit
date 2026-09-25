#!/usr/bin/env node
/*
 * Launch-gate smoke test (roadmap M1.14). Drives the deployed test site with a real browser and
 * checks the four things the launch check must get right. Not part of the per-push `app` checks -
 * it needs a browser and a deployed site - so it runs on demand: the `launch-gate` workflow, or
 *   npx playwright install chromium && node scripts/check-launch-gate.mjs
 *
 * Why this exists: on 2026-09-24 the first version of the launch check sat on the splash screen
 * for ever when the phone had no signal at all, because supabase-js retries a dead connection
 * and the request never finishes. Nothing in the unit checks could see that (lesson L22).
 */
import { chromium } from "playwright";

const SITE = process.env.KLEIT_TEST_SITE ?? "https://kleit-test.kleitapp-team.workers.dev";
const PATIENCE_MS = 12_000; // comfortably longer than the request deadline plus the splash cap

const browser = await chromium.launch();
let failures = 0;

/** Opens the site with the switches answered however `answer` says, then reports what is on screen. */
async function open(answer) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route("**/rest/v1/app_settings*", answer);
  await page.goto(SITE + "/", { waitUntil: "load" });
  await page.waitForTimeout(PATIENCE_MS);
  const seen = {
    home: await page.getByRole("heading", { name: "Kleit", exact: true }).isVisible().catch(() => false),
    update: await page.getByText("Update Kleit to keep going").isVisible().catch(() => false),
    maintenance: await page.getByText("Kleit is closed for a quick fix").isVisible().catch(() => false),
    splash: await page.locator('[aria-busy="true"]').isVisible().catch(() => false),
  };
  await context.close();
  return seen;
}

/** Answers the switch request with the real row values, with `overrides` applied on top. */
function switchesSay(overrides) {
  return async (route) => {
    const real = await route.fetch();
    const rows = JSON.parse(await real.text());
    const patched = rows.map((row) => (row.key in overrides ? { ...row, value: overrides[row.key] } : row));
    await route.fulfill({ response: real, body: JSON.stringify(patched) });
  };
}

async function check(name, answer, want) {
  const seen = await open(answer);
  const ok = Object.entries(want).every(([k, v]) => seen[k] === v);
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) console.error(`    wanted ${JSON.stringify(want)}\n    saw    ${JSON.stringify(seen)}`);
}

await check(
  "the switches as they really are: the app opens",
  switchesSay({}),
  { home: true, update: false, maintenance: false, splash: false },
);

await check(
  "min_app_version above this bundle: the update screen blocks the app",
  switchesSay({ min_app_version: "99.0.0" }),
  { home: false, update: true, maintenance: false, splash: false },
);

await check(
  "maintenance_mode on: the maintenance screen shows",
  switchesSay({ maintenance_mode: true }),
  { home: false, update: false, maintenance: true, splash: false },
);

await check(
  "both on: the update screen wins (an out-of-date app is not trusted to show anything else)",
  switchesSay({ min_app_version: "99.0.0", maintenance_mode: true }),
  { home: false, update: true, maintenance: false, splash: false },
);

await check(
  "the database answers 500: the app still opens (a hiccup must not lock anyone out)",
  (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }),
  { home: true, update: false, maintenance: false, splash: false },
);

await check(
  "permission denied, as if RLS shut us out: the app still opens",
  (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"code":"42501"}' }),
  { home: true, update: false, maintenance: false, splash: false },
);

await check(
  "nonsense values: each switch keeps its open default",
  (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ key: "min_app_version", value: null }, { key: "maintenance_mode", value: "yes please" }]),
  }),
  { home: true, update: false, maintenance: false, splash: false },
);

await check(
  "NO SIGNAL AT ALL: the app still opens and the splash does not hang (lesson L22)",
  (route) => route.abort("failed"),
  { home: true, update: false, maintenance: false, splash: false },
);

await browser.close();

if (failures > 0) {
  console.error(`\nLaunch-gate smoke test FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log("\nLaunch-gate smoke test passed: all 8 checks.");
