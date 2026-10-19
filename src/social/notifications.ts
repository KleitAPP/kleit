import { supabase } from "@/integrations/supabase/client";
import { mutedInAppKinds } from "@/native/push";
import type { Person } from "@/social/follows";

/**
 * In-app notifications (M5.6, the in-app half): rows the database wrote when something
 * happened to you. Read, mark read, clear. Push arrives with the phone apps.
 */
export type NotificationKind =
  | "vote"
  | "comment"
  | "like"
  | "follow"
  | "follow_request"
  | "message_request"
  | "message"
  | "group_invite"
  | "ask_answer"
  | "ask_chosen"
  | "contest_results"
  | "report_resolved"
  | "strike"
  | "appeal_decided"
  | "remix"
  | "mention"
  | "tag"
  | "poll_results"
  | "contest_pick"
  | "price_drop"
  | "reply"
  | "photo_decided"
  | "mod_urgent";

export type Notification = {
  id: string;
  kind: NotificationKind;
  actor: Person | null;
  ref_type:
    | "set"
    | "poll"
    | "conversation"
    | "profile"
    | "group"
    | "ask"
    | "contest"
    | "report"
    | "strike"
    | "item"
    | null;
  ref_id: string | null;
  bundled_count: number;
  updated_at: string;
  read_at: string | null;
};

export async function myNotifications(): Promise<Notification[]> {
  // The kinds turned off "in the app" (spec 12.1 #6; migration 110) stay out of the list, as
  // they stay out of the badge; the rows exist, because a push for them may still have gone.
  const [{ data }, muted] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, actor_id, ref_type, ref_id, bundled_count, updated_at, read_at")
      .order("updated_at", { ascending: false })
      .limit(100),
    mutedInAppKinds(),
  ]);
  const rows = (data ?? []).filter((r) => !muted.has(r.kind));
  const ids = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
  const { data: people } = ids.length
    ? await supabase
        .from("profiles")
        .select("user_id, username, display_name, is_private")
        .in("user_id", ids)
    : { data: [] };
  const byId = new Map((people ?? []).map((p) => [p.user_id, p as Person]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as NotificationKind,
    actor: r.actor_id ? (byId.get(r.actor_id) ?? null) : null,
    ref_type: r.ref_type as Notification["ref_type"],
    ref_id: r.ref_id,
    bundled_count: r.bundled_count,
    updated_at: r.updated_at,
    read_at: r.read_at,
  }));
}

export async function markAllRead(): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const me = data.user?.id;
  if (!me) return;
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", me)
    .is("read_at", null);
}

export async function unreadCount(): Promise<number> {
  const { data } = await supabase.rpc("unread_notifications");
  return Number(data ?? 0);
}
