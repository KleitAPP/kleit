/**
 * M2.1 — can our server read a product page from the top US fashion stores? (roadmap M2.1;
 * spec 4.1 #5). This is the gate in front of paste-a-link: if most stores block a server-side
 * read, M2.4 changes shape.
 *
 * It asks the DEPLOYED clip-url function - the real code, from the real place it runs (Supabase,
 * us-east-1) - to read each page in scripts/fixtures/store-probe.json, and prints a table:
 * store · outcome · what was found (name / price / pictures) · the fallback that would apply.
 * Nothing is stored; the read is side-effect free.
 *
 * Run by CI (workflow "store-probe") with the project's service key, which the function accepts
 * for reads only. Locally: PROBE_URL=... PROBE_KEY=... node scripts/store-probe.mjs
 */
import { readFileSync } from "node:fs";

const fn = process.env.PROBE_URL;
const key = process.env.PROBE_KEY;
if (!fn || !key) {
  console.error("PROBE_URL and PROBE_KEY are required");
  process.exit(2);
}
const stores = JSON.parse(readFileSync("scripts/fixtures/store-probe.json", "utf8"));

const rows = [];
for (const { store, url } of stores) {
  const started = Date.now();
  let lastBody = null;
  let outcome,
    found = "",
    fallback = "";
  try {
    const response = await fetch(fn, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ action: "probe", url }),
    });
    const body = await response.json().catch(() => ({}));
    lastBody = body;
    const ms = Date.now() - started;
    if (response.status === 200) {
      const bits = [
        body.title ? "name" : null,
        body.priceCents != null ? "price" : null,
        body.images?.length ? `${body.images.length} picture(s)` : null,
      ].filter(Boolean);
      const full = body.title && body.priceCents != null && body.images?.length;
      outcome = full ? `✅ pass (${ms} ms)` : `🟡 partial (${ms} ms)`;
      found = bits.join(", ") || "nothing usable";
      fallback = full ? "—" : "the person fills in what is missing on the details screen";
    } else {
      outcome = `❌ ${body.problem ?? response.status} (${ms} ms)`;
      fallback =
        body.problem === "refused"
          ? "add it yourself (photo or screenshot), or read on the phone (M8 share extension)"
          : body.problem === "timed-out"
            ? "saved with the link; finished in the background (G10)"
            : "add it yourself";
    }
  } catch (problem) {
    outcome = `❌ ${problem instanceof Error ? problem.message : problem}`;
    fallback = "add it yourself";
  }
  rows.push({ store, outcome, found, fallback });
  console.error(`${store}: ${outcome}`);
  if (lastBody?.diagnostics) console.error("   ", JSON.stringify(lastBody.diagnostics));
}

const passes = rows.filter((r) => r.outcome.startsWith("✅")).length;
const partials = rows.filter((r) => r.outcome.startsWith("🟡")).length;
console.log(`# Store probe — ${new Date().toISOString().slice(0, 10)}\n`);
console.log(
  `**${passes} of ${rows.length} read fully, ${partials} partly, ${rows.length - passes - partials} refused or failed.**\n`,
);
console.log("| Store | Outcome | Found | Fallback |\n|---|---|---|---|");
for (const r of rows) console.log(`| ${r.store} | ${r.outcome} | ${r.found} | ${r.fallback} |`);
