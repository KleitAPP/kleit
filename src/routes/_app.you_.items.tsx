import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, ItemCardSkeleton } from "@/components/kleit";
import { ItemTile } from "@/items/ItemTile";
import { imageUrlFor, mySavedItems, type ItemSummary } from "@/items/items";
import { t } from "@/i18n/en";

/**
 * S39 — My items (design pack §2.2): the catalogue pieces you have hearted.
 *
 * Empty for everyone today, and honestly so: hearting arrives with the item page's Save button
 * once there is a catalogue to heart from (M2.4 clip-a-link, M2.8 the fake catalogue). The
 * screen ships now so the shape of You never changes under people.
 */
export const Route = createFileRoute("/_app/you_/items")({
  head: () => ({ meta: [{ title: "My items" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: MyItems,
});

type Loaded = { item: ItemSummary; imageUrl: string | null };

function MyItems() {
  const navigate = useNavigate();
  const [pieces, setPieces] = useState<Loaded[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const items = await mySavedItems();
      const loaded = await Promise.all(
        items.map(async (item) => ({ item, imageUrl: await imageUrlFor(item) })),
      );
      if (!cancelled) setPieces(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("myItems.title")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("myItems.what")}</p>

      {pieces === null ? (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <ItemCardSkeleton />
          <ItemCardSkeleton />
        </div>
      ) : pieces.length === 0 ? (
        <EmptyState line={t("myItems.empty")} />
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {pieces.map(({ item, imageUrl }) => (
            <li key={item.id} className="min-w-0">
              <ItemTile
                item={item}
                imageUrl={imageUrl}
                state="clean"
                onSelect={() => void navigate({ to: "/item/$itemId", params: { itemId: item.id } })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
