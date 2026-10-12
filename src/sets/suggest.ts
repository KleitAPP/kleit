/**
 * The quick builder's three helpers (spec 5.1 #9, #10, #13), all pure so they can be checked
 * without a browser (scripts/check-suggest.ts):
 *
 *   - shuffle: random pieces from your own pool for the empty slots, each category once where
 *     the names say what the pieces are;
 *   - swipe: the pieces to cycle through for one slot - the same category as what is there
 *     first, then everything else, newest first;
 *   - Complete the look: for each empty slot the best next piece, by a plain score - a category
 *     the set does not have yet, the same store as a piece already on it, a price in the same
 *     band, a piece of your own - greedy, one slot at a time.
 *
 * "Your pool" is your closet, the pieces you hearted and your drawer (the clipped ones), cleared
 * only; Complete the look also looks at the stores of the pieces already placed. Nothing here
 * is a recommendation engine: a brand's own pieces go together, a coat is not a second coat,
 * and what you own beats what you would buy. That is the whole of it.
 */
import { categoryOf, type Category } from "@/items/category";
import type { ItemSummary } from "@/items/items";

export type Pick = { slot: number; item: ItemSummary };

function byId(pieces: ItemSummary[]): Map<string, ItemSummary> {
  const map = new Map<string, ItemSummary>();
  for (const p of pieces) if (!map.has(p.id)) map.set(p.id, p);
  return map;
}

/** One of each, in the order first seen: the pool may list a piece under two of its sources. */
export function dedupe(pieces: ItemSummary[]): ItemSummary[] {
  return [...byId(pieces).values()];
}

/**
 * Random pieces for the empty slots. Where categories are known, no category twice (a look with
 * two coats is not a look); when the pool runs out of new categories, anything goes.
 */
export function shufflePicks(
  pool: ItemSummary[],
  placed: ItemSummary[],
  emptySlots: number[],
  random: () => number = Math.random,
): Pick[] {
  const taken = new Set(placed.map((p) => p.id));
  const have = new Set<Category>();
  for (const p of placed) {
    const c = categoryOf(p.title);
    if (c) have.add(c);
  }
  let candidates = dedupe(pool).filter((p) => !taken.has(p.id));
  const picks: Pick[] = [];
  for (const slot of emptySlots) {
    if (candidates.length === 0) break;
    const fresh = candidates.filter((p) => {
      const c = categoryOf(p.title);
      return !c || !have.has(c);
    });
    const from = fresh.length > 0 ? fresh : candidates;
    const chosen = from[Math.min(from.length - 1, Math.floor(random() * from.length))]!;
    picks.push({ slot, item: chosen });
    const c = categoryOf(chosen.title);
    if (c) have.add(c);
    candidates = candidates.filter((p) => p.id !== chosen.id);
  }
  return picks;
}

/**
 * What a slot swipes through: the pool without what is on the set, the current piece's own
 * category first (a boot swaps for a boot), then the rest; the pool's own order inside each
 * half (newest first, as the lists come).
 */
export function cycleCandidates(
  current: ItemSummary,
  pool: ItemSummary[],
  placed: ItemSummary[],
): ItemSummary[] {
  const taken = new Set(placed.map((p) => p.id));
  taken.delete(current.id);
  const others = dedupe(pool).filter((p) => !taken.has(p.id) && p.id !== current.id);
  const category = categoryOf(current.title);
  if (!category) return others;
  const same = others.filter((p) => categoryOf(p.title) === category);
  const rest = others.filter((p) => categoryOf(p.title) !== category);
  return [...same, ...rest];
}

/**
 * The ring a slot swipes round: the candidates, then the piece it started with, so "next" a few
 * times walks through everything and comes home. `others` are the pieces on the set's other
 * slots, which never appear in the ring.
 */
export function cycleRing(
  origin: ItemSummary,
  pool: ItemSummary[],
  others: ItemSummary[],
): ItemSummary[] {
  return [...cycleCandidates(origin, pool, others), origin];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/**
 * Complete the look: the best next piece for each empty slot, greedily, by a plain score:
 *   +4 a category the set does not have yet (a known one; "unknown" counts as new once),
 *   +3 the same store as a piece already on the set,
 *   +5 a piece of your own (what you have beats what you would buy, even from the same store
 *      and in the price band: 9 to 8),
 *   +1 a price within half to double the set's typical price.
 * Ties keep the pool's order (your own things first, then the stores', newest first).
 */
export function completeLook(
  placed: ItemSummary[],
  emptySlots: number[],
  pool: ItemSummary[],
): Pick[] {
  if (placed.length === 0 || emptySlots.length === 0) return [];
  const taken = new Set(placed.map((p) => p.id));
  const have = new Set<Category>();
  for (const p of placed) {
    const c = categoryOf(p.title);
    if (c) have.add(c);
  }
  const stores = new Set(placed.map((p) => p.source_domain).filter((d): d is string => !!d));
  const typical = median(
    placed.map((p) => p.price_cents).filter((c): c is number => typeof c === "number" && c > 0),
  );
  let candidates = dedupe(pool).filter((p) => !taken.has(p.id));
  // A piece of no known kind counts as a new kind once - including one already on the set.
  let unknownUsed = placed.some((p) => !categoryOf(p.title));
  const picks: Pick[] = [];
  for (const slot of emptySlots) {
    if (candidates.length === 0) break;
    let best: { item: ItemSummary; score: number } | null = null;
    for (const item of candidates) {
      const c = categoryOf(item.title);
      let score = 0;
      if (c ? !have.has(c) : !unknownUsed) score += 4;
      if (item.source_domain && stores.has(item.source_domain)) score += 3;
      if (
        typical !== null &&
        typeof item.price_cents === "number" &&
        item.price_cents >= typical / 2 &&
        item.price_cents <= typical * 2
      )
        score += 1;
      if (item.kind === "own") score += 5;
      if (!best || score > best.score) best = { item, score };
    }
    if (!best) break;
    picks.push({ slot, item: best.item });
    const c = categoryOf(best.item.title);
    if (c) have.add(c);
    else unknownUsed = true;
    candidates = candidates.filter((p) => p.id !== best!.item.id);
  }
  return picks;
}
