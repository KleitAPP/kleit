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
import type { TemplateLayoutV2 } from "@/canvas/doc";
import { allTemplates } from "@/templates/templates";
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
  /** Kleit's, yours, or another person's published one (M4.5). */
  by: "kleit" | "me" | "other";
  layout: Partial<TemplateLayoutV2> & { canvas: { w: number; h: number }; slots: TemplateSlot[] };
};

export type SetSummary = {
  id: string;
  title: string;
  status: "draft" | "published";
  visibility: "public" | "link" | "followers" | "friends" | "only_me";
  share_code: string;
  tags: string[];
  layout: QuickLayout;
  updated_at: string;
  /** True for a Creative-mode set (layout version 2); its pieces sit at positions, not slots. */
  creative?: boolean;
};

export type Placement = { slot: number; item: ItemSummary };

const ITEM_FIELDS =
  "id, kind, title, price_cents, price_currency, store_name, source_url, source_domain, image_id, image_bucket, created_at";

/** The person's default for comments on a new set (spec 11 #1). */
export async function commentsDefault(me: string): Promise<"everyone" | "following" | "off"> {
  const { data } = await supabase
    .from("profiles")
    .select("comments_default")
    .eq("user_id", me)
    .maybeSingle();
  const v = data?.comments_default;
  return v === "following" || v === "off" ? v : "everyone";
}

/** The templates the builder offers: Kleit's first, then yours, then published ones (M4.5). */
export async function templates(): Promise<Template[]> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id ?? null;
  const rows = await allTemplates();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    by: r.owner_id === null ? "kleit" : r.owner_id === me ? "me" : "other",
    layout: r.layout as Template["layout"],
  }));
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
    .insert({ owner_id: me, layout, status: "draft", comments_setting: await commentsDefault(me) })
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
    .select("id, title, status, visibility, share_code, tags, layout, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!set) return null;
  const { data: rows } = await supabase
    .from("set_items")
    .select(`position, item:items(${ITEM_FIELDS})`)
    .eq("set_id", id);
  const raw = set.layout as Partial<QuickLayout> | null;
  const creative = (set.layout as { version?: number } | null)?.version === 2;
  const placements: Placement[] = [];
  let next = 0;
  for (const row of rows ?? []) {
    const position = row.position as { slot?: number } | null;
    if (!row.item) continue;
    if (typeof position?.slot === "number") {
      placements.push({ slot: position.slot, item: row.item as unknown as ItemSummary });
    } else if (creative) {
      // A Creative set's pieces have positions, not slots; numbered in order for the lists.
      placements.push({ slot: next++, item: row.item as unknown as ItemSummary });
    }
  }
  const layout: QuickLayout = {
    version: 1,
    template: raw?.template ?? "",
    background: raw?.background ?? DEFAULT_BACKGROUND,
    caption: raw?.caption ?? "",
  };
  return { set: { ...(set as unknown as SetSummary), layout, creative }, placements };
}

/** Autosave: the server writes the set and a version together, and trims (migration 017). */
export async function saveLayout(setId: string, layout: QuickLayout): Promise<boolean> {
  return (await saveLayoutResult(setId, layout)) === "saved";
}

/**
 * The same save, with the one refusal told apart from a failure: "refused" is the server saying
 * the caption carries a phone number or an address (migration 062, P0006) - retrying will not
 * help and the screen should say why; "failed" is anything else and worth a retry.
 */
export async function saveLayoutResult(
  setId: string,
  layout: QuickLayout,
): Promise<"saved" | "refused" | "failed"> {
  const { error } = await supabase.rpc("save_set_layout", { p_set_id: setId, p_layout: layout });
  if (!error) return "saved";
  return (error as { code?: string }).code === "P0006" ? "refused" : "failed";
}

/** Last refusal seen by the creative autosave, so the canvas can say why (set by saveDiff). */
export const lastSaveProblem: { code: string | null } = { code: null };

/**
 * Asks the server to redraw the picture a group chat shows next to this set's link (CL30).
 * Fire and forget: the link works without it, and the server decides whether this set may have
 * a public picture at all (published, public or link) and takes an old one down if not.
 */
export function refreshPreview(setId: string): void {
  void (async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
    const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;
    if (!token || !url || !key) return;
    // A plain fetch with keepalive, not the client's invoke: the person often leaves the screen
    // the moment they have published, and a request the browser would cancel on navigation is
    // a picture that never gets drawn (the core-loop test found exactly that).
    await fetch(`${url}/functions/v1/set-preview`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ set_id: setId }),
    });
  })().catch(() => undefined);
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
