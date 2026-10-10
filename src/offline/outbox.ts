import { supabase } from "@/integrations/supabase/client";
import { isNetworkError, isOnline, onBackOnline } from "@/offline/net";
import { outboxAll, outboxRemove, type OutboxEntry } from "@/offline/store";

/**
 * Replaying edits made offline (roadmap M8.5). Each entry is the same database call the app
 * makes online, so the server's rules apply exactly as they would have: a caption with a phone
 * number is refused now instead of then, a slot on a set you no longer own is refused, and so
 * on. A refused entry is dropped (retrying cannot help); a network failure stops the replay and
 * keeps the rest for next time. Entries replay in the order they were made.
 *
 * Nothing here runs more than once at a time, and nothing runs while the phone says it is
 * offline.
 */
let flushing: Promise<number> | null = null;
const listeners = new Set<(pending: number) => void>();

/** Tell the screens how many edits are still waiting (the banner shows the number). */
export function onOutboxChange(fn: (pending: number) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function announce(): Promise<void> {
  const pending = (await outboxAll()).length;
  for (const fn of listeners) fn(pending);
}

async function replay(entry: OutboxEntry): Promise<"done" | "refused" | "offline"> {
  let error: unknown = null;
  if (entry.kind === "save_set_layout") {
    ({ error } = await supabase.rpc("save_set_layout", {
      p_set_id: entry.setId,
      p_layout: entry.layout as never,
    }));
  } else if (entry.kind === "place_item") {
    const { data: existing, error: readError } = await supabase
      .from("set_items")
      .select("id, item_id, position")
      .eq("set_id", entry.setId);
    if (readError) error = readError;
    else {
      const gone = (existing ?? [])
        .filter(
          (r) =>
            (r.position as { slot?: number } | null)?.slot === entry.slot ||
            r.item_id === entry.itemId,
        )
        .map((r) => r.id);
      if (gone.length) await supabase.from("set_items").delete().in("id", gone);
      ({ error } = await supabase
        .from("set_items")
        .insert({ set_id: entry.setId, item_id: entry.itemId, position: { slot: entry.slot } }));
    }
  } else if (entry.kind === "clear_slot") {
    const { data: existing, error: readError } = await supabase
      .from("set_items")
      .select("id, position")
      .eq("set_id", entry.setId);
    if (readError) error = readError;
    else {
      const ids = (existing ?? [])
        .filter((r) => (r.position as { slot?: number } | null)?.slot === entry.slot)
        .map((r) => r.id);
      if (ids.length) ({ error } = await supabase.from("set_items").delete().in("id", ids));
    }
  }
  if (!error) return "done";
  return isNetworkError(error) ? "offline" : "refused";
}

/** Replay everything waiting. Returns how many are still waiting afterwards. */
export function flushOutbox(): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      if (!isOnline()) return (await outboxAll()).length;
      const waiting = await outboxAll();
      for (const { key, entry } of waiting) {
        const result = await replay(entry);
        if (result === "offline") break;
        await outboxRemove(key);
      }
      await announce();
      return (await outboxAll()).length;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

let watching = false;
/** Once per app: replay on start and whenever the network comes back. */
export function watchOutbox(): void {
  if (watching) return;
  watching = true;
  void flushOutbox();
  onBackOnline(() => void flushOutbox());
}

/** For the screens: after queueing an edit, let the banner know. */
export async function noteQueued(): Promise<void> {
  await announce();
}
