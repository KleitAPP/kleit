/**
 * The pieces the quick builder's helpers draw from (spec 5.1 #9, #10, #13): yours first - the
 * closet, the pieces you hearted, your drawer - then, for Complete the look, the stores of the
 * pieces already placed (a brand's own pieces go together), through the same search the store
 * page uses. Both halves go through the scan states before they count: another person's row is
 * readable only once cleared, but your own rows are readable in every state, and a piece still
 * being checked must not land on a set where nobody else would see it.
 */
import { myCloset, myDrawer, mySavedItems, myScanStates, type ItemSummary } from "@/items/items";
import { searchItems } from "@/search/search";
import { dedupe } from "@/sets/suggest";

/** The cleared ones: a row with no answer is somebody else's, readable only because it is cleared. */
async function cleared(pieces: ItemSummary[]): Promise<ItemSummary[]> {
  const states = await myScanStates(pieces.map((p) => p.id));
  return pieces.filter((p) => (states.get(p.id) ?? "clean") === "clean");
}

/** Your own pool: closet, hearts, drawer - one of each, cleared only, newest first within each. */
export async function myPool(drawer?: ItemSummary[]): Promise<ItemSummary[]> {
  const [closet, saved, clips] = await Promise.all([
    myCloset(),
    mySavedItems(),
    drawer ? Promise.resolve(drawer) : myDrawer(),
  ]);
  return cleared(dedupe([...closet, ...saved, ...clips]));
}

/** The pieces of the stores already on the set, at most two stores, after your own pool. */
export async function lookPool(placed: ItemSummary[], own: ItemSummary[]): Promise<ItemSummary[]> {
  const stores = [...new Set(placed.map((p) => p.source_domain).filter((d): d is string => !!d))];
  const fromStores = await Promise.all(stores.slice(0, 2).map((d) => searchItems("", d, null)));
  const ownIds = new Set(own.map((p) => p.id));
  const fresh = await cleared(dedupe(fromStores.flat()).filter((p) => !ownIds.has(p.id)));
  return dedupe([...own, ...fresh]);
}
