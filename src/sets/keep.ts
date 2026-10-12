/**
 * "Keep it" from the brand mini editor (roadmap M9.2; OW23 option a).
 *
 * A guest builds a look on a brand's site with no account, and the only thing that travels to
 * Kleit is a link: /keep?pieces=<id>,<id>,… — the ids of the pieces, in slot order, nothing
 * else. Once the person is signed in, the app makes a Quick draft and puts those pieces in its
 * slots through the same rows and rules as any set of theirs: a piece they may not see (not a
 * cleared store piece) simply does not come along, and a link that names only such pieces makes
 * no set at all. Nothing is written for a guest, ever.
 */
import { supabase } from "@/integrations/supabase/client";
import { isOnline } from "@/offline/net";
import { safeKeep } from "@/sets/keepLink";
import { createQuickDraft, placeItem } from "@/sets/sets";

export { KEEP_MAX, safeKeep } from "@/sets/keepLink";

export type KeepResult =
  | { setId: string; placed: number }
  | { problem: "bad-link" | "offline" | "none-available" | "failed" };

/**
 * Make the draft and fill its slots. The pieces are read first, as the signed-in person: the
 * row policies answer with the ones they may see, so the draft is only made when at least one
 * came through, and a foreign or uncleared id is left out without a word.
 */
export async function keepPieces(text: string | undefined): Promise<KeepResult> {
  const ids = safeKeep(text);
  if (!ids) return { problem: "bad-link" };
  if (!isOnline()) return { problem: "offline" };
  const { data: visible, error } = await supabase.from("items").select("id").in("id", ids);
  if (error) return { problem: "failed" };
  const allowed = new Set((visible ?? []).map((row) => row.id));
  const kept = ids.filter((id) => allowed.has(id));
  if (kept.length === 0) return { problem: "none-available" };
  const setId = await createQuickDraft();
  if (!setId) return { problem: "failed" };
  let placed = 0;
  for (const [slot, id] of kept.entries()) {
    if (await placeItem(setId, slot, id)) placed += 1;
  }
  return { setId, placed };
}
