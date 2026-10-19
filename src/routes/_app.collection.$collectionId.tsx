import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { Chip, EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import {
  deleteCollection,
  loadCollection,
  removeFromCollection,
  setCollectionVisibility,
  type CollectionSummary,
  type FolderEntry,
} from "@/collections/collections";
import { priceLabel } from "@/items/items";

/**
 * One folder (roadmap M3.8; spec 7.1 #13). Yours: rename is on the list screen's row; here you
 * can make it public or only-me, take a set or a piece out, or delete the folder (what was in it
 * stays - a folder holds references, never copies). Someone else's public folder: just the sets
 * and pieces you could see anyway. Newest first or A–Z, and a search box once there is enough
 * in the folder to lose something.
 */
type Order = "newest" | "az";

/** The name a set or a piece sorts and searches by. */
function nameOf(entry: FolderEntry): string {
  return entry.kind === "set"
    ? entry.set.title || entry.set.layout.caption || t("profile.draftUntitled")
    : entry.item.title?.trim() || t("item.untitled");
}

/** The entries in the chosen order, narrowed to the words typed (name, store, colour). */
function arrangeEntries(entries: FolderEntry[], order: Order, query: string): FolderEntry[] {
  const q = query.trim().toLocaleLowerCase();
  const kept = q
    ? entries.filter((e) =>
        [
          nameOf(e),
          e.kind === "item" ? e.item.store_name : null,
          e.kind === "item" ? e.item.color_name : null,
        ]
          .filter((x): x is string => !!x)
          .some((x) => x.toLocaleLowerCase().includes(q)),
      )
    : entries.slice();
  if (order === "az")
    kept.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" }));
  return kept;
}
export const Route = createFileRoute("/_app/collection/$collectionId")({
  head: () => ({ meta: [{ title: "Folder" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: FolderPage,
});

function FolderPage() {
  const { collectionId } = Route.useParams();
  const navigate = useNavigate();
  const [collection, setCollection] = useState<CollectionSummary | null>(null);
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [order, setOrder] = useState<Order>("newest");
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(false);
  const [missing, setMissing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = useMemo(() => arrangeEntries(entries, order, query), [entries, order, query]);

  useEffect(() => {
    let cancelled = false;
    void loadCollection(collectionId).then((loaded) => {
      if (cancelled) return;
      if (!loaded) {
        setMissing(true);
        return;
      }
      setCollection(loaded.collection);
      setEntries(loaded.entries);
      setMine(loaded.mine);
    });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  if (missing) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("collections.notFound")} />
      </div>
    );
  }
  if (!collection) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8" role="status" aria-label={t("loading")}>
        <div className="kl-skeleton h-12 w-full rounded-md bg-surface-2" />
      </div>
    );
  }

  async function changeVisibility(next: "public" | "only_me") {
    if (!collection || collection.visibility === next) return;
    const ok = await setCollectionVisibility(collectionId, next);
    if (ok) setCollection({ ...collection, visibility: next });
    else setProblem(t("collections.failed"));
  }
  async function takeOut(entry: FolderEntry) {
    const thing = entry.kind === "set" ? { set: entry.set.id } : { item: entry.item.id };
    const ok = await removeFromCollection(collectionId, thing);
    if (ok) setEntries(entries.filter((e) => e !== entry));
    else setProblem(t("collections.failed"));
  }
  async function remove() {
    setConfirm(false);
    const ok = await deleteCollection(collectionId);
    if (!ok) {
      setProblem(t("collections.failed"));
      return;
    }
    void navigate({ to: "/you/collections" });
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{collection.name}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {collection.visibility === "public"
          ? t("collections.publicLine")
          : t("collections.onlyMeLine")}
      </p>

      {mine ? (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("send.whoCanSee")}>
          <Chip
            label={t("vis.onlyMe")}
            selected={collection.visibility === "only_me"}
            onToggle={() => void changeVisibility("only_me")}
          />
          <Chip
            label={t("vis.public")}
            selected={collection.visibility === "public"}
            onToggle={() => void changeVisibility("public")}
          />
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="mt-3 text-base text-ink">
          {problem}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState line={t("collections.noSets")} />
      ) : (
        <>
          {entries.length > 1 ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div role="group" aria-label={t("collections.order")} className="flex gap-2">
                <Chip
                  label={t("collections.newest")}
                  selected={order === "newest"}
                  onToggle={() => setOrder("newest")}
                />
                <Chip
                  label={t("collections.az")}
                  selected={order === "az"}
                  onToggle={() => setOrder("az")}
                />
              </div>
              {entries.length > 5 ? (
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("collections.searchHint")}
                  aria-label={t("collections.searchHint")}
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink"
                />
              ) : null}
            </div>
          ) : null}
          {shown.length === 0 ? (
            <p className="mt-4 text-base text-ink-soft">{t("collections.noMatch")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {shown.map((entry) => (
                <li
                  key={entry.kind === "set" ? `s:${entry.set.id}` : `i:${entry.item.id}`}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  {entry.kind === "set" ? (
                    <Link
                      to="/set/$setId"
                      params={{ setId: entry.set.id }}
                      className="flex min-h-12 min-w-0 flex-1 items-center text-base text-ink"
                    >
                      <span className="truncate">{nameOf(entry)}</span>
                    </Link>
                  ) : (
                    <Link
                      to="/item/$itemId"
                      params={{ itemId: entry.item.id }}
                      className="flex min-h-12 min-w-0 flex-1 flex-col justify-center text-base text-ink"
                    >
                      <span className="truncate">{nameOf(entry)}</span>
                      <span className="truncate text-sm text-ink-soft">
                        {[
                          t("collections.piece"),
                          priceLabel(entry.item),
                          entry.item.store_name
                            ? t("piece.from", { site: entry.item.store_name })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </Link>
                  )}
                  {mine ? (
                    <button
                      type="button"
                      onClick={() => void takeOut(entry)}
                      className="shrink-0 rounded-pill border border-line bg-surface px-4 py-2 text-sm font-medium text-ink"
                    >
                      {t("collections.takeOut")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {mine ? (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="mt-6 flex min-h-12 w-full items-center text-left text-base text-danger"
        >
          {t("collections.delete")}
        </button>
      ) : null}

      <Sheet
        open={confirm}
        onOpenChange={setConfirm}
        title={t("collections.delete")}
        description={t("collections.deleteWarning")}
        action={
          <PrimaryButton onClick={() => void remove()}>
            {t("collections.deleteConfirm")}
          </PrimaryButton>
        }
      />
    </div>
  );
}
