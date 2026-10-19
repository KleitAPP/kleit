import { supabase } from "@/integrations/supabase/client";
import { ITEM_FIELDS, type ItemSummary } from "@/items/items";
import type { SetSummary } from "@/sets/sets";

/**
 * Collections - folders of sets and pieces (roadmap M3.8; spec 5.1 and 7.1 #1, #13; migration
 * 017 rows 16–17).
 *
 * A folder is "Only me" unless its owner makes it public, and the database decides who sees
 * what: a private folder is not a row a second account can read, and an entry only shows a set
 * or a piece its viewer could see on its own (the entry policy asks `can_view_set`, and the
 * items table's own read policy). Nothing here checks that twice; it just asks. Anyone's set
 * or piece can go into one of your folders: an entry is a reference, never a copy, and taking
 * it out touches nothing of theirs.
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

/** A set or a piece in a folder, with when it went in (the "newest first" order). */
export type FolderEntry =
  | { kind: "set"; added_at: string; set: SetSummary }
  | { kind: "item"; added_at: string; item: ItemSummary };

export async function loadCollection(collectionId: string): Promise<{
  collection: CollectionSummary;
  entries: FolderEntry[];
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
  const { data: rows } = await supabase
    .from("collection_entries")
    .select("set_id, item_id, created_at")
    .eq("collection_id", collectionId)
    .order("created_at", { ascending: false });
  const setIds = (rows ?? []).map((e) => e.set_id).filter((x): x is string => !!x);
  const itemIds = (rows ?? []).map((e) => e.item_id).filter((x): x is string => !!x);
  const [{ data: sets }, { data: items }] = await Promise.all([
    setIds.length
      ? supabase
          .from("sets")
          .select("id, title, status, visibility, share_code, layout, updated_at")
          .in("id", setIds)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] }),
    itemIds.length
      ? supabase
          .from("items")
          .select(ITEM_FIELDS)
          .in("id", itemIds)
          .is("deleted_at", null)
          .eq("takedown_state", "none")
      : Promise.resolve({ data: [] }),
  ]);
  const setById = new Map(((sets ?? []) as unknown as SetSummary[]).map((s) => [s.id, s]));
  const itemById = new Map(((items ?? []) as unknown as ItemSummary[]).map((i) => [i.id, i]));
  const entries: FolderEntry[] = [];
  for (const row of rows ?? []) {
    const set = row.set_id ? setById.get(row.set_id) : undefined;
    const item = row.item_id ? itemById.get(row.item_id) : undefined;
    if (set) entries.push({ kind: "set", added_at: row.created_at, set });
    else if (item) entries.push({ kind: "item", added_at: row.created_at, item });
  }
  return {
    collection: collection as CollectionSummary,
    entries,
    mine: !!who.user && who.user.id === collection.owner_id,
  };
}

/** What a folder entry is about: one set or one piece. */
export type Saveable = { set: string } | { item: string };

function column(thing: Saveable): { set_id: string } | { item_id: string } {
  return "set" in thing ? { set_id: thing.set } : { item_id: thing.item };
}

/** Which of my folders hold this set or piece - for the "Save to a folder" sheet. */
export async function collectionsHoldingThing(thing: Saveable): Promise<Set<string>> {
  const [col, id] = Object.entries(column(thing))[0] as [string, string];
  const { data } = await supabase.from("collection_entries").select("collection_id").eq(col, id);
  return new Set((data ?? []).map((e) => e.collection_id));
}

export async function addToCollection(collectionId: string, thing: Saveable): Promise<boolean> {
  const { error } = await supabase
    .from("collection_entries")
    .insert({ collection_id: collectionId, ...column(thing) });
  return !error || error.code === "23505";
}

export async function removeFromCollection(
  collectionId: string,
  thing: Saveable,
): Promise<boolean> {
  const [col, id] = Object.entries(column(thing))[0] as [string, string];
  const { error } = await supabase
    .from("collection_entries")
    .delete()
    .eq("collection_id", collectionId)
    .eq(col, id);
  return !error;
}

export const collectionsHolding = (setId: string) => collectionsHoldingThing({ set: setId });
export const addSetToCollection = (collectionId: string, setId: string) =>
  addToCollection(collectionId, { set: setId });
export const removeSetFromCollection = (collectionId: string, setId: string) =>
  removeFromCollection(collectionId, { set: setId });

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
