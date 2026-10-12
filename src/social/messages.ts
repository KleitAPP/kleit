import { supabase } from "@/integrations/supabase/client";
import { me, type Person } from "@/social/follows";

/**
 * Direct messages, text only (roadmap M5.2; spec 10.2). Every send goes through the database
 * function `send_message`, which holds the rules; this file only reads what the row policies
 * let the two members see, and listens for new rows in the open conversation.
 */

export const DELETED: Person = {
  user_id: "",
  username: "deleted",
  display_name: "Deleted account",
  is_private: false,
};

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
  photo_item_id: string | null;
  /** The stored file's path, for the signed-URL read (filled in by `messagesOf`). */
  photo_path?: string | null;
};

export type SendProblem = "refused" | "no_links_yet" | "too_many" | "failed";

const PERSON = "user_id, username, display_name, is_private, label, avatar_item_id";

export async function myConversations(): Promise<Conversation[]> {
  const my = await me();
  if (!my) return [];
  const { data } = await supabase
    .from("conversations")
    .select("id, user_a, user_b, state, requested_by, last_message_at")
    .order("last_message_at", { ascending: false });
  const rows = data ?? [];
  const otherIds = rows
    .map((r) => (r.user_a === my ? r.user_b : r.user_a))
    .filter((x): x is string => !!x);
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
    // A deleted member reads as "Deleted account"; the thread stays (spec 3.7 #7).
    const other = byId.get((r.user_a === my ? r.user_b : r.user_a) ?? "") ?? DELETED;
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
    .select("id, sender_id, body, created_at, deleted_at, photo_item_id")
    .eq("conversation_id", conversationId)
    .order("created_at")
    .limit(500);
  const list = (data ?? []) as Message[];
  return withPhotoPaths(list);
}

/** Looks up the stored path of every photo in the list - the items table says where the file is. */
export async function withPhotoPaths(list: Message[]): Promise<Message[]> {
  const ids = [...new Set(list.map((m) => m.photo_item_id).filter((x): x is string => !!x))];
  if (ids.length === 0) return list;
  const { data } = await supabase.from("items").select("id, image_id").in("id", ids);
  const paths = new Map((data ?? []).map((i) => [i.id, i.image_id] as const));
  return list.map((m) =>
    m.photo_item_id ? { ...m, photo_path: paths.get(m.photo_item_id) ?? null } : m,
  );
}

/**
 * Puts a photo of the sender's own into storage and the items table (kind "own", no closet row,
 * so it never shows in the closet), asks the scan to look at it, and returns the item id to send.
 * Same path as adding a piece: EXIF stripped by the redraw before anything leaves the phone.
 */
export async function uploadMessagePhoto(
  file: Blob,
): Promise<{ ok: true; itemId: string } | { ok: false }> {
  const { preparePhoto } = await import("@/photos/prepare");
  // No garment floor (spec 4.6 #2 is for the closet): a small picture in a chat is still a picture.
  const prepared = await preparePhoto(file, undefined, 1);
  if (!prepared.ok) return { ok: false };
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return { ok: false };
  const ready = prepared.photo;
  const extension =
    ready.type === "image/png" ? "png" : ready.type === "image/webp" ? "webp" : "jpg";
  const path = `${me}/messages/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("closet-photos")
    .upload(path, ready.blob, { contentType: ready.type, upsert: false });
  if (uploadError) return { ok: false };
  const { data: item, error: saveError } = await supabase
    .from("items")
    .insert({
      owner_id: me,
      kind: "own",
      image_bucket: "closet-photos",
      image_id: path,
      title: "Photo in a message",
    })
    .select("id")
    .single();
  if (saveError || !item) return { ok: false };
  try {
    await supabase.functions.invoke("ingest-image", { body: { itemId: item.id } });
  } catch {
    // Unscanned stays invisible to the other person; the sweeper picks it up.
  }
  return { ok: true, itemId: item.id };
}

export async function send(
  to: string,
  body: string,
  photoItemId?: string | null,
): Promise<{ ok: true; id: string } | { ok: false; problem: SendProblem }> {
  const { data, error } = await supabase.rpc("send_message", {
    p_to: to,
    p_body: body,
    ...(photoItemId ? { p_photo: photoItemId } : {}),
  });
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
/** Leaves the thread for you only; the rows stay for a report, and a new message brings it back. */
export async function leave(conversationId: string): Promise<boolean> {
  const { error } = await supabase.rpc("leave_conversation", { p_id: conversationId });
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
