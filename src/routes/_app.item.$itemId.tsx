import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/kleit";
import {
  buyUrlFor,
  imageUrlFor,
  myScanStates,
  oneItem,
  priceLabel,
  type ItemSummary,
  type ScanState,
} from "@/items/items";
import { t } from "@/i18n/en";

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
 */
export const Route = createFileRoute("/_app/item/$itemId")({
  head: () => ({ meta: [{ title: "Item" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: ItemPage,
});

type Loaded =
  | { at: "loading" }
  | { at: "missing" }
  | { at: "found"; item: ItemSummary; imageUrl: string | null; state: ScanState | null };

function ItemPage() {
  const { itemId } = Route.useParams();
  const [loaded, setLoaded] = useState<Loaded>({ at: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoaded({ at: "loading" });
    void (async () => {
      const item = await oneItem(itemId);
      if (!item) {
        if (!cancelled) setLoaded({ at: "missing" });
        return;
      }
      const [imageUrl, states] = await Promise.all([imageUrlFor(item), myScanStates([item.id])]);
      if (!cancelled)
        setLoaded({ at: "found", item, imageUrl, state: states.get(item.id) ?? null });
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

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

  const { item, imageUrl, state } = loaded;
  const name =
    item.title?.trim() || (item.kind === "own" ? t("item.yourPiece") : t("item.untitled"));
  const price = priceLabel(item);
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

      <h1 className="mt-4 font-display text-2xl text-ink">{name}</h1>
      {item.kind === "own" ? (
        <p className="mt-1 text-xs font-semibold tracking-wide text-ink-soft">{t("item.own")}</p>
      ) : (
        <p className="mt-1 text-base text-ink-soft">
          {[price, store ? t("piece.from", { site: store }) : null].filter(Boolean).join(" · ")}
        </p>
      )}
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

      {item.kind === "own" ? (
        <Link
          to="/you/closet"
          className="mt-6 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("item.backToCloset")}
        </Link>
      ) : null}
    </div>
  );
}

function dateLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
