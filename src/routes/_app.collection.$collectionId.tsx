import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import {
  deleteCollection,
  loadCollection,
  removeSetFromCollection,
  setCollectionVisibility,
  type CollectionSummary,
} from "@/collections/collections";
import type { SetSummary } from "@/sets/sets";

/**
 * One folder (roadmap M3.8). Yours: rename is on the list screen's row later; here you can make
 * it public or only-me, take a set out, or delete the folder (the sets stay - a folder holds
 * references, never copies). Someone else's public folder: just the sets you could see anyway.
 */
export const Route = createFileRoute("/_app/collection/$collectionId")({
  head: () => ({ meta: [{ title: "Folder" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: FolderPage,
});

function FolderPage() {
  const { collectionId } = Route.useParams();
  const navigate = useNavigate();
  const [collection, setCollection] = useState<CollectionSummary | null>(null);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [mine, setMine] = useState(false);
  const [missing, setMissing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCollection(collectionId).then((loaded) => {
      if (cancelled) return;
      if (!loaded) {
        setMissing(true);
        return;
      }
      setCollection(loaded.collection);
      setSets(loaded.sets);
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
  async function takeOut(setId: string) {
    const ok = await removeSetFromCollection(collectionId, setId);
    if (ok) setSets(sets.filter((s) => s.id !== setId));
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

      {sets.length === 0 ? (
        <EmptyState line={t("collections.noSets")} />
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {sets.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3">
              <Link
                to="/set/$setId"
                params={{ setId: s.id }}
                className="flex min-h-12 min-w-0 flex-1 items-center text-base text-ink"
              >
                <span className="truncate">
                  {s.title || s.layout.caption || t("profile.draftUntitled")}
                </span>
              </Link>
              {mine ? (
                <button
                  type="button"
                  onClick={() => void takeOut(s.id)}
                  className="shrink-0 rounded-pill border border-line bg-surface px-4 py-2 text-sm font-medium text-ink"
                >
                  {t("collections.takeOut")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
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
