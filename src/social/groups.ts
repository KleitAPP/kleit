import { supabase } from "@/integrations/supabase/client";
import { me, type Person } from "@/social/follows";

/**
 * Groups (roadmap M5.3; spec 10.3): a shared page of sets and talk. Invites must be accepted;
 * leaving is quiet; admins remove. The row policies decide; this file reads and writes as you.
 */
export type Group = {
  id: string;
  creator_id: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  created_at: string;
};
export type Member = { person: Person; role: "admin" | "member"; state: "invited" | "joined" };
export type Post = {
  id: string;
  author: Person | null;
  author_id: string;
  set_id: string | null;
  set_title: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
};

const PERSON = "user_id, username, display_name, is_private";

export async function visibleGroups(): Promise<Group[]> {
  const { data } = await supabase
    .from("groups")
    .select("id, creator_id, name, description, visibility, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as Group[];
}

export async function myMemberships(): Promise<Record<string, Member["state"]>> {
  const my = await me();
  if (!my) return {};
  const { data } = await supabase.from("group_members").select("group_id, state").eq("user_id", my);
  return Object.fromEntries((data ?? []).map((r) => [r.group_id, r.state as Member["state"]]));
}

export async function createGroup(
  name: string,
  visibility: Group["visibility"],
  description = "",
): Promise<string | null> {
  const my = await me();
  if (!my) return null;
  const { data, error } = await supabase
    .from("groups")
    .insert({ creator_id: my, name: name.trim(), visibility, description })
    .select("id")
    .single();
  return error || !data ? null : data.id;
}

export async function group(id: string): Promise<Group | null> {
  const { data } = await supabase
    .from("groups")
    .select("id, creator_id, name, description, visibility, created_at")
    .eq("id", id)
    .maybeSingle();
  return (data as Group | null) ?? null;
}

export async function members(groupId: string): Promise<Member[]> {
  const { data } = await supabase
    .from("group_members")
    .select("user_id, role, state")
    .eq("group_id", groupId);
  const rows = data ?? [];
  const { data: people } = rows.length
    ? await supabase
        .from("profiles")
        .select(PERSON)
        .in(
          "user_id",
          rows.map((r) => r.user_id),
        )
    : { data: [] };
  const byId = new Map((people ?? []).map((p) => [p.user_id, p as Person]));
  return rows
    .map((r) => {
      const person = byId.get(r.user_id);
      return person
        ? { person, role: r.role as Member["role"], state: r.state as Member["state"] }
        : null;
    })
    .filter((m): m is Member => !!m);
}

export async function posts(groupId: string): Promise<Post[]> {
  const { data } = await supabase
    .from("group_posts")
    .select("id, author_id, set_id, body, created_at, deleted_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.author_id))];
  const setIds = rows.map((r) => r.set_id).filter((x): x is string => !!x);
  const [{ data: people }, { data: sets }] = await Promise.all([
    ids.length
      ? supabase.from("profiles").select(PERSON).in("user_id", ids)
      : Promise.resolve({ data: [] as unknown[] }),
    setIds.length
      ? supabase.from("sets").select("id, title").in("id", setIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const byId = new Map(((people ?? []) as Person[]).map((p) => [p.user_id, p]));
  const titles = new Map(
    ((sets ?? []) as { id: string; title: string }[]).map((s) => [s.id, s.title]),
  );
  return rows.map((r) => ({
    ...r,
    author: byId.get(r.author_id) ?? null,
    set_title: r.set_id ? (titles.get(r.set_id) ?? null) : null,
  }));
}

export async function post(groupId: string, body: string, setId: string | null): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("group_posts")
    .insert({ group_id: groupId, author_id: my, body: body.trim(), set_id: setId });
  return !error;
}

export async function takeDown(postId: string): Promise<boolean> {
  const { error } = await supabase
    .from("group_posts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", postId);
  return !error;
}

export async function join(groupId: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("group_members")
    .insert({ group_id: groupId, user_id: my, role: "member", state: "joined" });
  return !error || error.code === "23505";
}

export async function invite(groupId: string, userId: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase.from("group_members").insert({
    group_id: groupId,
    user_id: userId,
    role: "member",
    state: "invited",
    invited_by: my,
  });
  return !error || error.code === "23505";
}

export async function accept(groupId: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("group_members")
    .update({ state: "joined" })
    .eq("group_id", groupId)
    .eq("user_id", my);
  return !error;
}

/** Leave, or decline an invitation: your own row goes; nobody is told. */
export async function leaveGroup(groupId: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", my);
  return !error;
}

export async function removeMember(groupId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
  return !error;
}

export async function makeAdmin(groupId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from("group_members")
    .update({ role: "admin" })
    .eq("group_id", groupId)
    .eq("user_id", userId);
  return !error;
}

export async function setVisibility(
  groupId: string,
  visibility: Group["visibility"],
): Promise<boolean> {
  const { error } = await supabase.from("groups").update({ visibility }).eq("id", groupId);
  return !error;
}

/** Your published sets, to post one into a group. */
export async function mySetsForPosting(): Promise<{ id: string; title: string }[]> {
  const my = await me();
  if (!my) return [];
  const { data } = await supabase
    .from("sets")
    .select("id, title")
    .eq("owner_id", my)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);
  return (data ?? []) as { id: string; title: string }[];
}
