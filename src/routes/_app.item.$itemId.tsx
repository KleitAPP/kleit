import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { Heart } from "lucide-react";

import {
  buyUrlFor,
  closetItemUses,
  deleteClosetItem,
  imageUrlFor,
  inMyCloset,
  isSaved,
  myScanStates,
  oneItem,
  priceLabel,
  saveItem,
  unsaveItem,
  type ItemSummary,
  type ScanState,
} from "@/items/items";
import { t } from "@/i18n/en";
import { ReportButton } from "@/safety/ReportButton";

/**
 * S40 — Item page (design pack §2.2): the photo, the price and where it came from, and Buy.
 *
 * What you may see here is the database's decision: a product only once its image has passed
 * screening, your own piece always, someone else's own piece only through a set they shared
 * (M3.1). An item the policy hides comes back as "not found" - the same words as an item that
 * does not exist, so this page cannot be used to test which ids are real.
 *
 * Buy does three things the spec asks for at once (8.2 #7, #13, #14): the disclosure sits beside
 * it in normal text, the tap is counted with a random id and never a name, and the store opens
 * in the phone's own browser - `target="_blank"` here, the system browser inside the app at M8.
 *
 * "Sets with this item" and "Find similar" are on the design and not on this page yet. They
 * read from `public_item_stats` (M3.1) and the photo search (M6); a heading over nothing would
 * be a promise, so they arrive with their data.
 *
 * Remove from closet (spec 7.1 #7, #11; S26): shown only when the piece is in YOUR closet - the
 * closet table answers nobody else, so the question "is this mine?" is the database's. A piece
 * that sits on some of your sets asks one thing first: keep it there, or take it off them too.
 */
export const Route = createFileRoute("/_app/item/$itemId")({
  head: () => ({ meta: [{ title: "Item" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: ItemPage,
});

type Loaded =
  | { at: "loading" }
  | { at: "missing" }
  | {
      at: "found";
      item: ItemSummary;
      imageUrl: string | null;
      state: ScanState | null;
      mine: boolean;
      saved: boolean;
    };

function ItemPage() {
  const { itemId } = Route.useParams();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Loaded>({ at: "loading" });
  const [removing, setRemoving] = useState<{ uses: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded({ at: "loading" });
    void (async () => {
      const item = await oneItem(itemId);
      if (!item) {
        if (!cancelled) setLoaded({ at: "missing" });
        return;
      }
      const [imageUrl, states, mine, saved] = await Promise.all([
        imageUrlFor(item),
        myScanStates([item.id]),
        item.kind === "own" ? inMyCloset(item.id) : Promise.resolve(false),
        item.kind === "product" ? isSaved(item.id) : Promise.resolve(false),
      ]);
      if (!cancelled)
        setLoaded({
          at: "found",
          item,
          imageUrl,
          state: states.get(item.id) ?? null,
          mine,
          saved,
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // Hearting (S39): a save is a row of yours; the policy only takes a cleared product.
  async function toggleSaved() {
    if (loaded.at !== "found" || busy) return;
    setBusy(true);
    const next = !loaded.saved;
    const ok = next ? await saveItem(loaded.item.id) : await unsaveItem(loaded.item.id);
    setBusy(false);
    if (ok) setLoaded({ ...loaded, saved: next });
  }

  async function askToRemove() {
    setProblem(null);
    setRemoving({ uses: await closetItemUses(itemId) });
  }

  async function remove(keepInSets: boolean) {
    setBusy(true);
    const done = await deleteClosetItem(itemId, keepInSets);
    setBusy(false);
    if (!done) {
      setProblem(t("item.removeFailed"));
      return;
    }
    setRemoving(null);
    void navigate({ to: "/you/closet" });
  }

  if (loaded.at === "loading") {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8" role="status" aria-label={t("loading")}>
        <div className="kl-skeleton aspect-square w-full rounded-md bg-surface-2" />
      </div>
    );
  }

  if (loaded.at === "missing") {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("item.notFound")} />
      </div>
    );
  }

  const { item, imageUrl, state, mine, saved } = loaded;
  const name =
    item.title?.trim() || (item.kind === "own" ? t("item.yourPiece") : t("item.untitled"));
  const price = priceLabel(item);
  const was =
    item.price_was_cents != null &&
    item.price_cents != null &&
    item.price_was_cents > item.price_cents
      ? priceLabel({ price_cents: item.price_was_cents, price_currency: item.price_currency })
      : null;
  const buy = buyUrlFor(item);
  const store = item.store_name?.trim() || item.source_domain || "";
  const note =
    state === "pending"
      ? t("item.checkingLong")
      : state === "review"
        ? t("item.reviewLong")
        : state === "blocked"
          ? t("item.blockedLong")
          : null;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <div className="aspect-square w-full overflow-hidden rounded-md bg-surface-2">
        {imageUrl ? (
          <img src={imageUrl} alt={item.title?.trim() || ""} className="size-full object-contain" />
        ) : null}
      </div>

      <div className="mt-4 flex items-start justify-between gap-3">
        <h1 className="font-display text-2xl text-ink">{name}</h1>
        <div className="flex shrink-0 items-center gap-1">
          {item.kind === "product" ? (
            <button
              type="button"
              aria-pressed={saved}
              aria-label={saved ? t("item.saved") : t("item.save")}
              title={t("item.saveWhy")}
              disabled={busy}
              onClick={() => void toggleSaved()}
              className={`flex min-h-11 items-center gap-1 rounded-pill border px-3 text-sm ${saved ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink"}`}
            >
              <Heart className="size-4" aria-hidden="true" />
              {saved ? t("item.saved") : t("item.save")}
            </button>
          ) : null}
          <ReportButton type="item" id={itemId} />
        </div>
      </div>
      {item.kind === "own" ? (
        <p className="mt-1 text-xs font-semibold tracking-wide text-ink-soft">{t("item.own")}</p>
      ) : (
        <p className="mt-1 text-base text-ink-soft">
          {[price, store ? t("piece.from", { site: store }) : null].filter(Boolean).join(" · ")}
          {was ? (
            <>
              {" "}
              <s className="text-ink-soft">{t("item.was", { price: was })}</s>
            </>
          ) : null}
        </p>
      )}
      {item.dead_link_at ? (
        <p role="status" className="mt-2 text-sm text-ink-soft">
          {t("item.gone")}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-ink-soft">
        {t("item.added", { date: dateLabel(item.created_at) })}
      </p>

      {note ? (
        <p
          role="status"
          className="mt-4 rounded-md border border-line bg-surface p-3 text-sm text-ink"
        >
          {note}
        </p>
      ) : null}

      {buy ? (
        <div className="mt-6">
          <a
            href={buy}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("piece.buyA11y", { name, store })}
            className="flex min-h-12 w-full items-center justify-center rounded-pill bg-brand px-5 text-base font-medium text-brand-ink transition-opacity duration-fast hover:opacity-90"
          >
            {t("piece.buyAt", { store })}
          </a>
          {/* Beside the button, in normal text (spec 8.2 #7). */}
          <p className="mt-2 text-sm text-ink-soft">{t("disclosure.commission")}</p>
        </div>
      ) : null}

      {mine ? (
        <>
          <Link
            to="/you/closet"
            className="mt-6 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            {t("item.backToCloset")}
          </Link>
          <button
            type="button"
            onClick={() => void askToRemove()}
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill px-5 text-base font-medium text-danger transition-colors duration-fast hover:bg-surface-2"
          >
            {t("item.remove")}
          </button>
        </>
      ) : null}

      <Sheet
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("item.remove")}
        description={t("item.removeWarning")}
        action={
          removing && removing.uses > 0 ? null : (
            <PrimaryButton onClick={() => void remove(true)} disabled={busy}>
              {t("item.removeConfirm")}
            </PrimaryButton>
          )
        }
      >
        {removing && removing.uses > 0 ? (
          <div>
            <p className="text-base text-ink">{t("item.removeUsed", { count: removing.uses })}</p>
            <div className="mt-3 flex flex-col gap-2">
              <Choice
                label={t("item.removeKeep")}
                hint={t("item.removeKeepHint")}
                disabled={busy}
                onClick={() => void remove(true)}
              />
              <Choice
                label={t("item.removeAlso")}
                hint={t("item.removeAlsoHint")}
                disabled={busy}
                onClick={() => void remove(false)}
              />
            </div>
          </div>
        ) : null}
        {problem ? (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {problem}
          </p>
        ) : null}
      </Sheet>
    </div>
  );
}

function Choice({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-12 w-full flex-col items-start rounded-md border border-line bg-surface px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
    >
      <span className="text-base font-medium text-ink">{label}</span>
      <span className="text-sm text-ink-soft">{hint}</span>
    </button>
  );
}

function dateLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
