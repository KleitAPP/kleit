// The one rule that decides whether the app is blocked behind the update screen (roadmap M1.14).
// Run: bun scripts/check-version-rule.ts   (exits 1 on any failure; CI runs it on every push)
import { isVersionBelow } from "../src/app/version.ts";

const cases: [running: string, minimum: string, blocked: boolean, why: string][] = [
  ["0.1.0", "0.0.0", false, "newer than the floor -> the app opens"],
  ["0.1.0", "0.1.0", false, "exactly at the floor -> the app opens"],
  ["0.1.0", "0.1.1", true, "one patch behind -> blocked"],
  ["0.1.0", "0.2.0", true, "one minor behind -> blocked"],
  ["0.1.0", "1.0.0", true, "one major behind -> blocked"],
  ["1.0.0", "0.9.9", false, "ahead of the floor -> the app opens"],
  ["0.10.0", "0.9.0", false, "10 is newer than 9 (a plain text compare gets this backwards)"],
  ["0.1.0", "0.1", false, "a short floor -> the missing parts count as 0"],
  ["0.1", "0.1.1", true, "a short running version -> the missing parts count as 0"],
  ["0.1.0", "banana", false, "a nonsense floor can never block the app"],
  ["0.1.0", "-3.0.0", false, "a negative floor can never block the app"],
  ["0.1.0", " 0.2.0 ", true, "spaces around the floor still block"],
];

let failed = 0;
for (const [running, minimum, blocked, why] of cases) {
  const got = isVersionBelow(running, minimum);
  if (got !== blocked) {
    console.error(`✗ running ${running} vs min ${minimum}: expected ${blocked}, got ${got} — ${why}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\nVersion rule check FAILED: ${failed} of ${cases.length}.`);
  process.exit(1);
}
console.log(`Version rule check passed: all ${cases.length} cases (${cases.filter((c) => c[2]).length} block, ${cases.filter((c) => !c[2]).length} open).`);
