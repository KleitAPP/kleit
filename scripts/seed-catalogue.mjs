/**
 * M2.8 — the fake catalogue for building (roadmap M2.8; technical pack §7 #5).
 *
 * Sixty items across ten categories, so that lists, the item picker, search and the feed have
 * something real-looking in them while they are being built - with **no real store data and no
 * real people**. The pictures are public-domain garment photographs from The Met's Costume
 * Institute (department 8), fetched through the Met's own open-access API and filtered to
 * `isPublicDomain: true`: dresses, coats, hats and shoes on mannequins, photographed by the
 * museum. Each item's locked source is the object's own Met page, so Buy goes somewhere honest.
 *
 * What it does, as the server, against the live project:
 *   1. makes (once) the account that owns the catalogue: `catalogue@test.kleit`, one of the test
 *      accounts the technical pack names, with a profile so it looks like a person;
 *   2. removes any catalogue items from an earlier run (they carry `credit = "seed:met"`);
 *   3. for each category, asks the Met for public-domain objects with a picture, copies the
 *      picture into `item-images` under the account's folder (the one stored original), writes
 *      the item, its clip record (trigger `upload`) and a drawer row - exactly the rows a real
 *      clip writes - and leaves screening to the sweeper, so the catalogue goes through the same
 *      gate as everything else.
 *
 * Run by CI (workflow "seed-catalogue", by hand). Needs SEED_URL and SEED_KEY (the service key).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SEED_URL;
const key = process.env.SEED_KEY;
if (!url || !key) {
  console.error("SEED_URL and SEED_KEY are required");
  process.exit(2);
}
const server = createClient(url, key, { auth: { persistSession: false } });

const MET = "https://collectionapi.metmuseum.org/public/collection/v1";
const CATEGORIES = [
  { name: "dress", query: "dress", want: 8 },
  { name: "coat", query: "coat", want: 6 },
  { name: "jacket", query: "jacket", want: 6 },
  { name: "skirt", query: "skirt", want: 6 },
  { name: "blouse", query: "blouse", want: 6 },
  { name: "hat", query: "hat", want: 6 },
  { name: "bag", query: "bag", want: 6 },
  { name: "shoes", query: "shoes", want: 6 },
  { name: "gloves", query: "gloves", want: 5 },
  { name: "shawl", query: "shawl", want: 5 },
];
const SEED_EMAIL = "catalogue@test.kleit";
const SEED_USERNAME = "samplecloset";
const CREDIT = "seed:met";

// ---------------------------------------------------------------------------
// 1. The account
// ---------------------------------------------------------------------------
async function seedAccount() {
  const { data: list } = await server.auth.admin.listUsers({ perPage: 1000 });
  let user = list?.users.find((u) => u.email === SEED_EMAIL);
  if (!user) {
    const { data, error } = await server.auth.admin.createUser({ email: SEED_EMAIL, email_confirm: true });
    if (error) throw new Error(`could not make the seed account: ${error.message}`);
    user = data.user;
    console.error("made the seed account");
  }
  const { data: profile } = await server.from("profiles").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!profile) {
    const { error } = await server.from("profiles").insert({
      user_id: user.id,
      username: SEED_USERNAME,
      display_name: "Sample Closet",
      bio: "A pretend account that owns the sample catalogue. Not a real person.",
      age_confirmed_at: new Date().toISOString(),
      terms_version: "seed",
    });
    if (error) throw new Error(`could not make the seed profile: ${error.message}`);
    console.error("made the seed profile");
  }
  return user.id;
}

// ---------------------------------------------------------------------------
// 2. Clear the last run
// ---------------------------------------------------------------------------
async function clearLastRun(ownerId) {
  const { data: old } = await server.from("items").select("id, image_id").eq("owner_id", ownerId).eq("credit", CREDIT);
  if (!old?.length) return;
  const paths = old.map((i) => i.image_id).filter(Boolean);
  if (paths.length) await server.storage.from("item-images").remove(paths);
  const { error } = await server.from("items").delete().eq("owner_id", ownerId).eq("credit", CREDIT);
  if (error) throw new Error(`could not clear the last run: ${error.message}`);
  console.error(`cleared ${old.length} item(s) from the last run`);
}

// ---------------------------------------------------------------------------
// 3. The Met
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The Met's API is generous but not to a burst: a small pause per call, and a back-off on 403/429. */
async function metJson(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(250);
    const response = await fetch(`${MET}${path}`, { headers: { Accept: "application/json", "User-Agent": "kleit-seed/1 (kleitapp.team@gmail.com)" } });
    if (response.ok) return response.json();
    if (response.status === 403 || response.status === 429 || response.status >= 500) {
      console.error(`  Met ${response.status}; waiting ${(attempt + 1) * 15}s`);
      await sleep((attempt + 1) * 15000);
      continue;
    }
    throw new Error(`Met ${path}: ${response.status}`);
  }
  throw new Error(`Met ${path}: gave up`);
}

/** A deterministic, plausible price from the object id: $18 to $240, ending in .00 or .50. */
function fakePriceCents(objectId) {
  const base = 1800 + ((objectId * 7919) % 22200);
  return base - (base % 50);
}

async function pickObjects(category) {
  const search = await metJson(`/search?departmentId=8&hasImages=true&q=${encodeURIComponent(category.query)}`);
  const ids = (search.objectIDs ?? []).slice(0, 80);
  const picked = [];
  for (const id of ids) {
    if (picked.length >= category.want) break;
    let object;
    try {
      object = await metJson(`/objects/${id}`);
    } catch {
      continue;
    }
    if (!object.isPublicDomain || !object.primaryImage) continue;
    // A garment, not a print of one. Prints and drawings show people.
    const kind = `${object.objectName ?? ""} ${object.classification ?? ""}`.toLowerCase();
    if (/print|drawing|photograph|fashion plate|engraving|book|album/.test(kind)) continue;
    if (!object.title || object.title.length < 3) continue;
    picked.push(object);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// 4. One item, the way a real clip writes it
// ---------------------------------------------------------------------------
async function seedItem(ownerId, category, object) {
  const response = await fetch(object.primaryImageSmall || object.primaryImage);
  if (!response.ok) throw new Error(`image ${object.objectID}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const imageId = `${ownerId}/met-${object.objectID}.jpg`;
  const stored = await server.storage.from("item-images").upload(imageId, bytes, { contentType: "image/jpeg", upsert: true });
  if (stored.error) throw new Error(`store ${object.objectID}: ${stored.error.message}`);

  const sourceUrl = object.objectURL || `https://www.metmuseum.org/art/collection/search/${object.objectID}`;
  const storeName = object.artistDisplayName?.trim() ? object.artistDisplayName.trim().slice(0, 80) : "Sample Store";
  const { data: item, error } = await server
    .from("items")
    .insert({
      owner_id: ownerId,
      kind: "product",
      title: object.title.slice(0, 120),
      price_cents: fakePriceCents(object.objectID),
      price_currency: "USD",
      price_checked_at: new Date().toISOString(),
      store_name: storeName,
      source_url: sourceUrl,
      source_domain: "metmuseum.org",
      image_id: imageId,
      image_bucket: "item-images",
      color_name: null,
      alt_text: `${object.title}${object.objectDate ? `, ${object.objectDate}` : ""}`.slice(0, 200),
      credit: CREDIT,
    })
    .select("id")
    .single();
  if (error || !item) {
    await server.storage.from("item-images").remove([imageId]);
    throw new Error(`item ${object.objectID}: ${error?.message}`);
  }
  const record = await server.from("clip_records").insert({
    user_id: ownerId,
    item_id: item.id,
    image_id: imageId,
    source_url: sourceUrl,
    trigger: "upload",
  });
  if (record.error) throw new Error(`clip record ${object.objectID}: ${record.error.message}`);
  await server.from("drawer_items").insert({ user_id: ownerId, item_id: item.id, origin: "clipped" });
  return { id: item.id, category: category.name, title: object.title, date: object.objectDate };
}

// ---------------------------------------------------------------------------
const ownerId = await seedAccount();
await clearLastRun(ownerId);

const made = [];
for (const category of CATEGORIES) {
  const objects = await pickObjects(category);
  console.error(`${category.name}: ${objects.length} public-domain object(s) with a picture`);
  for (const object of objects) {
    try {
      made.push(await seedItem(ownerId, category, object));
    } catch (problem) {
      console.error("  skipped:", problem instanceof Error ? problem.message : problem);
    }
  }
}

console.log(`# Sample catalogue — ${new Date().toISOString().slice(0, 10)}\n`);
console.log(`**${made.length} items seeded** for @${SEED_USERNAME}, all public-domain Met Costume Institute objects. Screening runs through the sweeper like everything else.\n`);
console.log("| Category | Title | Date |\n|---|---|---|");
for (const m of made) console.log(`| ${m.category} | ${m.title.replace(/\|/g, "/")} | ${m.date ?? ""} |`);
if (made.length < 50) {
  console.error(`only ${made.length} items; expected about 60`);
  process.exit(1);
}
