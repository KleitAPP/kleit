/**
 * Proves where a share or a link that reaches the phone app is sent (roadmap M8.2 / M8.7):
 * the routing in src/native/incoming.ts, with the phone and the database stubbed.
 *
 *   1. A store address shared from another app becomes Clip a link with the address filled in.
 *   2. Chatter around the address ("look at this …") is ignored; the first address wins.
 *   3. One of our own set links becomes the set; a dead code becomes "not available".
 *   4. A poll link becomes the poll.
 *   5. Any other path on our own site is dropped.
 *   6. Nonsense is dropped.
 *   7. A Keep it link from a brand's site (M9.2) carries its piece ids and nothing else; the
 *      same shape is the one the signed-out shell keeps across sign-in (safeNext).
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
const { firstUrl, destinationFor, takeSharedAddress } = await import(`${dir}/incoming.mjs`);
execFileSync(
  "npx",
  [
    "esbuild",
    `${process.cwd()}/src/auth/next.ts`,
    "--bundle",
    "--format=esm",
    `--outfile=${dir}/next.mjs`,
  ],
  { stdio: "inherit" },
);
const { safeNext } = await import(`${dir}/next.mjs`);
const A = "a1a1a1a1-0000-4000-8000-000000000001";
const B = "a1a1a1a1-0000-4000-8000-000000000002";

const lookup = {
  set: async (code) => (code === "liveSetCode00001" ? "set-id-1" : null),
  poll: async (code) => (code === "livePollCode0001" ? "poll-id-1" : null),
};
const to = (raw) => destinationFor(raw, lookup);

const checks = [
  [
    "a store address shared from another app becomes Clip a link, the address handed over in memory",
    (await to("https://www.zara.com/us/en/jacket-p01.html")) === "/add/link" &&
      takeSharedAddress() === "https://www.zara.com/us/en/jacket-p01.html" &&
      takeSharedAddress() === null,
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
    "an invite link opens the invite screen, the code tidied",
    (await to("https://kleit.app/welcome?invite=abcd2345")) === "/welcome?invite=ABCD2345",
  ],
  [
    "any other path on our own site is dropped - another app cannot pick a screen",
    (await to("https://kleit.app/u/zokono")) === null &&
      (await to("https://kleit.app/add/link?url=https://evil.example")) === null &&
      (await to("https://kleit.app/settings/delete")) === null &&
      (await to("https://kleit.app/welcome?invite=not%20a%20code")) === null,
  ],
  [
    "nonsense is dropped",
    (await to("not an address")) === null && firstUrl("no link here") === null,
  ],
  ["a non-web scheme is dropped", (await to("javascript:alert(1)")) === null],
  [
    "a Keep it link from a brand's site opens the keep screen with its ids, lower-cased",
    (await to(`https://kleit.app/keep?pieces=${A.toUpperCase()},${B}`)) ===
      `/keep?pieces=${A},${B}`,
  ],
  [
    "a keep link with a stray word, a fifth id, a repeat, or nothing at all is dropped whole",
    (await to(`https://kleit.app/keep?pieces=${A},evil`)) === null &&
      (await to(`https://kleit.app/keep?pieces=${A},${B},${A}`)) === null &&
      (await to(
        `https://kleit.app/keep?pieces=${[1, 2, 3, 4, 5].map((i) => A.slice(0, -1) + i).join(",")}`,
      )) === null &&
      (await to("https://kleit.app/keep?pieces=")) === null &&
      (await to("https://kleit.app/keep")) === null,
  ],
  [
    "signed out, the shell keeps a keep link across sign-in, and only the set, poll and keep shapes",
    safeNext(`/keep?pieces=${A},${B}`) === `/keep?pieces=${A},${B}` &&
      safeNext("/s/liveSetCode00001") === "/s/liveSetCode00001" &&
      safeNext(`/keep?pieces=${A}&next=/evil`) === null &&
      safeNext("/keep?pieces=evil") === null &&
      safeNext("/settings/delete") === null &&
      safeNext("//evil.example/keep?pieces=" + A) === null,
  ],
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
