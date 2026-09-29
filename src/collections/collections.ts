import { supabase } from "@/integrations/supabase/client";
import type { SetSummary } from "@/sets/sets";

/**
 * Collections - folders of sets (roadmap M3.8; spec 5.1; migration 017 rows 16–17).
 *
 * A folder is "Only me" unless its owner makes it public, and the database decides who sees
 * what: a private folder is not a row a second account can read, and an entry only shows a set
 * its viewer could see on its own (the entry policy asks `can_view_set`). Nothing here checks
 * that twice; it just asks.
 */

export type CollectionSummary = {
  id: string;
  name: string;
  visibility: "public" | "only_me";
  owner_id: string;
  updated_at: string;
};

export async function myCollections(): Promise<CollectionSummary[]> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return [];
  const { data } = await supabase
    .from("collections")
    .select("id, name, visibility, owner_id, updated_at")
    .eq("owner_id", me)
    .order("updated_at", { ascending: false });
  return (data ?? []) as CollectionSummary[];
}

export async function createCollection(
  name: string,
  visibility: "public" | "only_me" = "only_me",
): Promise<string | null> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  const clean = name.trim().slice(0, 60);
  if (!me || !clean) return null;
  const { data, error } = await supabase
    .from("collections")
    .insert({ owner_id: me, name: clean, visibility })
    .select("id")
    .single();
  return error || !data ? null : data.id;
}

export async function loadCollection(collectionId: string): Promise<{
  collection: CollectionSummary;
  sets: SetSummary[];
  mine: boolean;
} | null> {
  const [{ data: collection }, { data: who }] = await Promise.all([
    supabase
      .from("collections")
      .select("id, name, visibility, owner_id, updated_at")
      .eq("id", collectionId)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!collection) return null;
  const { data: entries } = await supabase
    .from("collection_entries")
    .select("set_id, created_at")
    .eq("collection_id", collectionId)
    .not("set_id", "is", null)
    .order("created_at", { ascending: false });
  const ids = (entries ?? []).map((e) => e.set_id).filter((x): x is string => !!x);
  const { data: sets } = ids.length
    ? await supabase
        .from("sets")
        .select("id, title, status, visibility, share_code, layout, updated_at")
        .in("id", ids)
        .is("deleted_at", null)
    : { data: [] };
  const byId = new Map(((sets ?? []) as unknown as SetSummary[]).map((s) => [s.id, s]));
  return {
    collection: collection as CollectionSummary,
    sets: ids.map((id) => byId.get(id)).filter((s): s is SetSummary => !!s),
    mine: !!who.user && who.user.id === collection.owner_id,
  };
}

/** Which of my folders hold this set - for the "Save to a folder" sheet. */
export async function collectionsHolding(setId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("collection_entries")
    .select("collection_id")
    .eq("set_id", setId);
  return new Set((data ?? []).map((e) => e.collection_id));
}

export async function addSetToCollection(collectionId: string, setId: string): Promise<boolean> {
  const { error } = await supabase
    .from("collection_entries")
    .insert({ collection_id: collectionId, set_id: setId });
  return !error || error.code === "23505";
}

export async function removeSetFromCollection(
  collectionId: string,
  setId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("collection_entries")
    .delete()
    .eq("collection_id", collectionId)
    .eq("set_id", setId);
  return !error;
}

export async function setCollectionVisibility(
  collectionId: string,
  visibility: "public" | "only_me",
): Promise<boolean> {
  const { error } = await supabase
    .from("collections")
    .update({ visibility })
    .eq("id", collectionId);
  return !error;
}

export async function renameCollection(collectionId: string, name: string): Promise<boolean> {
  const clean = name.trim().slice(0, 60);
  if (!clean) return false;
  const { error } = await supabase
    .from("collections")
    .update({ name: clean })
    .eq("id", collectionId);
  return !error;
}

/** Deleting a folder deletes only the folder; the sets in it are untouched (they were never copies). */
export async function deleteCollection(collectionId: string): Promise<boolean> {
  const { error } = await supabase.from("collections").delete().eq("id", collectionId);
  return !error;
}
