import { useEffect, useState } from "react";

import { EmptyState, ItemCardSkeleton, Sheet, Tabs, type TabItem } from "@/components/kleit";
import { ItemTile } from "@/items/ItemTile";
import {
  imageUrlFor,
  myCloset,
  myDrawer,
  mySavedItems,
  myScanStates,
  type ItemSummary,
  type ScanState,
} from "@/items/items";
import { t } from "@/i18n/en";

/**
 * S44 — the item picker sheet: Recent clips · Closet · My items (design pack §2.3).
 *
 * "Recent clips" is your drawer, newest first (decision 103) - the same list the tray under the
 * canvas shows, in full. Search arrives at M6 and will be a fourth tab; the shape does not
 * change then, only the count.
 *
 * A piece that has not passed screening is shown to you with the word on it and cannot be
 * picked: it would be invisible on the set to everyone else, and a set with a hole in it that
 * only you can see is a confusing thing to send.
 */
type Tab = "recent" | "closet" | "saved";

const TABS: readonly TabItem<Tab>[] = [
  { id: "recent", label: t("picker.recent") },
  { id: "closet", label: t("picker.closet") },
  { id: "saved", label: t("picker.saved") },
];

type Loaded = { item: ItemSummary; imageUrl: string | null; state: ScanState };

export function ItemPicker({
  open,
  onOpenChange,
  onPick,
  onRemove,
  onShuffle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (item: ItemSummary) => void;
  /** When the slot being filled already holds a piece: the way to take it off. */
  onRemove?: (() => void) | undefined;
  /** Shuffle this one slot from your own pieces (spec 5.1 #9); absent when there are none. */
  onShuffle?: (() => void) | undefined;
}) {
  const [tab, setTab] = useState<Tab>("recent");
  const [lists, setLists] = useState<Partial<Record<Tab, Loaded[]>>>({});

  useEffect(() => {
    if (!open || lists[tab]) return;
    let cancelled = false;
    void (async () => {
      const items =
        tab === "recent"
          ? await myDrawer()
          : tab === "closet"
            ? await myCloset()
            : await mySavedItems();
      const states = await myScanStates(items.map((i) => i.id));
      const loaded = await Promise.all(
        items.map(async (item) => ({
          item,
          imageUrl: await imageUrlFor(item),
          state: states.get(item.id) ?? "clean",
        })),
      );
      if (!cancelled) setLists((l) => ({ ...l, [tab]: loaded }));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tab, lists]);

  // Fresh lists each time the sheet opens: a clip made a moment ago must show up.
  useEffect(() => {
    if (open) setLists({});
  }, [open]);

  const current = lists[tab];

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("picker.title")}
      {...(onRemove || onShuffle
        ? {
            action: (
              <div className="flex flex-col gap-2">
                {onShuffle ? (
                  <button
                    type="button"
                    onClick={onShuffle}
                    className="min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
                  >
                    {t("builder.shuffleOne")}
                  </button>
                ) : null}
                {onRemove ? (
                  <button
                    type="button"
                    onClick={onRemove}
                    className="min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
                  >
                    {t("builder.remove")}
                  </button>
                ) : null}
              </div>
            ),
          }
        : {})}
    >
      <Tabs items={TABS} current={tab} onChange={setTab} label={t("picker.title")}>
        {current === undefined ? (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <ItemCardSkeleton />
            <ItemCardSkeleton />
            <ItemCardSkeleton />
          </div>
        ) : current.length === 0 ? (
          <EmptyState
            line={t(
              tab === "recent"
                ? "picker.recentEmpty"
                : tab === "closet"
                  ? "closet.empty"
                  : "myItems.empty",
            )}
          />
        ) : (
          <ul className="mt-4 grid grid-cols-3 gap-3">
            {current.map(({ item, imageUrl, state }) => (
              <li key={item.id} className="min-w-0">
                <ItemTile
                  item={item}
                  imageUrl={imageUrl}
                  state={state}
                  {...(state === "clean" ? { onSelect: () => onPick(item) } : {})}
                />
              </li>
            ))}
          </ul>
        )}
      </Tabs>
    </Sheet>
  );
}
