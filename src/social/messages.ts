import { supabase } from "@/integrations/supabase/client";
import { me, type Person } from "@/social/follows";

/**
 * Direct messages, text only (roadmap M5.2; spec 10.2). Every send goes through the database
 * function `send_message`, which holds the rules; this file only reads what the row policies
 * let the two members see, and listens for new rows in the open conversation.
 */

export type Conversation = {
  id: string;
  other: Person;
  state: "normal" | "request";
  /** True when the other person opened it and it is waiting for me to accept. */
  waitingOnMe: boolean;
  last_message_at: string;
  last?: string;
};

export type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
};

export type SendProblem = "refused" | "no_links_yet" | "too_many" | "failed";

const PERSON = "user_id, username, display_name, is_private";

export async function myConversations(): Promise<Conversation[]> {
  const my = await me();
  if (!my) return [];
  const { data } = await supabase
    .from("conversations")
    .select("id, user_a, user_b, state, requested_by, last_message_at")
    .order("last_message_at", { ascending: false });
  const rows = data ?? [];
  const otherIds = rows.map((r) => (r.user_a === my ? r.user_b : r.user_a));
  const { data: people } = otherIds.length
    ? await supabase.from("profiles").select(PERSON).in("user_id", otherIds)
    : { data: [] };
  const byId = new Map((people ?? []).map((p) => [p.user_id, p as Person]));
  // The last line of each, for the list.
  const { data: lasts } = rows.length
    ? await supabase
        .from("messages")
        .select("conversation_id, body, deleted_at, created_at")
        .in(
          "conversation_id",
          rows.map((r) => r.id),
        )
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: [] };
  const lastBy = new Map<string, string>();
  for (const m of lasts ?? [])
    if (!lastBy.has(m.conversation_id)) lastBy.set(m.conversation_id, m.deleted_at ? "" : m.body);
  const out: Conversation[] = [];
  for (const r of rows) {
    const other = byId.get(r.user_a === my ? r.user_b : r.user_a);
    if (!other) continue;
    const c: Conversation = {
      id: r.id,
      other,
      state: r.state as "normal" | "request",
      waitingOnMe: r.state === "request" && r.requested_by !== my,
      last_message_at: r.last_message_at,
    };
    const last = lastBy.get(r.id);
    if (last !== undefined) c.last = last;
    out.push(c);
  }
  return out;
}

export async function conversation(id: string): Promise<Conversation | null> {
  const all = await myConversations();
  return all.find((c) => c.id === id) ?? null;
}

export async function messagesOf(conversationId: string): Promise<Message[]> {
  const { data } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at, deleted_at")
    .eq("conversation_id", conversationId)
    .order("created_at")
    .limit(500);
  return (data ?? []) as Message[];
}

export async function send(
  to: string,
  body: string,
): Promise<{ ok: true; id: string } | { ok: false; problem: SendProblem }> {
  const { data, error } = await supabase.rpc("send_message", { p_to: to, p_body: body });
  if (error) {
    const code = (error as { code?: string }).code;
    const problem: SendProblem =
      code === "P0002"
        ? "no_links_yet"
        : code === "P0003"
          ? "too_many"
          : code === "P0001"
            ? "refused"
            : "failed";
    return { ok: false, problem };
  }
  return { ok: true, id: data as string };
}

export async function acceptRequest(conversationId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("accept_message_request", {
    p_conversation: conversationId,
  });
  return !error && data === true;
}

/** Declining a request, or leaving: the conversation goes, for both. */
export async function leave(conversationId: string): Promise<boolean> {
  const { error } = await supabase.from("conversations").delete().eq("id", conversationId);
  return !error;
}

export async function takeBack(messageId: string): Promise<boolean> {
  const { error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  return !error;
}

/** New rows in one conversation, as they land. Returns the unsubscribe. */
export function listen(conversationId: string, onMessage: (m: Message) => void): () => void {
  const channel = supabase
    .channel(`conversation:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const row = (payload.new ?? payload.old) as Message | undefined;
        if (row?.id) onMessage(row);
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** The conversation I have with one person, if any, so a profile's Message button can open it. */
export async function conversationWith(other: string): Promise<string | null> {
  const my = await me();
  if (!my) return null;
  const [a, b] = my < other ? [my, other] : [other, my];
  const { data } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_a", a)
    .eq("user_b", b)
    .maybeSingle();
  return data?.id ?? null;
}
