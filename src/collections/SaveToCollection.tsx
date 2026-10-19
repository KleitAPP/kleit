import { useEffect, useState } from "react";

import { PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import {
  addToCollection,
  collectionsHoldingThing,
  createCollection,
  myCollections,
  removeFromCollection,
  type CollectionSummary,
  type Saveable,
} from "@/collections/collections";

/**
 * "Save to a folder" - a sheet over a set page or a piece page. Each folder is a switch: on puts
 * the thing in, off takes it out, at once, no Save button (the entry is the whole state). A new
 * folder is made from here too, Only me by default. Anyone's set or piece can go in (spec 7.1
 * #1): the folder holds a reference, and the person it belongs to is told nothing.
 *
 * With several sets (`setIds`, the You tab's Select mode - spec 7.1 #10) a folder is "in" only
 * when every chosen set is in it; switching it on puts them all in, off takes them all out.
 */
export function SaveToCollection({
  setId,
  setIds,
  itemId,
  open,
  onOpenChange,
}: {
  setId?: string;
  setIds?: string[];
  /** A piece instead of a set (the item page). */
  itemId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const things: Saveable[] = itemId
    ? [{ item: itemId }]
    : setIds && setIds.length > 0
      ? setIds.map((set) => ({ set }))
      : setId
        ? [{ set: setId }]
        : [];
  const key = things.map((x) => ("set" in x ? `s:${x.set}` : `i:${x.item}`)).join(",");
  const [folders, setFolders] = useState<CollectionSummary[] | null>(null);
  const [holding, setHolding] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([myCollections(), ...things.map((x) => collectionsHoldingThing(x))]).then(
      ([list, ...held]) => {
        if (cancelled) return;
        setFolders(list);
        // A folder counts as holding the choice only when it holds every chosen set.
        const all = new Set<string>();
        for (const folder of held[0] ?? []) if (held.every((h) => h.has(folder))) all.add(folder);
        setHolding(all);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  async function toggle(folder: CollectionSummary) {
    setBusy(folder.id);
    const on = holding.has(folder.id);
    const results = await Promise.all(
      things.map((x) => (on ? removeFromCollection(folder.id, x) : addToCollection(folder.id, x))),
    );
    const ok = results.every(Boolean);
    if (ok) {
      const next = new Set(holding);
      if (on) next.delete(folder.id);
      else next.add(folder.id);
      setHolding(next);
    }
    setBusy(null);
  }

  async function makeNew() {
    const name = newName.trim();
    if (!name) return;
    setBusy("new");
    const id = await createCollection(name);
    if (id) {
      await Promise.all(things.map((x) => addToCollection(id, x)));
      setFolders([
        { id, name, visibility: "only_me", owner_id: "", updated_at: new Date().toISOString() },
        ...(folders ?? []),
      ]);
      setHolding(new Set([...holding, id]));
      setNewName("");
    }
    setBusy(null);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("collections.saveTo")}
      description={itemId ? t("collections.saveToWhatPiece") : t("collections.saveToWhat")}
    >
      {folders === null ? (
        <div role="status" aria-label={t("loading")}>
          <div className="kl-skeleton h-12 w-full rounded-md bg-surface-2" />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {folders.map((f) => {
            const on = holding.has(f.id);
            return (
              <li key={f.id}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  disabled={busy !== null}
                  onClick={() => void toggle(f)}
                  className="flex min-h-12 w-full items-center justify-between text-left text-base text-ink disabled:opacity-60"
                >
                  <span className="truncate">
                    {f.name}
                    <span className="ml-2 text-sm text-ink-soft">
                      {f.visibility === "public" ? t("vis.public") : t("vis.onlyMe")}
                    </span>
                  </span>
                  <span className="ml-3 shrink-0 text-sm text-ink-soft">
                    {busy === f.id
                      ? t("loading")
                      : on
                        ? t("collections.in")
                        : t("collections.notIn")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void makeNew();
        }}
      >
        <input
          type="text"
          value={newName}
          maxLength={60}
          placeholder={t("collections.newName")}
          aria-label={t("collections.newName")}
          onChange={(e) => setNewName(e.target.value)}
          className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-3 py-3 text-base text-ink"
        />
        <PrimaryButton onClick={() => void makeNew()} disabled={busy !== null || !newName.trim()}>
          {t("collections.new")}
        </PrimaryButton>
      </form>
    </Sheet>
  );
}
