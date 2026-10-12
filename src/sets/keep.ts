/**
 * "Keep it" from the brand mini editor (roadmap M9.2; OW23 option a).
 *
 * A guest builds a look on a brand's site with no account, and the only thing that travels to
 * Kleit is a link: /keep?pieces=<id>,<id>,… — the ids of the pieces, in slot order, nothing
 * else. The screen shows the person what the link carries and makes the draft on ONE tap of
 * theirs, never on arrival: a link in a chat does not get to write a set for whoever opens it
 * (the same rule as Clip a link's `?url=`). The draft is a Quick set made through the same
 * rows and rules as any set of theirs: a piece they may not see (not a cleared store piece)
 * simply does not come along, and a link that names only such pieces makes no set at all.
 * Nothing is written for a guest, ever.
 */
import { supabase } from "@/integrations/supabase/client";
import { ITEM_FIELDS, type ItemSummary } from "@/items/items";
import { isOnline } from "@/offline/net";
import { safeKeep } from "@/sets/keepLink";
import { createQuickDraft, placeItem } from "@/sets/sets";

export { KEEP_MAX, safeKeep } from "@/sets/keepLink";

export type KeepProblem = "bad-link" | "offline" | "none-available" | "failed";

export type KeepPreview = { pieces: ItemSummary[]; asked: number } | { problem: KeepProblem };

/**
 * What the link carries, as the signed-in person sees it: the store pieces among the ids that
 * the row policies let them read, in the link's order. Only cleared store pieces are the brand
 * page's, so only those count; a foreign, pending, deleted or own id is left out without a word.
 */
export async function previewKeep(text: string | undefined): Promise<KeepPreview> {
  const ids = safeKeep(text);
  if (!ids) return { problem: "bad-link" };
  if (!isOnline()) return { problem: "offline" };
  const { data, error } = await supabase
    .from("items")
    .select(ITEM_FIELDS)
    .in("id", ids)
    .eq("kind", "product")
    .is("deleted_at", null);
  if (error) return { problem: "failed" };
  const byId = new Map((data ?? []).map((row) => [row.id, row as ItemSummary]));
  const pieces = ids.flatMap((id) => {
    const piece = byId.get(id);
    return piece ? [piece] : [];
  });
  if (pieces.length === 0) return { problem: "none-available" };
  return { pieces, asked: ids.length };
}

export type KeepResult = { setId: string; placed: number } | { problem: KeepProblem };

/** The tap: a new Quick draft with the pieces in its slots, in order. */
export async function keepPieces(pieces: ItemSummary[]): Promise<KeepResult> {
  if (pieces.length === 0) return { problem: "none-available" };
  if (!isOnline()) return { problem: "offline" };
  const setId = await createQuickDraft();
  if (!setId) return { problem: "failed" };
  let placed = 0;
  for (const [slot, piece] of pieces.entries()) {
    if (await placeItem(setId, slot, piece.id)) placed += 1;
  }
  return { setId, placed };
}
