import { supabase } from "@/integrations/supabase/client";
import { avatarSrc } from "@/social/profilePhoto";
import { asAccountLabel, type AccountLabel } from "@/social/labels";
import type { SetHit } from "@/search/search";

/**
 * Feeds (roadmap M6.2; spec 9 #6–#7). Two functions that run as you, so the row policies decide
 * every row: nothing private, nothing across a block; and both leave out people you muted.
 *   following - newest first from the people you follow, paged by time
 *   featured  - editor's picks, then this week's most-loved public sets, paged by offset
 */
export type FeedSet = SetHit & { username: string; avatar_url: string | null; label: AccountLabel };

const PAGE = 12;

async function withPeople(rows: Record<string, unknown>[]): Promise<FeedSet[]> {
  const sets: SetHit[] = rows.map((r) => ({
    id: r["id"] as string,
    title: r["title"] as string,
    owner_id: r["owner_id"] as string,
    preview_image_id: (r["preview_image_id"] as string | null) ?? null,
    published_at: (r["published_at"] as string | null) ?? null,
    layout: (r["layout"] as SetHit["layout"]) ?? null,
  }));
  const owners = [...new Set(sets.map((s) => s.owner_id))];
  if (owners.length === 0) return [];
  const { data } = await supabase
    .from("profiles")
    .select("user_id, username, avatar_item_id, label")
    .in("user_id", owners);
  const people = new Map(
    (data ?? []).map((p) => [
      p.user_id,
      {
        username: p.username,
        avatar_url: avatarSrc(p.avatar_item_id) ?? null,
        label: asAccountLabel(p.label),
      },
    ]),
  );
  return sets.map((s) => ({
    ...s,
    username: people.get(s.owner_id)?.username ?? "",
    avatar_url: people.get(s.owner_id)?.avatar_url ?? null,
    label: people.get(s.owner_id)?.label ?? "none",
  }));
}

export async function followingFeed(before: string | null): Promise<FeedSet[]> {
  const { data } = await supabase.rpc("feed_following", {
    ...(before ? { p_before: before } : {}),
    p_limit: PAGE,
  });
  return withPeople((data ?? []) as Record<string, unknown>[]);
}

export async function featuredFeed(offset: number): Promise<FeedSet[]> {
  const { data } = await supabase.rpc("feed_featured", { p_offset: offset, p_limit: PAGE });
  return withPeople((data ?? []) as Record<string, unknown>[]);
}

export type Counts = { likes: number; comments: number; liked: boolean };

/** One call for a page of cards (CL38). */
export async function countsFor(ids: string[]): Promise<Map<string, Counts>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.rpc("set_social_many", { p_ids: ids });
  return new Map(
    (data ?? []).map((r) => [
      r.set_id,
      { likes: Number(r.likes), comments: Number(r.comments), liked: r.my_like === true },
    ]),
  );
}

export const FEED_PAGE = PAGE;
