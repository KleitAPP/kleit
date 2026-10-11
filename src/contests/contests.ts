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
  /** Set when an admin picked this entry after the close (S101): featured, badged, told. */
  picked_at: string | null;
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

/* ── Admin contests (S101; migration 085). Every call is refused for anyone but an admin. ── */

export type AdminContest = Contest & { entries: number; picks: number };
export type Theme = { id: string; title: string; theme: string; position: number };

export async function adminContests(): Promise<AdminContest[]> {
  const { data } = await supabase.rpc("admin_contests");
  return (data ?? []).map((c) => ({ ...c, entries: Number(c.entries), picks: Number(c.picks) }));
}

/** The themes still waiting, front of the queue first. */
export async function waitingThemes(): Promise<Theme[]> {
  const { data } = await supabase
    .from("contest_themes")
    .select("id, title, theme, position")
    .is("used_at", null)
    .order("position", { ascending: true })
    .limit(100);
  return data ?? [];
}

export async function queueTheme(title: string, theme: string): Promise<boolean> {
  const { error } = await supabase.rpc("queue_contest_theme", { p_title: title, p_theme: theme });
  return !error;
}

export async function dropTheme(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("drop_contest_theme", { p_id: id });
  return !error && data === true;
}

export async function moveTheme(id: string, direction: "up" | "down"): Promise<boolean> {
  const { data, error } = await supabase.rpc("move_contest_theme", {
    p_id: id,
    p_direction: direction,
  });
  return !error && data === true;
}

/** Opens the front of the queue now; null when one is already open or the queue is empty. */
export async function openNextNow(): Promise<string | null> {
  const { data, error } = await supabase.rpc("open_contest_now");
  return error ? null : ((data as string | null) ?? null);
}

export async function startContest(
  title: string,
  theme: string,
  days: number,
): Promise<{ ok: true; id: string } | { ok: false; problem: "open" | "failed" }> {
  const { data, error } = await supabase.rpc("start_contest", {
    p_title: title,
    p_theme: theme,
    p_days: days,
  });
  if (error) return { ok: false, problem: error.code === "P0001" ? "open" : "failed" };
  return { ok: true, id: data as string };
}

export async function closeNow(contestId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("close_contest_now", { p_contest: contestId });
  return !error && data === true;
}

export async function pickEntry(contestId: string, setId: string, on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("pick_contest_entry", {
    p_contest: contestId,
    p_set: setId,
    p_on: on,
  });
  return !error && data === true;
}

/** An editor's pick outside a challenge (S90): on or off Home's Featured. */
export async function featureSet(setId: string, on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("feature_set", { p_set: setId, p_on: on });
  return !error && data === true;
}
