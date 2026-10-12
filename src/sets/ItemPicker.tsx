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
import { searchItems } from "@/search/search";

/**
 * S44 — the item picker sheet: Recent clips · Closet · My items · Search (design pack §2.3;
 * spec 6.3 #1).
 *
 * "Recent clips" is your drawer, newest first (decision 103) - the same list the tray under the
 * canvas shows, in full. Search is the catalogue search of S84 in a smaller page - cleared store
 * pieces by words, newest first when there are none - so a piece can be found from the builder
 * without leaving it.
 *
 * A piece that has not passed screening is shown to you with the word on it and cannot be
 * picked: it would be invisible on the set to everyone else, and a set with a hole in it that
 * only you can see is a confusing thing to send.
 */
type Tab = "recent" | "closet" | "saved" | "search";

const TABS: readonly TabItem<Tab>[] = [
  { id: "recent", label: t("picker.recent") },
  { id: "closet", label: t("picker.closet") },
  { id: "saved", label: t("picker.saved") },
  { id: "search", label: t("picker.search") },
];

/** The picker's page of search results: a sheet, not a screen. */
const SEARCH_PAGE = 24;

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
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open || lists[tab] || tab === "search") return;
    let cancelled = false;
    void (async () => {
      const items =
        tab === "recent"
          ? await myDrawer()
          : tab === "closet"
            ? await myCloset()
            : await mySavedItems();
      const loaded = await withPictures(items);
      if (!cancelled) setLists((l) => ({ ...l, [tab]: loaded }));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tab, lists]);

  // The search tab asks the catalogue a moment after the typing stops (the same wait as S84);
  // an empty box shows the newest pieces, so there is something to pick before a word is typed.
  useEffect(() => {
    if (!open || tab !== "search") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const loaded = await withPictures(await searchItems(q, null, null, null, SEARCH_PAGE));
        if (!cancelled) setLists((l) => ({ ...l, search: loaded }));
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, tab, q]);

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
        {tab === "search" ? (
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              // The old page goes at once: a skeleton, not somebody else's answer, while it looks.
              setLists(({ search: _gone, ...rest }) => rest);
            }}
            placeholder={t("picker.searchHint")}
            aria-label={t("picker.searchHint")}
            className="mt-3 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        ) : null}
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
                  : tab === "saved"
                    ? "myItems.empty"
                    : "picker.searchEmpty",
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

/** Each piece with its picture and its scan state (yours answer a state; anyone else's is cleared). */
async function withPictures(items: ItemSummary[]): Promise<Loaded[]> {
  const states = await myScanStates(items.map((i) => i.id));
  return Promise.all(
    items.map(async (item) => ({
      item,
      imageUrl: await imageUrlFor(item),
      state: states.get(item.id) ?? "clean",
    })),
  );
}
