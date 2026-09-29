import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import { createCollection, myCollections, type CollectionSummary } from "@/collections/collections";

/** Your folders (roadmap M3.8). Only me unless you say otherwise; the row policy is the lock. */
export const Route = createFileRoute("/_app/you_/collections")({
  head: () => ({ meta: [{ title: "Folders" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Folders,
});

function Folders() {
  const [folders, setFolders] = useState<CollectionSummary[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void myCollections().then((list) => {
      if (!cancelled) setFolders(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function make() {
    if (!name.trim()) return;
    setBusy(true);
    const id = await createCollection(name);
    if (id) {
      setFolders([
        {
          id,
          name: name.trim(),
          visibility: "only_me",
          owner_id: "",
          updated_at: new Date().toISOString(),
        },
        ...(folders ?? []),
      ]);
      setName("");
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("collections.title")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("collections.what")}</p>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        <input
          type="text"
          value={name}
          maxLength={60}
          placeholder={t("collections.newName")}
          aria-label={t("collections.newName")}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-3 py-3 text-base text-ink"
        />
        <PrimaryButton onClick={() => void make()} disabled={busy || !name.trim()}>
          {t("collections.new")}
        </PrimaryButton>
      </form>

      {folders === null ? (
        <div className="mt-6" role="status" aria-label={t("loading")}>
          <div className="kl-skeleton h-12 w-full rounded-md bg-surface-2" />
        </div>
      ) : folders.length === 0 ? (
        <EmptyState line={t("collections.empty")} />
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {folders.map((f) => (
            <li key={f.id}>
              <Link
                to="/collection/$collectionId"
                params={{ collectionId: f.id }}
                className="flex min-h-12 items-center justify-between py-3 text-base text-ink"
              >
                <span className="truncate">{f.name}</span>
                <span className="ml-3 shrink-0 text-sm text-ink-soft">
                  {f.visibility === "public" ? t("vis.public") : t("vis.onlyMe")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
