/**
 * Proves where a share or a link that reaches the phone app is sent (roadmap M8.2 / M8.7):
 * the routing in src/native/incoming.ts, with the phone and the database stubbed.
 *
 *   1. A store address shared from another app becomes Clip a link with the address filled in.
 *   2. Chatter around the address ("look at this …") is ignored; the first address wins.
 *   3. One of our own set links becomes the set; a dead code becomes "not available".
 *   4. A poll link becomes the poll.
 *   5. Any other path on our own site opens as itself inside the app.
 *   6. Nonsense is dropped.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const dir = "/tmp/kleit-incoming";
mkdirSync(dir, { recursive: true });
writeFileSync(
  `${dir}/capacitor.js`,
  `export const Capacitor = { isNativePlatform: () => false, isPluginAvailable: () => false };
export function registerPlugin() { return {}; }`,
);
writeFileSync(
  `${dir}/supabase.js`,
  `export const supabase = { rpc: async () => ({ data: null }) };`,
);
execFileSync(
  "npx",
  [
    "esbuild",
    `${process.cwd()}/src/native/incoming.ts`,
    "--bundle",
    "--format=esm",
    `--outfile=${dir}/incoming.mjs`,
    `--alias:@capacitor/core=${dir}/capacitor.js`,
    `--alias:@/integrations/supabase/client=${dir}/supabase.js`,
  ],
  { stdio: "inherit" },
);
const { firstUrl, destinationFor } = await import(`${dir}/incoming.mjs`);

const lookup = {
  set: async (code) => (code === "liveSetCode00001" ? "set-id-1" : null),
  poll: async (code) => (code === "livePollCode0001" ? "poll-id-1" : null),
};
const to = (raw) => destinationFor(raw, lookup);

const checks = [
  [
    "a store address shared from another app becomes Clip a link, filled in",
    (await to("https://www.zara.com/us/en/jacket-p01.html")) ===
      "/add/link?url=" + encodeURIComponent("https://www.zara.com/us/en/jacket-p01.html"),
  ],
  [
    "chatter around the address is ignored; the first address wins",
    firstUrl("look at this https://shop.example.com/a?x=1, and https://b.example") ===
      "https://shop.example.com/a?x=1",
  ],
  [
    "a trailing full stop is not part of the address",
    firstUrl("https://x.example/p.") === "https://x.example/p",
  ],
  [
    "our set link becomes the set",
    (await to("https://kleit.app/s/liveSetCode00001")) === "/set/set-id-1",
  ],
  [
    "a dead or private set code lands on not available",
    (await to("https://kleit.app/s/deadSetCode00001")) === "/not-available",
  ],
  [
    "our poll link becomes the poll",
    (await to("https://www.kleit.app/p/livePollCode0001")) === "/poll/poll-id-1",
  ],
  [
    "the test site counts as ours too",
    (await to("https://kleit-test.kleitapp-team.workers.dev/s/liveSetCode00001")) ===
      "/set/set-id-1",
  ],
  [
    "another path on our site opens as itself",
    (await to("https://kleit.app/u/zokono")) === "/u/zokono",
  ],
  [
    "nonsense is dropped",
    (await to("not an address")) === null && firstUrl("no link here") === null,
  ],
  ["a non-web scheme is dropped", (await to("javascript:alert(1)")) === null],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`\n${failed} incoming check(s) failed`);
  process.exit(1);
}
console.log(`\nIncoming check passed: ${checks.length} of ${checks.length}`);
