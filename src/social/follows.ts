import { supabase } from "@/integrations/supabase/client";
import { patternSafe } from "@/search/search";
import type { AccountLabel } from "@/social/labels";

/**
 * Following (roadmap M5.1; spec 10.1): one-way follows, "Friends" when both ways, requests for
 * private accounts (migration 026), and a quiet "remove follower". Every question here is
 * answered by the row policies: what you cannot see, you cannot act on.
 */

export type Person = {
  user_id: string;
  username: string;
  display_name: string;
  is_private: boolean;
  /** "none" for an ordinary account (spec 11 #9; migration 090). */
  label?: AccountLabel;
  /** The profile photo's item (migration 092); undefined where the list did not ask. */
  avatar_item_id?: string | null;
};

export type Relationship = {
  /** I follow them. */
  following: boolean;
  /** They follow me. */
  followedBy: boolean;
  /** I asked to follow them (private account) and they have not answered. */
  requested: boolean;
  followers: number;
  followingCount: number;
};

const PERSON = "user_id, username, display_name, is_private, label, avatar_item_id";

export async function me(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function relationship(them: string): Promise<Relationship> {
  const my = await me();
  const [a, b, r, counts] = await Promise.all([
    my
      ? supabase.from("follows").select("followee_id").eq("follower_id", my).eq("followee_id", them)
      : null,
    my
      ? supabase.from("follows").select("followee_id").eq("follower_id", them).eq("followee_id", my)
      : null,
    my
      ? supabase
          .from("follow_requests")
          .select("target_id")
          .eq("requester_id", my)
          .eq("target_id", them)
      : null,
    supabase.rpc("follow_counts", { p_user: them }),
  ]);
  const c = (counts.data as { followers: number; following: number }[] | null)?.[0];
  return {
    following: (a?.data?.length ?? 0) > 0,
    followedBy: (b?.data?.length ?? 0) > 0,
    requested: (r?.data?.length ?? 0) > 0,
    followers: Number(c?.followers ?? 0),
    followingCount: Number(c?.following ?? 0),
  };
}

/** Follow a public account at once, or ask a private one. Returns what happened. */
export async function follow(them: Person): Promise<"following" | "requested" | "failed"> {
  const my = await me();
  if (!my) return "failed";
  if (them.is_private) {
    const { error } = await supabase
      .from("follow_requests")
      .insert({ requester_id: my, target_id: them.user_id });
    return error && error.code !== "23505" ? "failed" : "requested";
  }
  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: my, followee_id: them.user_id });
  return error && error.code !== "23505" ? "failed" : "following";
}

export async function unfollow(them: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", my)
    .eq("followee_id", them);
  return !error;
}

export async function cancelRequest(them: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("follow_requests")
    .delete()
    .eq("requester_id", my)
    .eq("target_id", them);
  return !error;
}

/** Quietly: they are not told (spec 10.1 #4). */
export async function removeFollower(them: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", them)
    .eq("followee_id", my);
  return !error;
}

export async function approve(requester: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("approve_follow_request", { p_requester: requester });
  return !error && data === true;
}

export async function decline(requester: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("follow_requests")
    .delete()
    .eq("requester_id", requester)
    .eq("target_id", my);
  return !error;
}

async function people(ids: string[]): Promise<Person[]> {
  if (!ids.length) return [];
  const { data } = await supabase.from("profiles").select(PERSON).in("user_id", ids);
  const byId = new Map((data ?? []).map((p) => [p.user_id, p as Person]));
  return ids.map((id) => byId.get(id)).filter((p): p is Person => !!p);
}

export async function myFollowers(): Promise<Person[]> {
  const my = await me();
  if (!my) return [];
  const { data } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("followee_id", my)
    .order("created_at", { ascending: false });
  return people((data ?? []).map((r) => r.follower_id));
}

export async function myFollowing(): Promise<Person[]> {
  const my = await me();
  if (!my) return [];
  const { data } = await supabase
    .from("follows")
    .select("followee_id")
    .eq("follower_id", my)
    .order("created_at", { ascending: false });
  return people((data ?? []).map((r) => r.followee_id));
}

export async function myRequests(): Promise<Person[]> {
  const my = await me();
  if (!my) return [];
  const { data } = await supabase
    .from("follow_requests")
    .select("requester_id")
    .eq("target_id", my)
    .order("created_at", { ascending: false });
  return people((data ?? []).map((r) => r.requester_id));
}

/** Find friends (S78) by username: a prefix search, a handful of results. */
export async function findPeople(query: string): Promise<Person[]> {
  const q = patternSafe(query.trim().toLowerCase().replace(/^@/, ""));
  if (q.length < 2) return [];
  const { data } = await supabase
    .from("profiles")
    .select(PERSON)
    .ilike("username", `${q}%`)
    .limit(10);
  return (data ?? []) as Person[];
}
