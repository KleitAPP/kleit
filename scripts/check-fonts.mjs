/**
 * Every shipped font has a licence record, and every record has its font and its licence text
 * on disk (spec 6.2 #1: "license recorded for each"). Runs on every push.
 */
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";

const source = readFileSync("src/fonts/catalogue.ts", "utf8");
const ids = [...source.matchAll(/id: "([a-z0-9]+)"/g)].map((m) => m[1]);
const files = readdirSync("public/fonts")
  .filter((f) => f.endsWith(".ttf"))
  .map((f) => f.replace(/\.ttf$/, ""));
let failed = 0;
const say = (ok, what) => {
  console.log(`${ok ? "ok" : "not ok"} - ${what}`);
  if (!ok) failed += 1;
};
say(ids.length >= 20 && ids.length <= 30, `${ids.length} fonts in the catalogue (spec says 20–30)`);
for (const id of ids) {
  say(existsSync(`public/fonts/${id}.ttf`), `${id}: font file present`);
  const lic = existsSync(`public/fonts/${id}.OFL.txt`)
    ? readFileSync(`public/fonts/${id}.OFL.txt`, "utf8")
    : "";
  say(/SIL Open Font License, Version 1\.1/.test(lic), `${id}: OFL 1.1 licence text beside it`);
  // Prettier may wrap the record and switch the quotes: find the record, then the key with a non-empty string.
  const at = source.indexOf(`id: "${id}"`);
  const record = source.slice(at, source.indexOf("}", at));
  say(/copyright:\s*["'][^"']+["']/.test(record), `${id}: copyright line recorded`);
}
for (const f of files) say(ids.includes(f), `${f}.ttf has a catalogue record`);
console.log(
  failed === 0
    ? `# fonts: all ${ids.length} fonts licensed and recorded`
    : `# fonts: ${failed} problem(s)`,
);
process.exit(failed === 0 ? 0 : 1);
