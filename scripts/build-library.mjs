// The decoration library's one gate (roadmap M4.4; artwork pack §5.3, §9, gap A9).
//
// Walks every picture the site serves from public/library/ and every licence row under
// src/brand/assets/library/licence/, and FAILS if any shipped file has no row or any row that
// says "ship" has no file. Then writes src/library/catalogue.json - the list the drawer reads -
// from the rows, never from the folder, so nothing reaches the app because a file was dropped in.
//
//   node scripts/build-library.mjs          write the catalogue (and check)
//   node scripts/build-library.mjs --check  check only; also fails if the catalogue is stale
//
// Rules carried in here, each from the artwork pack:
//   - a row ships only when its verdict is "ship" (or the record has no verdict column);
//     "weak" and "fail" rows keep their files for a later redraw but never reach the drawer
//   - no footwear is drawn (decision 108) - the two shoes are "fail" rows already
//   - a pack is a label, not a folder: one asset may sit in several packs
//   - every cutout's alt text is the museum's own object title (§8 #2)

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PUB = join(ROOT, "public/library");
const REC = join(ROOT, "src/brand/assets/library");
const OUT = join(ROOT, "src/library/catalogue.json");
// A small id → [file, title] index for the share Worker and the chat-picture function, which
// only need to find a picture, not describe a pack.
const LITE = join(ROOT, "src/library/files.json");
// The same index again where the Supabase function bundler can see it (it only follows imports
// under supabase/functions/).
const LITE_FN = join(ROOT, "supabase/functions/_shared/library-files.json");
const check = process.argv.includes("--check");

function csv(path) {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((v) => v !== "")) rows.push(row);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])));
}

/** WebP header → {w, h}; the catalogue carries sizes so the canvas can place a piece at its true shape. */
function webpSize(path) {
  const b = readFileSync(path);
  const tag = b.toString("latin1", 12, 16);
  if (tag === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (tag === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (tag === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`not a webp: ${path}`);
}

const titleOf = (id) => id.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const ships = (row) =>
  !("claude_verdict" in row) || row.claude_verdict === "" || row.claude_verdict === "ship";

const problems = [];
const packs = JSON.parse(readFileSync(join(REC, "packs.json"), "utf8"));
const packIds = new Set(packs.map((p) => p.id));
const files = (dir) =>
  existsSync(join(PUB, dir)) ? readdirSync(join(PUB, dir)).filter((f) => f.endsWith(".webp")) : [];

const assets = {};
const backgrounds = {};
const seen = new Set(); // files claimed by a row
// Assets pulled for good (spec 13.3 #6): an admin's pull on the live site lists the id in the
// database within minutes (migration 118) and the drawer skips it; this file is the permanent
// half - the id stays out of the catalogue, and the check fails while its files are still here.
const PULLED = new Set(JSON.parse(readFileSync(join(REC, "pulled.json"), "utf8")));

/** An SVG's viewBox → {w, h}. */
function svgSize(path) {
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(readFileSync(path, "utf8"));
  if (!m) throw new Error(`no viewBox: ${path}`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

function claim(dir, id, row, into, make, ext = "webp") {
  const file = `${dir}/${id}.${ext}`;
  const exists = existsSync(join(PUB, file));
  if (PULLED.has(id)) {
    if (exists) problems.push(`pulled asset still shipped - delete the file: ${file}`);
    const thumb = ext === "svg" ? file : `thumbs/${id}.webp`;
    if (ext !== "svg" && existsSync(join(PUB, thumb)))
      problems.push(`pulled asset still shipped - delete the thumbnail: ${thumb}`);
    return;
  }
  if (!exists) {
    if (ships(row)) problems.push(`row says ship but no file: ${file}`);
    return;
  }
  seen.add(file);
  // A structural SVG is its own thumbnail (a few hundred bytes); pictures get a 160 px one.
  const thumb = ext === "svg" ? file : `thumbs/${id}.webp`;
  if (!existsSync(join(PUB, thumb))) problems.push(`no thumbnail: ${thumb}`);
  if (!ships(row) || into[id]) return; // a later record for the same id never overrides the first
  for (const p of make.packs) if (!packIds.has(p)) problems.push(`${id}: unknown pack "${p}"`);
  const size = ext === "svg" ? svgSize(join(PUB, file)) : webpSize(join(PUB, file));
  into[id] = {
    ...make,
    file,
    thumb,
    w: size.w,
    h: size.h,
    bytes: statSync(join(PUB, file)).size,
  };
}

// Museum cutouts: one row each, CC0, the object title is the name a screen reader says.
for (const r of csv(join(REC, "licence/cutout-licence-record.csv"))) {
  if (!/CC0/.test(r.licence)) problems.push(`${r.asset_id}: licence is not CC0 (${r.licence})`);
  if (!/^pass/.test(r.trademark_likeness_check))
    problems.push(`${r.asset_id}: trademark/likeness check did not pass`);
  claim("cutouts", r.asset_id, r, assets, {
    kind: "cutout",
    title: r.object_title,
    packs: r.packs.split("|").filter(Boolean),
    credit: `${r.collection}, ${r.object_date}`,
    source: r.object_url,
  });
}
// Drawn stickers: Kleit's own, in the order the records were made (the newest Y2K redraws first).
const drawnRecords = [
  "licence/aesthetic-stickers-licence-record.csv",
  "licence/y2k-realistic-licence-record.csv",
  "licence/y2k-new-licence-record.csv",
  "licence/y2k-drawn-licence-record.csv",
];
for (const rec of drawnRecords) {
  for (const r of csv(join(REC, rec))) {
    if (!/Kleit/.test(r.owns_output))
      problems.push(`${r.asset_id}: Kleit does not own the output (${rec})`);
    for (const k of ["brand_wordmark_check", "character_check", "person_check"])
      if (k in r && !/^pass/.test(r[k])) problems.push(`${r.asset_id}: ${k} did not pass`);
    claim("drawn", r.asset_id, r, assets, {
      kind: "drawn",
      title: r.title || titleOf(r.asset_id),
      packs: [r.pack],
      credit: "Drawn for Kleit",
      source: "",
    });
  }
}
// The structural set (frames, tape, rules, bars, marks): one-colour SVG the user recolours.
// It is a pack of its own in the drawer ("Frames & tape"), and every SVG must be a single colour.
for (const r of csv(join(REC, "licence/structural-licence-record.csv"))) {
  if (!/Kleit/.test(r.owns_output)) problems.push(`${r.asset_id}: Kleit does not own the output`);
  const file = join(PUB, `structural/${r.asset_id}.svg`);
  if (existsSync(file)) {
    const text = readFileSync(file, "utf8");
    if (
      /fill="(?!currentColor|none)/.test(text) ||
      /stroke="(?!currentColor)/.test(text) ||
      /url\(|gradient|filter/i.test(text)
    )
      problems.push(
        `${r.asset_id}: a structural asset must be one colour (currentColor), no gradients or filters`,
      );
  }
  claim(
    "structural",
    r.asset_id,
    r,
    assets,
    {
      kind: "structural",
      title: r.title,
      packs: ["structural"],
      credit: "Drawn for Kleit",
      source: "",
      family: r.family,
    },
    "svg",
  );
}
// Backgrounds: museum (CSV) and drawn (index).
for (const r of csv(join(REC, "licence/background-licence-record.csv"))) {
  if (!/CC0/.test(r.licence)) problems.push(`${r.asset_id}: background licence is not CC0`);
  claim("backgrounds", r.asset_id, r, backgrounds, {
    kind: "cutout",
    title: r.object_title,
    packs: [r.pack],
    credit: `${r.collection}, ${r.object_date}`,
    source: r.object_url,
  });
}
for (const [id, v] of Object.entries(
  JSON.parse(readFileSync(join(REC, "drawn-backgrounds.json"), "utf8")),
)) {
  claim("backgrounds", id, {}, backgrounds, {
    kind: "drawn",
    title: v.title,
    packs: [v.pack],
    credit: "Drawn for Kleit",
    source: "",
  });
}

// Every shipped file must have been claimed by a row.
for (const dir of ["cutouts", "drawn", "backgrounds"])
  for (const f of files(dir))
    if (!seen.has(`${dir}/${f}`)) problems.push(`file with no licence row: ${dir}/${f}`);
if (existsSync(join(PUB, "structural")))
  for (const f of readdirSync(join(PUB, "structural")))
    if (!seen.has(`structural/${f}`)) problems.push(`file with no licence row: structural/${f}`);
for (const f of files("thumbs")) {
  const id = f.slice(0, -5);
  if (!["cutouts", "drawn", "backgrounds"].some((d) => seen.has(`${d}/${f}`)))
    problems.push(`thumbnail with no asset: thumbs/${f}`);
  void id;
}

const catalogue = {
  packs: packs.map((p) => ({
    ...p,
    count: Object.values(assets).filter((a) => a.packs.includes(p.id)).length,
    backgrounds: Object.entries(backgrounds)
      .filter(([, b]) => b.packs.includes(p.id))
      .map(([id]) => id),
  })),
  assets,
  backgrounds,
};

if (problems.length) {
  console.error(`library check FAILED (${problems.length}):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
const json = JSON.stringify(catalogue, null, 1) + "\n";
const lite =
  JSON.stringify({
    assets: Object.fromEntries(Object.entries(assets).map(([id, a]) => [id, [a.file, a.title]])),
    backgrounds: Object.fromEntries(
      Object.entries(backgrounds).map(([id, a]) => [id, [a.file, a.title]]),
    ),
  }) + "\n";
if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  const currentLite = existsSync(LITE) ? readFileSync(LITE, "utf8") : "";
  const currentFn = existsSync(LITE_FN) ? readFileSync(LITE_FN, "utf8") : "";
  if (current !== json || currentLite !== lite || currentFn !== lite) {
    console.error(
      "library check FAILED: src/library/*.json is stale - run node scripts/build-library.mjs",
    );
    process.exit(1);
  }
} else {
  writeFileSync(OUT, json);
  writeFileSync(LITE, lite);
  writeFileSync(LITE_FN, lite);
}
const n = Object.keys(assets).length;
const cut = Object.values(assets).filter((a) => a.kind === "cutout").length;
const structural = Object.values(assets).filter((a) => a.kind === "structural").length;
console.log(
  `library OK: ${n} assets (${cut} museum cutouts, ${n - cut - structural} drawn, ${structural} structural), ${Object.keys(backgrounds).length} backgrounds, ${packs.length} packs; every file has a licence row`,
);
for (const p of catalogue.packs)
  console.log(
    `  ${p.name.padEnd(16)} ${String(p.count).padStart(3)} assets, ${p.backgrounds.length} backgrounds`,
  );
