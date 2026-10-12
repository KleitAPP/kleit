/**
 * The pieces the quick builder's helpers draw from (spec 5.1 #9, #10, #13): yours first - the
 * closet, the pieces you hearted, your drawer - cleared only, so nothing lands on a set that
 * the rest of the world cannot see; then, for Complete the look, the stores of the pieces
 * already placed (a brand's own pieces go together), through the same search the store page
 * uses, which the row policies answer with cleared products only.
 */
import { myCloset, myDrawer, mySavedItems, myScanStates, type ItemSummary } from "@/items/items";
import { searchItems } from "@/search/search";
import { dedupe } from "@/sets/suggest";

/** Your own pool: closet, hearts, drawer - one of each, cleared only, newest first within each. */
export async function myPool(): Promise<ItemSummary[]> {
  const [closet, saved, drawer] = await Promise.all([myCloset(), mySavedItems(), myDrawer()]);
  const all = dedupe([...closet, ...saved, ...drawer]);
  const states = await myScanStates(all.map((p) => p.id));
  return all.filter((p) => (states.get(p.id) ?? "clean") === "clean");
}

/** The pieces of the stores already on the set, at most two stores, after your own pool. */
export async function lookPool(placed: ItemSummary[], own: ItemSummary[]): Promise<ItemSummary[]> {
  const stores = [...new Set(placed.map((p) => p.source_domain).filter((d): d is string => !!d))];
  const fromStores = await Promise.all(stores.slice(0, 2).map((d) => searchItems("", d, null)));
  return dedupe([...own, ...fromStores.flat()]);
}
