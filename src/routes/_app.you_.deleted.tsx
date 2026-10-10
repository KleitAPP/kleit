import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import {
  eraseClosetItem,
  imageUrlFor,
  recentlyDeletedPieces,
  restoreClosetItem,
  type DeletedPiece,
} from "@/items/items";
import { BIN_DAYS, eraseSet, recentlyDeletedSets, restoreSet, type DeletedSet } from "@/sets/sets";

/**
 * S26 — Recently deleted (spec 7.1 #7). Sets and closet pieces wait here 30 days with Restore
 * and Delete now. Only the owner can reach it, and that is the database's doing: the sets read
 * policy shows deleted sets to their owner alone, and the closet table answers nobody else.
 *
 * Delete now asks once, in plain words, because it is the one thing on this screen that cannot
 * be undone. Restore does not ask: it puts things back exactly as they were.
 */
export const Route = createFileRoute("/_app/you_/deleted")({
  head: () => ({
    meta: [{ title: "Recently deleted" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: RecentlyDeleted,
});

type Piece = DeletedPiece & { imageUrl: string | null };
type Target = { kind: "set" | "piece"; id: string };

function RecentlyDeleted() {
  const [sets, setSets] = useState<DeletedSet[] | null>(null);
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Target | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [gone, binned] = await Promise.all([recentlyDeletedSets(), recentlyDeletedPieces()]);
      const withPictures = await Promise.all(
        binned.map(async (p) => ({ ...p, imageUrl: await imageUrlFor(p.item) })),
      );
      if (cancelled) return;
      setSets(gone);
      setPieces(withPictures);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function restore(target: Target) {
    setBusy(target.id);
    const ok =
      target.kind === "set" ? await restoreSet(target.id) : await restoreClosetItem(target.id);
    setBusy(null);
    if (!ok) {
      setNotice(t("bin.restoreFailed"));
      return;
    }
    if (target.kind === "set") setSets((list) => (list ?? []).filter((s) => s.id !== target.id));
    else setPieces((list) => (list ?? []).filter((p) => p.item.id !== target.id));
    setNotice(target.kind === "set" ? t("bin.restoredSet") : t("bin.restoredPiece"));
  }

  async function erase(target: Target) {
    setBusy(target.id);
    const ok = target.kind === "set" ? await eraseSet(target.id) : await eraseClosetItem(target.id);
    setBusy(null);
    setConfirm(null);
    if (!ok) {
      setNotice(t("bin.eraseFailed"));
      return;
    }
    if (target.kind === "set") setSets((list) => (list ?? []).filter((s) => s.id !== target.id));
    else setPieces((list) => (list ?? []).filter((p) => p.item.id !== target.id));
    setNotice(null);
  }

  const loading = sets === null || pieces === null;
  const empty = !loading && sets.length === 0 && pieces.length === 0;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("bin.title")}</h1>
      <p className="mt-2 text-base text-ink-soft">{t("bin.what")}</p>

      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-md border border-line bg-surface p-3 text-sm text-ink"
        >
          {notice}
        </p>
      ) : null}

      {loading ? (
        <div className="mt-6 space-y-3" role="status" aria-label={t("loading")}>
          <div className="kl-skeleton h-20 w-full rounded-md bg-surface-2" />
          <div className="kl-skeleton h-20 w-full rounded-md bg-surface-2" />
        </div>
      ) : empty ? (
        <EmptyState line={t("bin.empty")} />
      ) : (
        <>
          {sets.length > 0 ? (
            <section className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                {t("bin.sets")}
              </h2>
              <ul className="mt-2 divide-y divide-line">
                {sets.map((s) => (
                  <li key={s.id} className="py-3">
                    <Row
                      title={s.title || s.layout?.caption || t("profile.draftUntitled")}
                      line={when(s.deleted_at)}
                      busy={busy === s.id}
                      onRestore={() => void restore({ kind: "set", id: s.id })}
                      onErase={() => setConfirm({ kind: "set", id: s.id })}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {pieces.length > 0 ? (
            <section className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                {t("bin.pieces")}
              </h2>
              <ul className="mt-2 divide-y divide-line">
                {pieces.map((p) => (
                  <li key={p.item.id} className="py-3">
                    <Row
                      picture={p.imageUrl}
                      title={p.item.title?.trim() || t("bin.piece")}
                      line={when(p.deleted_at)}
                      busy={busy === p.item.id}
                      onRestore={() => void restore({ kind: "piece", id: p.item.id })}
                      onErase={() => setConfirm({ kind: "piece", id: p.item.id })}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <Sheet
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t("bin.eraseTitle")}
        description={
          confirm?.kind === "set" ? t("bin.eraseSetWarning") : t("bin.erasePieceWarning")
        }
        action={
          <PrimaryButton
            onClick={() => {
              if (confirm) void erase(confirm);
            }}
            disabled={busy !== null}
          >
            {t("bin.eraseConfirm")}
          </PrimaryButton>
        }
      />
    </div>
  );
}

function Row({
  picture,
  title,
  line,
  busy,
  onRestore,
  onErase,
}: {
  picture?: string | null;
  title: string;
  line: string;
  busy: boolean;
  onRestore: () => void;
  onErase: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {picture !== undefined ? (
        <span className="size-14 shrink-0 overflow-hidden rounded-sm bg-surface-2">
          {picture ? <img src={picture} alt="" className="size-full object-cover" /> : null}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-base text-ink">{title}</p>
        <p className="text-sm text-ink-soft">{line}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onRestore}
          disabled={busy}
          className="min-h-12 rounded-pill border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
        >
          {t("bin.restore")}
        </button>
        <button
          type="button"
          onClick={onErase}
          disabled={busy}
          className="min-h-12 rounded-pill px-3 text-sm font-medium text-danger transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
        >
          {t("bin.deleteNow")}
        </button>
      </div>
    </div>
  );
}

/** "Deleted 3 Oct · 24 days left" - and on the last day, "Goes tonight". */
function when(deletedAt: string): string {
  const deleted = Date.parse(deletedAt);
  const day = 24 * 60 * 60 * 1000;
  const left = Math.max(0, Math.ceil((deleted + BIN_DAYS * day - Date.now()) / day));
  let date: string;
  try {
    date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(deleted));
  } catch {
    date = deletedAt.slice(0, 10);
  }
  const rest = left === 0 ? t("bin.lastDay") : t("bin.daysLeft", { count: left });
  return `${t("bin.deletedOn", { date })} · ${rest}`;
}
