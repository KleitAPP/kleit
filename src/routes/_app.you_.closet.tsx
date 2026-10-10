import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, ItemCardSkeleton } from "@/components/kleit";
import { ItemTile } from "@/items/ItemTile";
import {
  cachedImageUrl,
  OFFLINE_PICTURES,
  myCloset,
  myScanStates,
  type ItemSummary,
  type ScanState,
} from "@/items/items";
import { t } from "@/i18n/en";

/**
 * S38 — Closet (design pack §2.2). Your own pieces, private by default.
 *
 * "Private by default" is not a setting on this screen; it is the `closet_items` read policy,
 * which answers only the owner. This screen could not show anyone else's closet if it tried,
 * and the test for that is in the database suite, not here.
 *
 * A piece that is still being checked is shown to YOU, with the word on it, because it is yours
 * and you are waiting for it. To everyone else it does not exist yet - and that, too, is the
 * database's doing (migration 010), not this screen's.
 */
export const Route = createFileRoute("/_app/you_/closet")({
  head: () => ({ meta: [{ title: "Closet" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Closet,
});

type Loaded = { item: ItemSummary; imageUrl: string | null; state: ScanState };

function Closet() {
  const navigate = useNavigate();
  const [pieces, setPieces] = useState<Loaded[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const items = await myCloset();
      const states = await myScanStates(items.map((i) => i.id));
      const loaded = await Promise.all(
        items.map(async (item, index) => ({
          item,
          // The newest pictures are kept on the phone for offline use (M8.5).
          imageUrl: await cachedImageUrl(item, index < OFFLINE_PICTURES),
          state: states.get(item.id) ?? "pending",
        })),
      );
      if (!cancelled) setPieces(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("closet.title")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("closet.private")}</p>

      {pieces === null ? (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <ItemCardSkeleton />
          <ItemCardSkeleton />
          <ItemCardSkeleton />
        </div>
      ) : pieces.length === 0 ? (
        <EmptyState
          line={t("closet.empty")}
          actionLabel={t("closet.add")}
          onAction={() => void navigate({ to: "/add/photo" })}
        />
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {pieces.map(({ item, imageUrl, state }) => (
            <li key={item.id} className="min-w-0">
              <ItemTile
                item={item}
                imageUrl={imageUrl}
                state={state}
                onSelect={() => void navigate({ to: "/item/$itemId", params: { itemId: item.id } })}
              />
            </li>
          ))}
        </ul>
      )}

      <Link
        to="/you/deleted"
        className="mt-6 flex min-h-12 items-center text-sm font-medium text-ink-soft transition-colors duration-fast hover:text-ink"
      >
        {t("closet.bin")}
      </Link>
    </div>
  );
}
