import { supabase } from "@/integrations/supabase/client";
import { ITEM_FIELDS, type ItemSummary } from "@/items/items";
import { createQuickDraft, placeItem } from "@/sets/sets";
import { me, type Person } from "@/social/follows";

/**
 * Ask (M5.3; spec 11 #7): a style question, answered with sets; the asker picks a favourite.
 * A "build around this piece" question (spec 5.1 #12; migration 100) is the same thing with a
 * cleared store piece locked to it: every answer is a public set that carries the piece - the
 * database refuses one that does not.
 */
export type Ask = {
  id: string;
  author: Person | null;
  author_id: string;
  question: string;
  created_at: string;
  closed_at: string | null;
  answers: number;
  /** The locked piece of a build-around, or null for a plain question. */
  item_id: string | null;
};
export type Answer = {
  id: string;
  author: Person | null;
  author_id: string;
  set_id: string;
  set_title: string;
  body: string;
  chosen: boolean;
  created_at: string;
};

const PERSON = "user_id, username, display_name, is_private, label, avatar_item_id";

async function people(ids: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data } = await supabase.from("profiles").select(PERSON).in("user_id", unique);
  return new Map((data ?? []).map((p) => [p.user_id, p as Person]));
}

export async function openAsks(): Promise<Ask[]> {
  const { data } = await supabase
    .from("ask_posts")
    .select("id, author_id, question, created_at, closed_at, item_id")
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = data ?? [];
  const byId = await people(rows.map((r) => r.author_id));
  const { data: counts } = rows.length
    ? await supabase
        .from("ask_answers")
        .select("ask_id")
        .in(
          "ask_id",
          rows.map((r) => r.id),
        )
    : { data: [] };
  const n = new Map<string, number>();
  for (const c of counts ?? []) n.set(c.ask_id, (n.get(c.ask_id) ?? 0) + 1);
  return rows.map((r) => ({
    ...r,
    author: byId.get(r.author_id) ?? null,
    answers: n.get(r.id) ?? 0,
  }));
}

/** Ask a question; with `itemId`, a build-around on that (cleared, store) piece. */
export async function ask(question: string, itemId?: string): Promise<string | null> {
  const my = await me();
  if (!my) return null;
  const { data, error } = await supabase
    .from("ask_posts")
    .insert({ author_id: my, question: question.trim(), ...(itemId ? { item_id: itemId } : {}) })
    .select("id")
    .single();
  return error || !data ? null : data.id;
}

export async function oneAsk(
  id: string,
): Promise<{ ask: Ask; answers: Answer[]; item: ItemSummary | null } | null> {
  const { data } = await supabase
    .from("ask_posts")
    .select("id, author_id, question, created_at, closed_at, item_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  // The locked piece, as the row policies show it (a cleared store piece, or nothing).
  const { data: piece } = data.item_id
    ? await supabase.from("items").select(ITEM_FIELDS).eq("id", data.item_id).maybeSingle()
    : { data: null };
  const { data: rows } = await supabase
    .from("ask_answers")
    .select("id, author_id, set_id, body, chosen, created_at")
    .eq("ask_id", id)
    .order("chosen", { ascending: false })
    .order("created_at");
  const answers = rows ?? [];
  const byId = await people([data.author_id, ...answers.map((a) => a.author_id)]);
  const { data: sets } = answers.length
    ? await supabase
        .from("sets")
        .select("id, title")
        .in(
          "id",
          answers.map((a) => a.set_id),
        )
    : { data: [] };
  const titles = new Map((sets ?? []).map((s) => [s.id, s.title]));
  return {
    ask: { ...data, author: byId.get(data.author_id) ?? null, answers: answers.length },
    answers: answers.map((a) => ({
      ...a,
      author: byId.get(a.author_id) ?? null,
      set_title: titles.get(a.set_id) ?? "Set",
    })),
    item: (piece as ItemSummary | null) ?? null,
  };
}

export async function answer(askId: string, setId: string, body: string): Promise<boolean> {
  const my = await me();
  if (!my) return false;
  const { error } = await supabase
    .from("ask_answers")
    .insert({ ask_id: askId, author_id: my, set_id: setId, body: body.trim() });
  return !error;
}

export async function choose(answerId: string): Promise<boolean> {
  const { error } = await supabase.from("ask_answers").update({ chosen: true }).eq("id", answerId);
  return !error;
}

export async function closeAsk(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("ask_posts")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", id);
  return !error;
}

export async function takeBackAnswer(id: string): Promise<boolean> {
  const { error } = await supabase.from("ask_answers").delete().eq("id", id);
  return !error;
}

/**
 * Your public, published sets - the only kind that can answer; for a build-around, only those
 * with the locked piece on them (the database refuses the rest, so the screen offers only these).
 */
export async function myPublicSets(
  withItem?: string | null,
): Promise<{ id: string; title: string }[]> {
  const my = await me();
  if (!my) return [];
  const { data } = await supabase
    .from("sets")
    .select("id, title")
    .eq("owner_id", my)
    .eq("status", "published")
    .eq("visibility", "public")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);
  const sets = (data ?? []) as { id: string; title: string }[];
  if (!withItem || sets.length === 0) return sets;
  const { data: rows } = await supabase
    .from("set_items")
    .select("set_id")
    .eq("item_id", withItem)
    .in(
      "set_id",
      sets.map((s) => s.id),
    );
  const carrying = new Set((rows ?? []).map((r) => r.set_id));
  return sets.filter((s) => carrying.has(s.id));
}

/**
 * A new Quick draft with the locked piece in its first slot: the way into a build-around. The
 * piece is read first, as the person: one they may no longer see (taken down since) makes no
 * draft at all, rather than an empty one with nothing said.
 */
export async function startSetWith(itemId: string): Promise<string | null> {
  const { data: piece } = await supabase.from("items").select("id").eq("id", itemId).maybeSingle();
  if (!piece) return null;
  const setId = await createQuickDraft();
  if (!setId) return null;
  if (!(await placeItem(setId, 0, itemId))) return null;
  return setId;
}
