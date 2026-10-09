import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";

/**
 * Moderation (M7.2; spec 13.4): the queue a moderator works, the one door `moderate()`, and
 * the strike notice with its one appeal. Everything here is refused by the database for anyone
 * who is not a moderator - the screens only ask.
 */
export type QueueItem = {
  id: string;
  request_ref: string;
  target_type: "set" | "item" | "comment" | "profile" | "conversation" | "group";
  target_id: string;
  target_owner: string | null;
  target_username: string | null;
  reason: string;
  note: string;
  priority: "urgent" | "normal";
  state: string;
  created_at: string;
  reports_on_target: number;
  title: string | null;
  body: string | null;
  preview_image_id: string | null;
  evidence: { sender: string; body: string; at: string }[] | null;
};
export type Strike = {
  id: string;
  kind: "community" | "copyright";
  reason: string;
  created_at: string;
  expires_at: string;
  appeal_state: "open" | "upheld" | "overturned" | null;
  appeal_note: string | null;
};
export type Action = "dismiss" | "remove" | "strike" | "ban";

export async function myRoles(): Promise<string[]> {
  const { data } = await supabase.rpc("my_roles");
  return (data ?? []) as string[];
}

export async function queue(): Promise<QueueItem[]> {
  const { data } = await supabase.rpc("moderation_queue");
  return (data ?? []) as QueueItem[];
}

/**
 * Why a moderator action failed, in plain words for the screen - never silence (2026-10-09:
 * the owner could not tell whether his taps had done anything).
 */
export function whyItFailed(error: { message?: string } | null): string | null {
  if (!error) return null;
  const m = error.message ?? "";
  if (/already resolved|resolved report|no open|not_found/i.test(m)) return t("mod.err.done");
  if (/staff are not/i.test(m)) return t("mod.err.staff");
  if (/moderators only/i.test(m)) return t("mod.err.role");
  if (/reason is required/i.test(m)) return t("mod.err.reason");
  return t("mod.err.other");
}

/** Null when it worked; otherwise the sentence to show. */
export async function moderate(
  reportId: string,
  action: Action,
  note: string,
): Promise<string | null> {
  const { error } = await supabase.rpc("moderate", {
    p_report: reportId,
    p_action: action,
    p_note: note,
  });
  return whyItFailed(error);
}

export async function myStrikes(): Promise<Strike[]> {
  const { data } = await supabase.rpc("my_strikes");
  return (data ?? []) as Strike[];
}

export async function appeal(strikeId: string, body: string): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  const me = data.user?.id;
  if (!me) return false;
  const { error } = await supabase
    .from("appeals")
    .insert({ strike_id: strikeId, user_id: me, body: body.trim() });
  return !error;
}

export type OpenAppeal = {
  id: string;
  strike_id: string;
  user_id: string;
  body: string;
  created_at: string;
  username: string | null;
};
export async function openAppeals(): Promise<OpenAppeal[]> {
  const { data } = await supabase
    .from("appeals")
    .select("id, strike_id, user_id, body, created_at")
    .eq("state", "open")
    .order("created_at");
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("user_id, username").in("user_id", ids)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.user_id, p.username]));
  return rows.map((r) => ({ ...r, username: names.get(r.user_id) ?? null }));
}

export async function decideAppeal(
  appealId: string,
  outcome: "upheld" | "overturned",
  note: string,
): Promise<boolean> {
  const { error } = await supabase.rpc("decide_appeal", {
    p_appeal: appealId,
    p_outcome: outcome,
    p_note: note,
  });
  return !error;
}
