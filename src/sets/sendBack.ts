import { supabase } from "@/integrations/supabase/client";
import { createQuickDraft } from "@/sets/sets";

/**
 * "Send one back" (spec 8.2 #4; CL63): a new Quick draft of yours with the set's owner tagged, so
 * when you publish it they are told and it reads as an answer to theirs. The tag follows the
 * owner's own rules (migration 082): approved at once when they follow you or let everyone tag
 * them, pending otherwise, refused when they allow nobody or one of you blocked the other. A
 * refused tag is not a failed send - the draft is still yours; the screen just says the owner
 * won't be tagged.
 */
export async function sendOneBack(
  ownerId: string,
): Promise<{ ok: true; setId: string; tagged: boolean } | { ok: false }> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me || me === ownerId) return { ok: false };
  const setId = await createQuickDraft();
  if (!setId) return { ok: false };
  const { error } = await supabase
    .from("set_tags")
    .insert({ set_id: setId, user_id: ownerId, tagged_by: me });
  return { ok: true, setId, tagged: !error };
}
