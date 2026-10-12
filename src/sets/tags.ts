import { supabase } from "@/integrations/supabase/client";

/**
 * People tagged in a set (spec 7.4 #2–#4; migration 082). The owner names people on the Send
 * screen; a tag from someone the person follows shows at once, any other waits for their
 * approval; the tagged person can always take themselves off. The rules live in the database
 * (the row policies and the guard); this file only asks.
 */
export type TaggedPerson = { user_id: string; username: string; state: "pending" | "approved" };

export async function peopleOnSet(setId: string): Promise<TaggedPerson[]> {
  const { data } = await supabase.rpc("set_people", { p_set_id: setId });
  return ((data ?? []) as TaggedPerson[]).filter((p) => p.username);
}

export type TagProblem = "no-such-person" | "refused" | "cant-see" | "failed";

/**
 * Tag a person by their username. Refused when they do not allow it, or the pair is blocked;
 * "cant-see" when the set is published and they cannot open it (migration 095, P0011).
 */
export async function tagPerson(
  setId: string,
  username: string,
): Promise<{ ok: true; person: TaggedPerson } | { ok: false; problem: TagProblem }> {
  const name = username.trim().replace(/^@/, "").toLowerCase();
  if (!name) return { ok: false, problem: "no-such-person" };
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return { ok: false, problem: "failed" };
  // Usernames are lower case by rule (migration 003), so an exact match is the lookup; a
  // pattern would let "j_y" tag whoever "jay" is.
  const { data: person } = await supabase
    .from("profiles")
    .select("user_id, username")
    .eq("username", name)
    .maybeSingle();
  if (!person) return { ok: false, problem: "no-such-person" };
  const { data: row, error } = await supabase
    .from("set_tags")
    .insert({ set_id: setId, user_id: person.user_id, tagged_by: me })
    .select("state")
    .single();
  if (error || !row) {
    const problem: TagProblem =
      error?.code === "42501" ? "refused" : error?.code === "P0011" ? "cant-see" : "failed";
    return { ok: false, problem };
  }
  return {
    ok: true,
    person: {
      user_id: person.user_id,
      username: person.username,
      state: row.state as "pending" | "approved",
    },
  };
}

/** Take a tag off: the tagged person's own, or any on the owner's set. */
export async function untag(setId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from("set_tags")
    .delete()
    .eq("set_id", setId)
    .eq("user_id", userId);
  return !error;
}

/** The tagged person says yes to a tag that was waiting. */
export async function approveTag(setId: string): Promise<boolean> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return false;
  const { error } = await supabase
    .from("set_tags")
    .update({ state: "approved" })
    .eq("set_id", setId)
    .eq("user_id", me);
  return !error;
}
