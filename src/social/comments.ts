import { supabase } from "@/integrations/supabase/client";
import { me, type Person } from "@/social/follows";

/**
 * Comments, likes and reactions (roadmap M5.4; spec 11 #1). The row policies decide who may
 * see and write; this file reads and writes as the person. The set's own setting (everyone /
 * people I follow / off) is on `sets.comments_setting`; "off" hides, never deletes.
 */

export const REACTIONS = ["🔥", "😍", "👏", "😂", "🤔", "💯"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

export type Social = {
  likes: number;
  comments: number;
  reactions: Partial<Record<Reaction, number>>;
  myLike: boolean;
  myReaction: Reaction | null;
};

export type Comment = {
  id: string;
  author: Person | null;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  /** Set when the word list held it (migration 062): the author sees it, nobody else yet. */
  held_at?: string | null;
  /** A reply: the thread's first comment (migration 107). One level - replies to replies join it. */
  parent_id?: string | null;
  /** The comment actually answered; differs from parent_id for an answer to a reply. */
  answers_id?: string | null;
};
const COMMENT_FIELDS =
  "id, author_id, body, created_at, edited_at, deleted_at, deleted_by, held_at, parent_id, answers_id";

export async function social(setId: string): Promise<Social> {
  const { data } = await supabase.rpc("set_social", { p_set: setId });
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  return {
    likes: Number(row?.["likes"] ?? 0),
    comments: Number(row?.["comments"] ?? 0),
    reactions: (row?.["reactions"] as Partial<Record<Reaction, number>>) ?? {},
    myLike: row?.["my_like"] === true,
    myReaction: (row?.["my_reaction"] as Reaction | null) ?? null,
  };
}

export async function toggleLike(setId: string, on: boolean): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = on
    ? await supabase.from("likes").insert({ user_id: my, set_id: setId })
    : await supabase.from("likes").delete().eq("user_id", my).eq("set_id", setId);
  return !error || error.code === "23505";
}

/** One reaction per person; the same one again takes it away. */
export async function react(setId: string, emoji: Reaction | null): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  if (emoji === null) {
    const { error } = await supabase
      .from("reactions")
      .delete()
      .eq("user_id", my)
      .eq("set_id", setId);
    return !error;
  }
  const { error } = await supabase.from("reactions").upsert({ user_id: my, set_id: setId, emoji });
  return !error;
}

export async function comments(setId: string): Promise<Comment[]> {
  const { data } = await supabase
    .from("comments")
    .select(COMMENT_FIELDS)
    .eq("set_id", setId)
    .order("created_at");
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.author_id))];
  const { data: people } = ids.length
    ? await supabase
        .from("profiles")
        .select("user_id, username, display_name, is_private, label, avatar_item_id")
        .in("user_id", ids)
    : { data: [] };
  const byId = new Map((people ?? []).map((p) => [p.user_id, p as Person]));
  return rows.map((r) => ({ ...r, author: byId.get(r.author_id) ?? null }));
}

/** Why the last comment was not posted: the server's one named refusal, or anything else. */
export const lastCommentProblem: { code: string | null } = { code: null };

export async function addComment(
  setId: string,
  body: string,
  parentId: string | null = null,
): Promise<Comment | null> {
  const my = await me();
  if (!my) return null;
  const { data, error } = await supabase
    .from("comments")
    .insert({ set_id: setId, author_id: my, body: body.trim(), parent_id: parentId })
    .select(COMMENT_FIELDS)
    .single();
  lastCommentProblem.code = error ? ((error as { code?: string }).code ?? null) : null;
  if (error || !data) return null;
  const { data: p } = await supabase
    .from("profiles")
    .select("user_id, username, display_name, is_private, label, avatar_item_id")
    .eq("user_id", my)
    .maybeSingle();
  return { ...data, author: (p as Person | null) ?? null };
}

export async function editComment(id: string, body: string): Promise<boolean> {
  const { error } = await supabase.from("comments").update({ body: body.trim() }).eq("id", id);
  return !error;
}

/** The author takes it back, or the set's owner removes it: the same timestamp, the row stays. */
export async function removeComment(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  return !error;
}

export type CommentsSetting = "everyone" | "following" | "off";

export async function setCommentsSetting(
  setId: string,
  setting: CommentsSetting,
): Promise<boolean> {
  const { error } = await supabase
    .from("sets")
    .update({ comments_setting: setting })
    .eq("id", setId);
  return !error;
}
