/**
 * Sets, from the app's side (roadmap M3.2; spec 5.1; design pack S42-S45).
 *
 * The layout a Quick set carries is small and the database holds it whole (`sets.layout`):
 *
 *   { version: 1, template: <template id>, background: "#rrggbb", caption: "" }
 *
 * The pieces are rows in `set_items`, one per slot, with `position = { slot: n }`. Two places
 * on purpose: the layout is what autosave writes on every change (guardrail 1: never lose work),
 * and set_items is what everything else reads - "sets with this item", the picker, the share
 * page - without parsing anybody's layout.
 *
 * Every write here goes through the row policies or a server function, so a set can only ever
 * be its owner's.
 */
import { supabase } from "@/integrations/supabase/client";
import { type ItemSummary } from "@/items/items";

export type QuickLayout = {
  version: 1;
  template: string;
  /** A fixed colour written into the set. Never a theme token: a set is the person's artwork (L14). */
  background: string;
  caption: string;
};

export type TemplateSlot = { x: number; y: number; w: number; h: number };
export type Template = {
  id: string;
  name: string;
  kind: "slot" | "stacked";
  layout: { canvas: { w: number; h: number }; slots: TemplateSlot[] };
};

export type SetSummary = {
  id: string;
  title: string;
  status: "draft" | "published";
  visibility: "public" | "link" | "followers" | "friends" | "only_me";
  share_code: string;
  layout: QuickLayout;
  updated_at: string;
};

export type Placement = { slot: number; item: ItemSummary };

const ITEM_FIELDS =
  "id, kind, title, price_cents, price_currency, store_name, source_url, source_domain, image_id, image_bucket, created_at";

/** The templates we ship, in the order the row shows them. */
export async function templates(): Promise<Template[]> {
  const { data } = await supabase
    .from("templates")
    .select("id, name, kind, layout")
    .is("owner_id", null)
    .order("sort_order");
  return (data ?? []) as unknown as Template[];
}

/** A new draft, on the 4-piece template (spec 5.1 #1). Returns its id. */
export async function createQuickDraft(): Promise<string | null> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return null;
  const all = await templates();
  const fourPiece = all.find((tpl) => tpl.name === "4 pieces") ?? all[0];
  if (!fourPiece) return null;
  const layout: QuickLayout = {
    version: 1,
    template: fourPiece.id,
    background: DEFAULT_BACKGROUND,
    caption: "",
  };
  const { data, error } = await supabase
    .from("sets")
    .insert({ owner_id: me, layout, status: "draft" })
    .select("id")
    .single();
  if (error || !data) return null;
  return data.id;
}

export async function loadSet(
  id: string,
): Promise<{ set: SetSummary; placements: Placement[] } | null> {
  const { data: set } = await supabase
    .from("sets")
    .select("id, title, status, visibility, share_code, layout, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!set) return null;
  const { data: rows } = await supabase
    .from("set_items")
    .select(`position, item:items(${ITEM_FIELDS})`)
    .eq("set_id", id);
  const placements: Placement[] = [];
  for (const row of rows ?? []) {
    const position = row.position as { slot?: number } | null;
    if (row.item && typeof position?.slot === "number") {
      placements.push({ slot: position.slot, item: row.item as unknown as ItemSummary });
    }
  }
  const raw = set.layout as Partial<QuickLayout> | null;
  const layout: QuickLayout = {
    version: 1,
    template: raw?.template ?? "",
    background: raw?.background ?? DEFAULT_BACKGROUND,
    caption: raw?.caption ?? "",
  };
  return { set: { ...(set as unknown as SetSummary), layout }, placements };
}

/** Autosave: the server writes the set and a version together, and trims (migration 017). */
export async function saveLayout(setId: string, layout: QuickLayout): Promise<boolean> {
  const { error } = await supabase.rpc("save_set_layout", { p_set_id: setId, p_layout: layout });
  return !error;
}

/**
 * Asks the server to redraw the picture a group chat shows next to this set's link (CL30).
 * Fire and forget: the link works without it, and the server decides whether this set may have
 * a public picture at all (published, public or link) and takes an old one down if not.
 */
export function refreshPreview(setId: string): void {
  void supabase.functions.invoke("set-preview", { body: { set_id: setId } }).catch(() => undefined);
}

/** Put a piece in a slot, replacing whatever was there. */
export async function placeItem(setId: string, slot: number, itemId: string): Promise<boolean> {
  // One piece per slot: clear the slot first, then the piece may only sit in one slot.
  const { data: existing } = await supabase
    .from("set_items")
    .select("id, item_id, position")
    .eq("set_id", setId);
  const inSlot = (existing ?? []).filter(
    (r) => (r.position as { slot?: number } | null)?.slot === slot,
  );
  const sameItem = (existing ?? []).filter((r) => r.item_id === itemId);
  const toRemove = [...inSlot, ...sameItem].map((r) => r.id);
  if (toRemove.length) await supabase.from("set_items").delete().in("id", toRemove);
  const { error } = await supabase
    .from("set_items")
    .insert({ set_id: setId, item_id: itemId, position: { slot } });
  return !error;
}

export async function clearSlot(setId: string, slot: number): Promise<boolean> {
  const { data: existing } = await supabase
    .from("set_items")
    .select("id, position")
    .eq("set_id", setId);
  const ids = (existing ?? [])
    .filter((r) => (r.position as { slot?: number } | null)?.slot === slot)
    .map((r) => r.id);
  if (!ids.length) return true;
  const { error } = await supabase.from("set_items").delete().in("id", ids);
  return !error;
}

/** Your published sets, newest first (S12's Sets tab). */
export async function mySets(): Promise<SetSummary[]> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return [];
  const { data } = await supabase
    .from("sets")
    .select("id, title, status, visibility, share_code, layout, updated_at")
    .eq("owner_id", me)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("published_at", { ascending: false });
  return (data ?? []) as unknown as SetSummary[];
}

/** Your drafts, newest first (S12's Drafts tab). */
export async function myDrafts(): Promise<SetSummary[]> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return [];
  const { data } = await supabase
    .from("sets")
    .select("id, title, status, visibility, share_code, layout, updated_at")
    .eq("owner_id", me)
    .eq("status", "draft")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  return (data ?? []) as unknown as SetSummary[];
}

/** "Black boots + 3 more" - a title written for you (spec 5.1 #15). */
export function autoTitle(placements: Placement[]): string {
  const sorted = [...placements].sort((a, b) => a.slot - b.slot);
  const first = sorted[0];
  if (!first) return "";
  const name = first.item.title?.trim() || (first.item.kind === "own" ? "My piece" : "A piece");
  const rest = sorted.length - 1;
  return rest > 0 ? `${name} + ${rest} more` : name;
}

/** The running total of the priced pieces, in cents, and how many had no price. */
export function priceTotal(placements: Placement[]): {
  cents: number;
  currency: string;
  unpriced: number;
} {
  let cents = 0;
  let unpriced = 0;
  let currency = "USD";
  for (const { item } of placements) {
    if (item.price_cents == null) unpriced++;
    else {
      cents += item.price_cents;
      if (item.price_currency) currency = item.price_currency;
    }
  }
  return { cents, currency, unpriced };
}

export const DEFAULT_BACKGROUND = "#F4EFE6";
