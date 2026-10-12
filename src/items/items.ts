/**
 * Reading items for the person who is signed in (roadmap M2.7; design pack S38-S40).
 *
 * Everything here goes through the database's own row policies - the app asks for "my closet"
 * and the database decides what that means. There is no filtering in this file that the
 * database is not already doing; the filters here are for shape, not for safety.
 */
import { supabase } from "@/integrations/supabase/client";
import { isNetworkError, isOnline } from "@/offline/net";
import { blobGet, blobPut, cacheGet, cachePut } from "@/offline/store";

export type ScanState = "pending" | "clean" | "review" | "blocked";

export type ItemSummary = {
  id: string;
  kind: "product" | "non_product" | "own";
  title: string | null;
  price_cents: number | null;
  price_currency: string | null;
  store_name: string | null;
  source_url: string | null;
  source_domain: string | null;
  image_id: string | null;
  image_bucket: "item-images" | "closet-photos";
  created_at: string;
  /** The price before the last drop the watch saw (migration 088); null once it rose again. */
  price_was_cents?: number | null;
  /** Set when the store page answered "gone" twice: Buy no longer points at it. */
  dead_link_at?: string | null;
};

const ITEM_FIELDS =
  "id, kind, title, price_cents, price_currency, store_name, source_url, source_domain, image_id, image_bucket, created_at, price_was_cents, dead_link_at";

/** Your closet: the pieces you own, newest first. Private by default; the row policy enforces it. */
export async function myCloset(): Promise<ItemSummary[]> {
  // Offline (M8.5): the last good copy. The pictures come from `cachedImageUrl` below.
  if (!isOnline()) return (await cacheGet<ItemSummary[]>("closet"))?.value ?? [];
  const { data, error } = await supabase
    .from("closet_items")
    .select(`item:items(${ITEM_FIELDS})`)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error && isNetworkError(error)) return (await cacheGet<ItemSummary[]>("closet"))?.value ?? [];
  if (error || !data) return [];
  const list = data.flatMap((row) => (row.item ? [row.item as unknown as ItemSummary] : []));
  void cachePut("closet", list);
  return list;
}

/** A closet piece in the bin: what Recently deleted shows (S26). */
export type DeletedPiece = { item: ItemSummary; deleted_at: string };

/**
 * Your closet pieces in the bin, the most recently deleted first. A piece whose picture the
 * purge has already taken, or that was taken down, is not offered back: Restore would hand the
 * person an empty tile.
 */
export async function recentlyDeletedPieces(): Promise<DeletedPiece[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("closet_items")
    .select(`deleted_at, item:items(${ITEM_FIELDS}, purged_at, takedown_state)`)
    .not("deleted_at", "is", null)
    .gte("deleted_at", since)
    .order("deleted_at", { ascending: false });
  if (error || !data) return [];
  const out: DeletedPiece[] = [];
  for (const row of data) {
    const item = row.item as unknown as
      (ItemSummary & { purged_at: string | null; takedown_state: string }) | null;
    if (!item || !row.deleted_at || item.purged_at || item.takedown_state !== "none") continue;
    out.push({ item, deleted_at: row.deleted_at });
  }
  return out;
}

/** Whether this piece is in YOUR closet right now. The closet table answers nobody else. */
export async function inMyCloset(itemId: string): Promise<boolean> {
  const { data } = await supabase
    .from("closet_items")
    .select("item_id")
    .eq("item_id", itemId)
    .is("deleted_at", null)
    .maybeSingle();
  return !!data;
}

/** How many of your own sets hold this piece - the "used in 12 sets" warning (spec 7.1 #11). */
export async function closetItemUses(itemId: string): Promise<number> {
  const { data } = await supabase.rpc("closet_item_uses", { p_item_id: itemId });
  return typeof data === "number" ? data : 0;
}

/**
 * Out of the closet and into the bin for 30 days. `keepInSets` leaves the piece on your sets
 * exactly as it is; otherwise it comes off them and is hidden from everyone at once. Returns
 * null when it did not happen.
 */
export async function deleteClosetItem(
  itemId: string,
  keepInSets: boolean,
): Promise<{ removedFromSets: number } | null> {
  const { data, error } = await supabase.rpc("delete_closet_item", {
    p_item_id: itemId,
    p_keep_in_sets: keepInSets,
  });
  if (error) return null;
  return { removedFromSets: typeof data === "number" ? data : 0 };
}

/** Back into the closet. False when its 30 days are up or the picture is already gone. */
export async function restoreClosetItem(itemId: string): Promise<boolean> {
  const { error } = await supabase.rpc("restore_closet_item", { p_item_id: itemId });
  return !error;
}

/** Delete now: off your sets, hidden from everyone, out of the bin. The file follows nightly. */
export async function eraseClosetItem(itemId: string): Promise<boolean> {
  const { error } = await supabase.rpc("erase_closet_item", { p_item_id: itemId });
  return !error;
}

/** How many closet pictures are kept on the phone for offline use (the newest first). */
export const OFFLINE_PICTURES = 60;

/**
 * A picture for the closet that works with no signal: online, the signed address as before,
 * and the bytes are kept on the phone on the way past; offline, the kept bytes as an object
 * URL, or null when this one was never kept. The caller revokes object URLs it no longer shows.
 */
export async function cachedImageUrl(
  item: Pick<ItemSummary, "id" | "kind" | "image_id" | "image_bucket">,
  keep: boolean,
): Promise<string | null> {
  if (!isOnline()) {
    const blob = await blobGet(item.id);
    return blob ? URL.createObjectURL(blob) : null;
  }
  const url = await imageUrlFor(item);
  if (url && keep) {
    void fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => (blob && blob.size > 0 ? blobPut(item.id, blob) : undefined))
      .catch(() => undefined);
  }
  return url;
}

/** Your drawer: what you clipped, cut out, or picked up (decision 103). Newest first. */
export async function myDrawer(): Promise<ItemSummary[]> {
  const { data, error } = await supabase
    .from("drawer_items")
    .select(`item:items(${ITEM_FIELDS})`)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.flatMap((row) => (row.item ? [row.item as unknown as ItemSummary] : []));
}

/** "My items": the catalogue items you have hearted. */
export async function mySavedItems(): Promise<ItemSummary[]> {
  const { data, error } = await supabase
    .from("saved_items")
    .select(`item:items(${ITEM_FIELDS})`)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.flatMap((row) => (row.item ? [row.item as unknown as ItemSummary] : []));
}

/* ── Hearting (S39; spec 11 #4). A save is of a cleared product; the policy refuses anything else. ── */

export async function isSaved(itemId: string): Promise<boolean> {
  const { data } = await supabase
    .from("saved_items")
    .select("item_id")
    .eq("item_id", itemId)
    .maybeSingle();
  return !!data;
}

/** Which of these pieces you have saved - one question for a whole list. */
export async function savedItemIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await supabase.from("saved_items").select("item_id").in("item_id", ids);
  return new Set((data ?? []).map((r) => r.item_id));
}

export async function saveItem(itemId: string): Promise<boolean> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return false;
  const { error } = await supabase.from("saved_items").insert({ user_id: me, item_id: itemId });
  return !error || error.code === "23505";
}

export async function unsaveItem(itemId: string): Promise<boolean> {
  const { error } = await supabase.from("saved_items").delete().eq("item_id", itemId);
  return !error;
}

/** One item, if the row policy lets you see it. Null otherwise - and null for "does not exist". */
export async function oneItem(id: string): Promise<ItemSummary | null> {
  const { data } = await supabase.from("items").select(ITEM_FIELDS).eq("id", id).maybeSingle();
  return (data as unknown as ItemSummary | null) ?? null;
}

/**
 * Whether each of YOUR items has passed screening. One word per item; items that are not yours
 * are simply absent from the answer (migration 015).
 */
export async function myScanStates(ids: string[]): Promise<Map<string, ScanState>> {
  const states = new Map<string, ScanState>();
  if (ids.length === 0) return states;
  // Offline (M8.5): the last answers, so a cleared piece is not shown as "Checking" for no reason.
  const remembered = async () => {
    const kept = (await cacheGet<Record<string, ScanState>>("scanStates"))?.value ?? {};
    for (const id of ids) if (kept[id]) states.set(id, kept[id]);
    return states;
  };
  if (!isOnline()) return remembered();
  const { data, error } = await supabase.rpc("my_items_scan_states", { p_item_ids: ids });
  if (error && isNetworkError(error)) return remembered();
  for (const row of data ?? []) states.set(row.item_id, row.scan_state as ScanState);
  const kept = (await cacheGet<Record<string, ScanState>>("scanStates"))?.value ?? {};
  for (const [id, state] of states) kept[id] = state;
  void cachePut("scanStates", kept);
  return states;
}

/**
 * A URL the browser can load for an item's picture, or null if there is none you may see.
 *
 * Your own pictures live in private buckets, so the URL is a signed one that stops working
 * after an hour - long enough for a screen, short enough that a copied link is not a permanent
 * hole. Other people's cleared products come through the item-image function, which asks the
 * screening question the bucket cannot; Cloudflare Images takes that over at the domain stage.
 */
export async function imageUrlFor(
  item: Pick<ItemSummary, "id" | "kind" | "image_id" | "image_bucket">,
): Promise<string | null> {
  if (!item.image_id) return null;
  // Your own pictures: both buckets let the owner read their own folder (migrations 011 and
  // 016), so a signed URL works and shows a piece that is still being checked.
  const { data } = await supabase.storage
    .from(item.image_bucket)
    .createSignedUrl(item.image_id, 60 * 60);
  if (data?.signedUrl) return data.signedUrl;
  // Somebody else's product: the item-image function answers only once screening has cleared
  // it, and stands in for Cloudflare Images until the domain stage.
  if (item.kind === "product") {
    const base = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
    if (!base) return null;
    const url = new URL("/functions/v1/item-image", base);
    url.searchParams.set("item", item.id);
    return url.toString();
  }
  return null;
}

/** "$24.00" from cents and a currency; null when there is no price. */
export function priceLabel(
  item: Pick<ItemSummary, "price_cents" | "price_currency">,
): string | null {
  if (item.price_cents == null) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: item.price_currency ?? "USD",
    }).format(item.price_cents / 100);
  } catch {
    return `${(item.price_cents / 100).toFixed(2)} ${item.price_currency ?? ""}`.trim();
  }
}

/**
 * The Buy link. It goes through our redirect so the tap is counted, and it opens in the phone's
 * own browser (spec 8.2 #14). Null when the item has no store to buy it from.
 */
export function buyUrlFor(
  item: Pick<ItemSummary, "id" | "source_url" | "dead_link_at">,
  setId?: string,
): string | null {
  // A page that answered "gone" twice (migration 088) is not somewhere to send anyone.
  if (!item.source_url || item.dead_link_at) return null;
  const base = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
  if (!base) return null;
  const url = new URL("/functions/v1/buy-redirect", base);
  url.searchParams.set("item", item.id);
  if (setId) url.searchParams.set("set", setId);
  return url.toString();
}
