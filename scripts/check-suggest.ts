/**
 * Proves the quick builder's three helpers with no browser (spec 5.1 #9, #10, #13;
 * src/sets/suggest.ts and src/items/category.ts): a name reads as the right kind of piece,
 * Shuffle never repeats a kind while it can help it, a slot's swipe ring is its own kind first
 * and comes home, and Complete the look prefers a kind the set lacks, the same store, the same
 * price band and your own things - in that order.
 *
 * Run: bun scripts/check-suggest.ts   (CI runs it on every push)
 */
import { categoryOf } from "../src/items/category";
import type { ItemSummary } from "../src/items/items";
import { completeLook, cycleRing, dedupe, shufflePicks } from "../src/sets/suggest";

let n = 0;
let failed = 0;
function check(ok: boolean, what: string, detail = "") {
  n += 1;
  console.log(`${ok ? "ok" : "not ok"} ${n} - ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
}

// 1. A name reads as a kind of piece.
const kinds: Array<[string, ReturnType<typeof categoryOf>]> = [
  ["Cropped Wool Blazer", "outer"],
  ["Boot cut jeans", "bottom"],
  ["Shirt dress", "dress"],
  ["Dress shirt", "top"],
  ["Dress shoes", "shoes"],
  ["Chelsea boots", "shoes"],
  ["Leather tote", "bag"],
  ["Silk scarf", "accessory"],
  ["Denim jacket", "outer"],
  ["Pleated midi skirt", "bottom"],
  ["Tie-dye tee", "top"],
  ["Ring detail top", "top"],
  ["Puffer vest", "outer"],
  ["Jacket dress", "dress"],
  ["Shoe bag", "bag"],
  ["Boot socks", "accessory"],
  ["Oxford shirt", "top"],
  ["Knit beanie", "accessory"],
  ["Flat cap", "accessory"],
  ["Dress watch", "accessory"],
  ["Straight jeans in black", "bottom"],
  ["Two-piece set", null],
  ["Gold hoop earrings", "accessory"],
  ["Piece 1", null],
  ["", null],
];
for (const [name, want] of kinds) {
  check(
    categoryOf(name) === want,
    `"${name}" reads as ${want ?? "unknown"}`,
    String(categoryOf(name)),
  );
}
check(categoryOf(null) === null, "no name reads as unknown");

// A small catalogue.
let next = 0;
function piece(title: string, extra: Partial<ItemSummary> = {}): ItemSummary {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    kind: "product",
    title,
    price_cents: null,
    price_currency: "USD",
    store_name: null,
    source_url: null,
    source_domain: null,
    image_id: null,
    image_bucket: "item-images",
    created_at: "2026-10-12T00:00:00Z",
    ...extra,
  };
}
const coat = piece("Wool coat", { source_domain: "a.example", price_cents: 30000 });
const coat2 = piece("Trench coat", { source_domain: "b.example", price_cents: 25000 });
const boots = piece("Chelsea boots", { source_domain: "a.example", price_cents: 15000 });
const sneakers = piece("White sneakers", { source_domain: "b.example", price_cents: 9000 });
const tote = piece("Leather tote", { source_domain: "a.example", price_cents: 20000 });
const tee = piece("Striped tee", { source_domain: "a.example", price_cents: 3000 });
const jeansA = piece("Straight jeans", { source_domain: "a.example", price_cents: 4000 });
const jeansB = piece("Wide-leg jeans", { source_domain: "b.example", price_cents: 3500 });
const ownJeans = piece("My jeans", { kind: "own" });
const mystery1 = piece("Piece 1");
const mystery2 = piece("Piece 2");

// 2. Dedupe keeps one of each, first seen first.
check(
  dedupe([coat, boots, coat, tote, boots])
    .map((p) => p.id)
    .join() === [coat, boots, tote].map((p) => p.id).join(),
  "a pool lists each piece once, in the order first seen",
);

// 3. Shuffle.
const seeded = (seq: number[]) => {
  let i = 0;
  return () => seq[i++ % seq.length]!;
};
const shuffled = shufflePicks([coat, boots, tote], [], [0, 1], seeded([0.99, 0.0]));
check(
  shuffled.length === 2 &&
    shuffled[0]!.slot === 0 &&
    shuffled[1]!.slot === 1 &&
    shuffled[0]!.item.id !== shuffled[1]!.item.id,
  "shuffle fills the empty slots, a different piece in each",
  shuffled.map((p) => p.item.title).join(" / "),
);
const noRepeatKind = shufflePicks([coat2, boots], [coat], [1], seeded([0.0]));
check(
  noRepeatKind[0]?.item.id === boots.id,
  "shuffle avoids a kind the set already has while it can",
  noRepeatKind[0]?.item.title ?? "",
);
const onlyCoats = shufflePicks([coat2], [coat], [1], seeded([0.0]));
check(onlyCoats[0]?.item.id === coat2.id, "…and takes what there is when every piece is that kind");
check(shufflePicks([], [], [0, 1]).length === 0, "an empty pool shuffles nothing");
check(
  shufflePicks([coat, boots], [coat, boots], [2]).length === 0,
  "pieces already on the set are never shuffled in again",
);
const manyKinds = shufflePicks(
  [coat, boots, tote, tee],
  [],
  [0, 1, 2, 3],
  seeded([0.5, 0.5, 0.5, 0.5]),
);
check(
  new Set(manyKinds.map((p) => categoryOf(p.item.title))).size === 4,
  "four empty slots from four kinds get one of each",
  manyKinds.map((p) => p.item.title).join(" / "),
);

// 4. The swipe ring.
const ring = cycleRing(boots, [coat, sneakers, tote, boots, coat], [coat]);
check(
  ring.map((p) => p.id).join() === [sneakers, tote, boots].map((p) => p.id).join(),
  "a slot's ring is its own kind first, then the rest, then home; the set's other pieces stay out",
  ring.map((p) => p.title).join(" → "),
);
check(
  cycleRing(mystery1, [coat, mystery1], [])
    .map((p) => p.id)
    .join() === [coat, mystery1].map((p) => p.id).join(),
  "a piece of no known kind rings through everything",
);
check(
  cycleRing(boots, [boots], []).length === 1,
  "with nothing else in the pool the ring is the piece itself",
);

// 5. Complete the look.
const look = completeLook([tee], [1, 2], [jeansB, coat, jeansA, tee]);
check(
  look.map((p) => p.item.id).join() === [jeansA, coat].map((p) => p.id).join(),
  "complete the look: the same store's trousers in the same price band first, then the coat (a kind the set lacks) over a second pair of jeans",
  look.map((p) => `${p.slot}:${p.item.title}`).join(" / "),
);
const own = completeLook([tee], [1], [jeansB, ownJeans]);
check(
  own[0]?.item.id === ownJeans.id,
  "your own piece beats one you would buy, even one in the price band",
  own[0]?.item.title ?? "",
);
const ownVsStore = completeLook([tee], [1], [jeansA, ownJeans]);
check(
  ownVsStore[0]?.item.id === ownJeans.id,
  "…and even the same store's pair in the price band: what you have beats what you would buy",
  ownVsStore[0]?.item.title ?? "",
);
const unknownOnSet = completeLook([mystery1], [1], [mystery2, tee]);
check(
  unknownOnSet[0]?.item.id === tee.id,
  "a piece of no known kind already on the set means the next unknown is not 'new'",
  unknownOnSet[0]?.item.title ?? "",
);
const unknowns = completeLook([tee], [1, 2], [mystery1, mystery2]);
check(
  unknowns.length === 2 && unknowns[0]!.item.id === mystery1.id,
  "pieces of no known kind still fill the slots, in pool order",
);
check(completeLook([], [0, 1], [coat]).length === 0, "nothing on the set: nothing to complete");
check(completeLook([tee], [], [coat]).length === 0, "no empty slot: nothing to complete");
check(
  completeLook([tee, coat], [2], [coat, tee]).length === 0,
  "the pieces already on the set are never suggested",
);
const sameStore = completeLook([boots], [1], [jeansB, jeansA]);
check(
  sameStore[0]?.item.id === jeansA.id,
  "two pairs of jeans: the one from the same store wins",
  sameStore[0]?.item.title ?? "",
);

console.log(`1..${n}`);
console.log(
  failed === 0 ? `# suggest: all ${n} checks passed` : `# suggest: ${failed} of ${n} checks FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
