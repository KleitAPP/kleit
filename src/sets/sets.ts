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
import type { Song } from "@/sets/song";
import type { TemplateLayoutV2 } from "@/canvas/doc";
import { allTemplates } from "@/templates/templates";
import { type ItemSummary } from "@/items/items";
import { isNetworkError, isOnline } from "@/offline/net";
import { noteQueued } from "@/offline/outbox";
import { cacheGet, cachePut, outboxAdd } from "@/offline/store";

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
  /** Who may remix it (spec 7.4 #2); and the credit when it is itself a remix. */
  remix_mode?: RemixMode;
  remixed_from_set_id?: string | null;
  remixed_from_label?: string | null;
  /** Stamped by the server or an admin only (spec 4.7 #1.3): on Home's Featured. */
  featured_at?: string | null;
  /** The song card (spec 11 #12): a link that opens in Spotify, Apple Music or YouTube Music. */
  song?: Song | null;
};

export type Placement = { slot: number; item: ItemSummary };

const ITEM_FIELDS =
  "id, kind, title, price_cents, price_currency, store_name, source_url, source_domain, image_id, image_bucket, created_at, price_was_cents, dead_link_at";

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
  // Offline (M8.5): the last good copy of this set, if there is one.
  if (!isOnline())
    return (
      (await cacheGet<{ set: SetSummary; placements: Placement[] }>(`set:${id}`))?.value ?? null
    );
  const { data: set, error: setError } = await supabase
    .from("sets")
    .select(
      "id, title, status, visibility, share_code, tags, layout, updated_at, remix_mode, remixed_from_set_id, remixed_from_label, featured_at, song_url, song_title, song_artist, song_cover_url",
    )
    .eq("id", id)
    .maybeSingle();
  if (setError && isNetworkError(setError))
    return (
      (await cacheGet<{ set: SetSummary; placements: Placement[] }>(`set:${id}`))?.value ?? null
    );
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
  const song: Song | null = set.song_url
    ? {
        url: set.song_url,
        title: set.song_title ?? "",
        artist: set.song_artist ?? null,
        cover: set.song_cover_url ?? null,
      }
    : null;
  const { song_url: _u, song_title: _t, song_artist: _a, song_cover_url: _c, ...rest } = set;
  const loaded = {
    set: { ...(rest as unknown as SetSummary), layout, creative, song },
    placements,
  };
  void cachePut(`set:${id}`, loaded);
  return loaded;
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
  if (!isOnline()) return queueLayout(setId, layout);
  const { error } = await supabase.rpc("save_set_layout", { p_set_id: setId, p_layout: layout });
  if (!error) return "saved";
  if (isNetworkError(error)) return queueLayout(setId, layout);
  return (error as { code?: string }).code === "P0006" ? "refused" : "failed";
}

/**
 * Offline (M8.5): the save goes in the outbox and the cached copy is brought up to date, so the
 * screen can say "Saved" truthfully - saved on the phone, and sent the moment the network is
 * back (src/offline/outbox.ts). The server's rules apply then, exactly as they would have now.
 */
async function queueLayout(setId: string, layout: QuickLayout): Promise<"saved" | "failed"> {
  const ok = await outboxAdd({ kind: "save_set_layout", setId, layout, at: Date.now() });
  if (!ok) return "failed";
  const cached = await cacheGet<{ set: SetSummary; placements: Placement[] }>(`set:${setId}`);
  if (cached)
    await cachePut(`set:${setId}`, { ...cached.value, set: { ...cached.value.set, layout } });
  await noteQueued();
  return "saved";
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
  if (!isOnline()) {
    const ok = await outboxAdd({ kind: "place_item", setId, slot, itemId, at: Date.now() });
    if (ok) await noteQueued();
    return ok;
  }
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
  if (!isOnline()) {
    const ok = await outboxAdd({ kind: "clear_slot", setId, slot, at: Date.now() });
    if (ok) await noteQueued();
    return ok;
  }
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
  if (!isOnline()) return (await cacheGet<SetSummary[]>("sets"))?.value ?? [];
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return [];
  const { data, error } = await supabase
    .from("sets")
    .select("id, title, status, visibility, share_code, layout, updated_at")
    .eq("owner_id", me)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("published_at", { ascending: false });
  if (error && isNetworkError(error)) return (await cacheGet<SetSummary[]>("sets"))?.value ?? [];
  const list = (data ?? []) as unknown as SetSummary[];
  void cachePut("sets", list);
  return list;
}

/** Your drafts, newest first (S12's Drafts tab). */
export async function myDrafts(): Promise<SetSummary[]> {
  if (!isOnline()) return (await cacheGet<SetSummary[]>("drafts"))?.value ?? [];
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return [];
  const { data, error } = await supabase
    .from("sets")
    .select("id, title, status, visibility, share_code, layout, updated_at")
    .eq("owner_id", me)
    .eq("status", "draft")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error && isNetworkError(error)) return (await cacheGet<SetSummary[]>("drafts"))?.value ?? [];
  const list = (data ?? []) as unknown as SetSummary[];
  void cachePut("drafts", list);
  return list;
}

/** A set in the bin: what Recently deleted shows (S26). */
export type DeletedSet = Pick<SetSummary, "id" | "title" | "status" | "layout"> & {
  deleted_at: string;
};

/** How long a deleted set or closet piece waits before it is gone for good (spec 7.1 #7). */
export const BIN_DAYS = 30;

/** Your sets in the bin, the most recently deleted first. Only the owner's policy answers. */
export async function recentlyDeletedSets(): Promise<DeletedSet[]> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return [];
  const { data } = await supabase
    .from("sets")
    .select("id, title, status, layout, deleted_at")
    .eq("owner_id", me)
    .not("deleted_at", "is", null)
    .gte("deleted_at", new Date(Date.now() - BIN_DAYS * 24 * 60 * 60 * 1000).toISOString())
    .order("deleted_at", { ascending: false });
  return ((data ?? []) as unknown as DeletedSet[]).filter((d) => d.deleted_at);
}

/**
 * Into the bin: the set disappears from Kleit now and waits 30 days (spec 7.1 #7). The chat
 * picture comes down with it (7.1 #8) - the server takes it down once the row says deleted.
 */
export async function deleteSet(setId: string): Promise<boolean> {
  const { error } = await supabase
    .from("sets")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", setId);
  if (error) return false;
  refreshPreview(setId);
  return true;
}

/** Out of the bin, exactly as it was; the chat picture is drawn again if the set is shareable. */
export async function restoreSet(setId: string): Promise<boolean> {
  const { error } = await supabase.from("sets").update({ deleted_at: null }).eq("id", setId);
  if (error) return false;
  refreshPreview(setId);
  return true;
}

/**
 * Delete now: gone for good. The server function answers only for the owner's own sets that
 * are already in the bin, so a live set cannot be destroyed by a stray call - it has to be
 * deleted first, and that is the step with the warning. (The table itself never takes a delete
 * from a member; migration 075.)
 */
export async function eraseSet(setId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("erase_set", { p_set_id: setId });
  return !error && data === true;
}

/**
 * Remix (spec 7.4; migration 079): someone's set becomes a new draft of yours, credited. The
 * server copies the layout and the pieces you may use and says how many it could not.
 */
export type RemixMode = "anyone" | "followers" | "off";
export async function remixSet(
  setId: string,
): Promise<
  | { ok: true; id: string; copied: number; skipped: number; creative: boolean }
  | { ok: false; problem: "off" | "followers" | "not-found" | "failed" }
> {
  const { data, error } = await supabase.rpc("remix_set", { p_set_id: setId });
  if (error) {
    const m = error.message ?? "";
    return {
      ok: false,
      problem: /remix_off/.test(m)
        ? "off"
        : /remix_followers/.test(m)
          ? "followers"
          : /not_found/.test(m)
            ? "not-found"
            : "failed",
    };
  }
  const r = data as { id?: string; copied?: number; skipped?: number; creative?: boolean } | null;
  if (!r?.id) return { ok: false, problem: "failed" };
  return {
    ok: true,
    id: r.id,
    copied: r.copied ?? 0,
    skipped: r.skipped ?? 0,
    creative: !!r.creative,
  };
}

/** Who may remix this set of yours (spec 7.4 #2). */
export async function setRemixMode(setId: string, mode: RemixMode): Promise<boolean> {
  const { error } = await supabase.from("sets").update({ remix_mode: mode }).eq("id", setId);
  return !error;
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
