import { supabase } from "@/integrations/supabase/client";
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
  | "contest_results";

export type Notification = {
  id: string;
  kind: NotificationKind;
  actor: Person | null;
  ref_type: "set" | "poll" | "conversation" | "profile" | "group" | "ask" | "contest" | null;
  ref_id: string | null;
  bundled_count: number;
  updated_at: string;
  read_at: string | null;
};

export async function myNotifications(): Promise<Notification[]> {
  const { data } = await supabase
    .from("notifications")
    .select("id, kind, actor_id, ref_type, ref_id, bundled_count, updated_at, read_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  const rows = data ?? [];
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
