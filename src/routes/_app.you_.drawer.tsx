import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, ItemCardSkeleton } from "@/components/kleit";
import { ItemTile } from "@/items/ItemTile";
import {
  imageUrlFor,
  myDrawer,
  myScanStates,
  type ItemSummary,
  type ScanState,
} from "@/items/items";
import { t } from "@/i18n/en";

/**
 * Your drawer (decision 103; spec 4.5 #5): what you clipped, cut from your own photos, or picked
 * up from someone's set. Personal, never searchable, never shared. The design pack reaches it
 * from the item picker (S44, "My drawer"); it has a page of its own here so a clip has somewhere
 * to land before the builder exists (M3.2).
 */
export const Route = createFileRoute("/_app/you_/drawer")({
  head: () => ({
    meta: [{ title: "Your drawer" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Drawer,
});

type Loaded = { item: ItemSummary; imageUrl: string | null; state: ScanState };

function Drawer() {
  const navigate = useNavigate();
  const [pieces, setPieces] = useState<Loaded[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const items = await myDrawer();
      const states = await myScanStates(items.map((i) => i.id));
      const loaded = await Promise.all(
        items.map(async (item) => ({
          item,
          imageUrl: await imageUrlFor(item),
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
      <h1 className="font-display text-2xl text-ink">{t("drawer.title")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("drawer.what")}</p>

      {pieces === null ? (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <ItemCardSkeleton />
          <ItemCardSkeleton />
        </div>
      ) : pieces.length === 0 ? (
        <EmptyState
          line={t("drawer.empty")}
          actionLabel={t("create.clip")}
          onAction={() => void navigate({ to: "/add/link" })}
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
    </div>
  );
}
