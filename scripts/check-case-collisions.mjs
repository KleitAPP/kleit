/**
 * Two files in one folder whose names differ only in case import differently on a Mac than on
 * Linux: `src/social/avatar.ts` beside `src/social/Avatar.tsx` built fine in CI and on
 * Cloudflare and failed on Codemagic's Mac, where `@/social/Avatar` found `avatar.ts` first
 * (2026-10-12, iOS build #8). The import that works everywhere is the one nothing else could
 * be mistaken for, so this refuses the pair before a Mac ever sees it.
 *
 * Run: node scripts/check-case-collisions.mjs   (CI runs it on every push)
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "worker", "supabase/functions", "scripts", "extension", "public"];
const SKIP = new Set(["node_modules", ".git", "library", "fonts"]);
let failed = 0;

function walk(dir) {
  const names = readdirSync(dir);
  const seen = new Map();
  for (const name of names) {
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (!SKIP.has(name)) walk(full);
      continue;
    }
    const base = name.replace(/\.[^.]+$/, "").toLowerCase();
    const other = seen.get(base);
    if (other && other !== name && other.replace(/\.[^.]+$/, "") !== name.replace(/\.[^.]+$/, "")) {
      console.log(`not ok - ${dir}: "${other}" and "${name}" differ only in case`);
      failed += 1;
    }
    if (!other) seen.set(base, name);
  }
}

for (const root of ROOTS) {
  try {
    walk(root);
  } catch {
    /* a root that is not there is nothing to check */
  }
}
if (failed) {
  console.error(`\n${failed} name collision(s): rename one of each pair`);
  process.exit(1);
}
console.log("ok - no two files in one folder differ only in case");
