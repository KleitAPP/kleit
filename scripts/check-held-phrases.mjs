/**
 * One list, kept one by CI (migration 062): the phrases that hold a comment or report a caption
 * in the database must be exactly the phrases the Search tab's help card answers to
 * (src/safety/risky.ts). The database's copy is the LATEST migration that defines
 * `private.held_phrases()` - an applied migration is never edited, so a change is a new file.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const risky = readFileSync("src/safety/risky.ts", "utf8");
const start = risky.indexOf("const RISKY = [");
const end = risky.indexOf("];", start);
const app = [...risky.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const dir = "supabase/migrations";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
let latest = null;
for (const f of files) {
  const text = readFileSync(join(dir, f), "utf8");
  if (text.includes("function private.held_phrases()")) latest = { f, text };
}
if (!latest) {
  console.log("not ok - no migration defines private.held_phrases()");
  process.exit(1);
}
const fnStart = latest.text.indexOf("function private.held_phrases()");
const arrStart = latest.text.indexOf("array[", fnStart);
const arrEnd = latest.text.indexOf("]", arrStart);
const db = [...latest.text.slice(arrStart, arrEnd).matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
  m[1].replace(/''/g, "'"),
);

const missingInDb = app.filter((p) => !db.includes(p));
const extraInDb = db.filter((p) => !app.includes(p));
const ok = missingInDb.length === 0 && extraInDb.length === 0 && app.length > 0;
console.log(
  `${ok ? "ok" : "not ok"} - held phrases: app ${app.length}, database (${latest.f}) ${db.length}` +
    (missingInDb.length ? `; missing in the database: ${missingInDb.join(", ")}` : "") +
    (extraInDb.length ? `; only in the database: ${extraInDb.join(", ")}` : ""),
);
process.exit(ok ? 0 : 1);
