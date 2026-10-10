import { supabase } from "@/integrations/supabase/client";
import type { SetSummary } from "@/sets/sets";
import { siteUrl } from "@/lib/site";

/**
 * "Which one?" polls, from the app's side (roadmap M3.7; spec 7.3; migration 022).
 *
 * The owner makes a poll from two to four of their own published sets, sends the `/p/<code>`
 * link, and reads the totals back through `poll_totals` - never `votes`, which nobody but the
 * server can read (spec 7.3 #8: totals only, no names). Guests vote through the share page and
 * the `cast-vote` function; nothing here writes a vote.
 */

export type PollSummary = {
  id: string;
  question: string;
  share_code: string;
  closes_at: string;
  closed_at: string | null;
  locked: boolean;
  created_at: string;
};

export type PollOptionRow = { id: string; set_id: string; label: string; sort_order: number };

export type PollTotal = {
  option_id: string;
  votes: number;
  raw_votes: number;
  friend_votes: number;
};

/** The durations the owner can pick (spec 7.3 #7: 1 hour to 30 days, 7 by default). */
export const DURATIONS: ReadonlyArray<{
  id: "1h" | "1d" | "3d" | "7d" | "14d" | "30d";
  hours: number;
}> = [
  { id: "1h", hours: 1 },
  { id: "1d", hours: 24 },
  { id: "3d", hours: 72 },
  { id: "7d", hours: 168 },
  { id: "14d", hours: 336 },
  { id: "30d", hours: 720 },
];

export function isClosed(poll: Pick<PollSummary, "closes_at" | "closed_at">): boolean {
  return poll.closed_at !== null || new Date(poll.closes_at).getTime() <= Date.now();
}

/** Makes the poll and its options in one go. Returns the new poll's id, or null with the problem. */
export async function createPoll(input: {
  question: string;
  setIds: string[];
  labels: Record<string, string>;
  hours: number;
}): Promise<{ id: string | null; problem?: string }> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return { id: null, problem: "signed_out" };
  if (input.setIds.length < 2 || input.setIds.length > 4) return { id: null, problem: "count" };
  const closesAt = new Date(Date.now() + input.hours * 3_600_000).toISOString();
  const { data: poll, error } = await supabase
    .from("polls")
    .insert({ owner_id: me, question: input.question.trim().slice(0, 140), closes_at: closesAt })
    .select("id")
    .single();
  if (error || !poll) return { id: null, problem: error?.message ?? "failed" };
  const ok = await replaceOptions(poll.id, input.setIds, input.labels);
  if (!ok) {
    await supabase.from("polls").update({ deleted_at: new Date().toISOString() }).eq("id", poll.id);
    return { id: null, problem: "options" };
  }
  return { id: poll.id };
}

/** Writes the options afresh - only possible while the poll is unlocked (no vote yet). */
export async function replaceOptions(
  pollId: string,
  setIds: string[],
  labels: Record<string, string>,
): Promise<boolean> {
  const { error: gone } = await supabase.from("poll_options").delete().eq("poll_id", pollId);
  if (gone) return false;
  const rows = setIds.map((set_id, i) => ({
    poll_id: pollId,
    set_id,
    label: (labels[set_id] ?? "").trim().slice(0, 40),
    sort_order: i,
  }));
  const { error } = await supabase.from("poll_options").insert(rows);
  return !error;
}

export async function loadPoll(pollId: string): Promise<{
  poll: PollSummary;
  options: PollOptionRow[];
  sets: SetSummary[];
  totals: PollTotal[];
  mine: boolean;
} | null> {
  const [{ data: poll }, { data: who }] = await Promise.all([
    supabase
      .from("polls")
      .select("id, question, share_code, closes_at, closed_at, locked, created_at, owner_id")
      .eq("id", pollId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!poll) return null;
  const [{ data: options }, { data: totals }] = await Promise.all([
    supabase
      .from("poll_options")
      .select("id, set_id, label, sort_order")
      .eq("poll_id", pollId)
      .order("sort_order"),
    supabase
      .from("poll_totals")
      .select("option_id, votes, raw_votes, friend_votes")
      .eq("poll_id", pollId),
  ]);
  const setIds = (options ?? []).map((o) => o.set_id);
  const { data: sets } = setIds.length
    ? await supabase
        .from("sets")
        .select("id, title, status, visibility, share_code, layout, updated_at")
        .in("id", setIds)
    : { data: [] };
  return {
    poll: poll as PollSummary,
    options: (options ?? []) as PollOptionRow[],
    sets: (sets ?? []) as unknown as SetSummary[],
    totals: ((totals ?? []) as unknown as Array<Record<string, unknown>>).map((t) => ({
      option_id: String(t["option_id"]),
      votes: Number(t["votes"] ?? 0),
      raw_votes: Number(t["raw_votes"] ?? 0),
      friend_votes: Number(t["friend_votes"] ?? 0),
    })),
    mine: !!who.user && who.user.id === (poll as { owner_id: string }).owner_id,
  };
}

/** Your polls, newest first. */
export async function myPolls(): Promise<PollSummary[]> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return [];
  const { data } = await supabase
    .from("polls")
    .select("id, question, share_code, closes_at, closed_at, locked, created_at")
    .eq("owner_id", me)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as PollSummary[];
}

export async function closePoll(pollId: string): Promise<boolean> {
  const { error } = await supabase
    .from("polls")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", pollId);
  return !error;
}

export async function deletePoll(pollId: string): Promise<boolean> {
  const { error } = await supabase
    .from("polls")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", pollId);
  return !error;
}

/** Spec 7.3 #7: editing resets the votes. The screen warns first; this does the resetting. */
export async function reopenPoll(pollId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("reopen_poll", { p_poll_id: pollId });
  return !error && data === true;
}

export function pollLink(poll: Pick<PollSummary, "share_code">): string {
  return siteUrl(`/p/${poll.share_code}`);
}

/** One vote as the owner may see it (spec 7.3 #9): when, which, how it counted - never who. */
export type PollVote = {
  id: string;
  option_id: string;
  created_at: string;
  weight: number;
  hidden: boolean;
  signed_in: boolean;
  is_friend: boolean;
};

/** The owner's own poll's votes, newest first. Empty for anyone else. */
export async function pollVotes(pollId: string): Promise<PollVote[]> {
  const { data } = await supabase.rpc("my_poll_votes", { p_poll: pollId });
  return ((data ?? []) as Array<Record<string, unknown>>).map((v) => ({
    id: String(v["id"]),
    option_id: String(v["option_id"]),
    created_at: String(v["created_at"]),
    weight: Number(v["weight"] ?? 1),
    hidden: Boolean(v["hidden"]),
    signed_in: Boolean(v["signed_in"]),
    is_friend: Boolean(v["is_friend"]),
  }));
}

/** Hide (or show again) one vote on your own poll; the totals follow at once. */
export async function hideVote(voteId: string, hidden: boolean): Promise<boolean> {
  const { error } = await supabase.rpc("hide_vote", { p_vote: voteId, p_hidden: hidden });
  return !error;
}
