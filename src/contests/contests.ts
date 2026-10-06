import { supabase } from "@/integrations/supabase/client";
import { myPublicSets } from "@/social/ask";
import { me } from "@/social/follows";
import { t } from "@/i18n/en";

/**
 * Contests (M6.4; spec 11 #3–#4): a weekly challenge opens, takes one public set per person
 * while it is open, and closes on time. Badges and features only - never money. The board is
 * the week's likes on each entry, read live.
 */
export type Contest = {
  id: string;
  title: string;
  theme: string;
  opens_at: string;
  closes_at: string;
};
export type Entry = {
  set_id: string;
  user_id: string;
  username: string;
  title: string;
  preview_image_id: string | null;
  likes: number;
  entered_at: string;
};

export const isOpen = (c: Contest, now = Date.now()) =>
  Date.parse(c.opens_at) <= now && now < Date.parse(c.closes_at);

export function closesIn(c: Contest): string {
  const ms = Date.parse(c.closes_at) - Date.now();
  if (ms <= 0) return t("contest.closed");
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return t("contest.closesDays", { count: days });
  return t("contest.closesHours", { count: Math.max(1, Math.floor(ms / 3_600_000)) });
}

export async function contests(): Promise<Contest[]> {
  const { data } = await supabase
    .from("contests")
    .select("id, title, theme, opens_at, closes_at")
    .order("closes_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

export async function currentContest(): Promise<Contest | null> {
  const all = await contests();
  const now = Date.now();
  return all.find((c) => isOpen(c, now)) ?? null;
}

export async function oneContest(id: string): Promise<{ contest: Contest; board: Entry[] } | null> {
  const { data } = await supabase
    .from("contests")
    .select("id, title, theme, opens_at, closes_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const { data: rows } = await supabase.rpc("contest_board", { p_contest: id });
  return { contest: data, board: (rows ?? []) as Entry[] };
}

export async function enter(contestId: string, setId: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("contest_entries")
    .insert({ contest_id: contestId, user_id: my, set_id: setId });
  return !error;
}

export async function withdraw(contestId: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("contest_entries")
    .delete()
    .eq("contest_id", contestId)
    .eq("user_id", my);
  return !error;
}

export { myPublicSets };
