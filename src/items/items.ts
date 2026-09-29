/**
 * Reading items for the person who is signed in (roadmap M2.7; design pack S38-S40).
 *
 * Everything here goes through the database's own row policies - the app asks for "my closet"
 * and the database decides what that means. There is no filtering in this file that the
 * database is not already doing; the filters here are for shape, not for safety.
 */
import { supabase } from "@/integrations/supabase/client";

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
};

const ITEM_FIELDS =
  "id, kind, title, price_cents, price_currency, store_name, source_url, source_domain, image_id, image_bucket, created_at";

/** Your closet: the pieces you own, newest first. Private by default; the row policy enforces it. */
export async function myCloset(): Promise<ItemSummary[]> {
  const { data, error } = await supabase
    .from("closet_items")
    .select(`item:items(${ITEM_FIELDS})`)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.flatMap((row) => (row.item ? [row.item as unknown as ItemSummary] : []));
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
  const { data } = await supabase.rpc("my_items_scan_states", { p_item_ids: ids });
  for (const row of data ?? []) states.set(row.item_id, row.scan_state as ScanState);
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
  item: Pick<ItemSummary, "id" | "source_url">,
  setId?: string,
): string | null {
  if (!item.source_url) return null;
  const base = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
  if (!base) return null;
  const url = new URL("/functions/v1/buy-redirect", base);
  url.searchParams.set("item", item.id);
  if (setId) url.searchParams.set("set", setId);
  return url.toString();
}
