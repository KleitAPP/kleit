import { supabase } from "@/integrations/supabase/client";
import type { ItemSummary } from "@/items/items";
import type { Person } from "@/social/follows";

/**
 * Search (roadmap M6.1; spec 9 #1): items, sets, people and stores. Every query runs through a
 * function that runs as you, so the row policies decide what comes back - a private set never
 * does, and only cleared products are items.
 */
export type SetHit = {
  id: string;
  title: string;
  owner_id: string;
  preview_image_id: string | null;
  published_at: string | null;
  layout: { caption?: string } | null;
};
export type Store = { domain: string; store_name: string | null; products: number };

const ITEM_FIELDS =
  "id, kind, title, price_cents, price_currency, store_name, source_url, source_domain, image_id, image_bucket, created_at";

export async function searchItems(
  q: string,
  store: string | null,
  maxCents: number | null,
): Promise<ItemSummary[]> {
  const { data } = await supabase.rpc("search_items", {
    q,
    ...(store ? { p_store: store } : {}),
    ...(maxCents ? { p_max_cents: maxCents } : {}),
    p_limit: 40,
  });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const out: Record<string, unknown> = {};
    for (const k of ITEM_FIELDS.split(", ")) out[k] = r[k] ?? null;
    return out as unknown as ItemSummary;
  });
}

export async function searchSets(q: string): Promise<SetHit[]> {
  const { data } = await supabase.rpc("search_sets", { q, p_limit: 40 });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r["id"] as string,
    title: r["title"] as string,
    owner_id: r["owner_id"] as string,
    preview_image_id: (r["preview_image_id"] as string | null) ?? null,
    published_at: (r["published_at"] as string | null) ?? null,
    layout: (r["layout"] as SetHit["layout"]) ?? null,
  }));
}

export async function setsByTag(tag: string): Promise<SetHit[]> {
  const { data } = await supabase.rpc("sets_by_tag", { p_tag: tag, p_limit: 60 });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r["id"] as string,
    title: r["title"] as string,
    owner_id: r["owner_id"] as string,
    preview_image_id: (r["preview_image_id"] as string | null) ?? null,
    published_at: (r["published_at"] as string | null) ?? null,
    layout: (r["layout"] as SetHit["layout"]) ?? null,
  }));
}

export async function popularTags(): Promise<{ tag: string; sets: number }[]> {
  const { data } = await supabase.rpc("popular_tags", { p_limit: 40 });
  return (data ?? []) as { tag: string; sets: number }[];
}

/** Typed tags → the shape the database accepts: lowercase, letters/digits/hyphens, 1–30, unique, ≤20. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,#]+/)) {
    const tag = raw
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+/, "")
      .slice(0, 30);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length === 20) break;
  }
  return out;
}

export async function searchPeople(q: string): Promise<Person[]> {
  const needle = q.trim().toLowerCase().replace(/^@/, "");
  if (needle.length < 2) return [];
  const { data } = await supabase
    .from("profiles")
    .select("user_id, username, display_name, is_private")
    .or(`username.ilike.${needle}%,display_name.ilike.%${needle}%`)
    .limit(20);
  return (data ?? []) as Person[];
}

export async function stores(): Promise<Store[]> {
  const { data } = await supabase.rpc("stores", { p_limit: 50 });
  return (data ?? []) as Store[];
}

/** The public picture of a set, if it has one (the same file the share page shows a chat). */
export function previewUrl(set: { preview_image_id: string | null }): string | null {
  const base = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
  if (!base || !set.preview_image_id) return null;
  return `${base}/storage/v1/object/public/set-previews/${set.preview_image_id}`;
}
