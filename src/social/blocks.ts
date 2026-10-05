import { supabase } from "@/integrations/supabase/client";
import { me } from "@/social/follows";

/**
 * Blocking (roadmap M5.5; spec 10.4). The row itself is the whole mechanism: every policy that
 * matters asks `blocked_either_way`, a trigger removes follows and requests both ways, and
 * conversations hide. Nobody is told.
 */
export type Blocked = {
  user_id: string;
  username: string;
  display_name: string;
  blocked_at: string;
};

export async function block(them: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase.from("blocks").insert({ blocker_id: my, blocked_id: them });
  return !error || error.code === "23505";
}

export async function unblock(them: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", my)
    .eq("blocked_id", them);
  return !error;
}

export async function haveBlocked(them: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { data } = await supabase
    .from("blocks")
    .select("blocked_id")
    .eq("blocker_id", my)
    .eq("blocked_id", them);
  return (data?.length ?? 0) > 0;
}

export async function blockedPeople(): Promise<Blocked[]> {
  const { data } = await supabase.rpc("blocked_people");
  return (data ?? []) as Blocked[];
}
