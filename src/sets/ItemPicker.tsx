import { useEffect, useState } from "react";

import { Chip, EmptyState, ItemCardSkeleton, Sheet, Tabs, type TabItem } from "@/components/kleit";
import { CATEGORIES, categoryOf, type Category } from "@/items/category";
import { ColourChips } from "@/items/ColourChips";
import { type ColourName } from "@/items/colour";
import { ItemTile } from "@/items/ItemTile";
import {
  imageUrlFor,
  myCloset,
  myDrawer,
  mySavedItems,
  myScanStates,
  priceLabel,
  type ItemSummary,
  type ScanState,
} from "@/items/items";
import { t } from "@/i18n/en";
import { searchItems, stores, type Store } from "@/search/search";

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
/** Spec 6.3 #2: the price filter's three ceilings, the same as the Search tab's. */
const PRICE_CAPS = [5000, 10000, 25000] as const;

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
  // Spec 6.3 #1–#2: category tabs on every list, and store / price / colour filters on the search.
  const [category, setCategory] = useState<Category | null>(null);
  const [store, setStore] = useState<string | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [colour, setColour] = useState<ColourName | null>(null);
  const [storeList, setStoreList] = useState<Store[]>([]);
  useEffect(() => {
    if (open && tab === "search" && storeList.length === 0) void stores().then(setStoreList);
  }, [open, tab, storeList.length]);

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
        const loaded = await withPictures(await searchItems(q, store, cap, colour, SEARCH_PAGE));
        if (!cancelled) setLists((l) => ({ ...l, search: loaded }));
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, tab, q, store, cap, colour]);

  /**
   * A changed filter drops the old search page at once, so a skeleton shows while it looks. A tap
   * on the value already chosen changes nothing - dropping the page then would leave the
   * skeleton for ever, because the search effect would never run again.
   */
  function resetSearch<T>(current: T, next: T, set: (value: T) => void) {
    if (current === next) return;
    set(next);
    setLists(({ search: _gone, ...rest }) => rest);
  }

  // Fresh lists each time the sheet opens: a clip made a moment ago must show up.
  useEffect(() => {
    if (open) {
      setLists({});
      setCategory(null);
      setStore(null);
      setCap(null);
      setColour(null);
    }
  }, [open]);

  const all = lists[tab];
  // A kind is read from the name (nothing in the catalogue records one); "All" shows everything.
  const current =
    all && category ? all.filter(({ item }) => categoryOf(item.title) === category) : all;

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
        {tab === "search" ? (
          <div className="mt-3 flex flex-col gap-2">
            {storeList.length > 0 ? (
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                role="group"
                aria-label={t("picker.store")}
              >
                <Chip
                  label={t("picker.anyStore")}
                  selected={store === null}
                  onToggle={() => resetSearch(store, null, setStore)}
                />
                {storeList.slice(0, 12).map((s) => (
                  <Chip
                    key={s.domain}
                    label={s.store_name ?? s.domain}
                    selected={store === s.domain}
                    onToggle={() =>
                      resetSearch(store, store === s.domain ? null : s.domain, setStore)
                    }
                  />
                ))}
              </div>
            ) : null}
            <div
              className="flex gap-2 overflow-x-auto pb-1"
              role="group"
              aria-label={t("picker.price")}
            >
              <Chip
                label={t("picker.anyPrice")}
                selected={cap === null}
                onToggle={() => resetSearch(cap, null, setCap)}
              />
              {PRICE_CAPS.map((c) => (
                <Chip
                  key={c}
                  label={t("search.under", {
                    price: priceLabel({ price_cents: c, price_currency: "USD" }) ?? "",
                  })}
                  selected={cap === c}
                  onToggle={() => resetSearch(cap, cap === c ? null : c, setCap)}
                />
              ))}
            </div>
            <ColourChips
              value={colour}
              onChange={(c) => resetSearch(colour, c, setColour)}
              label={t("search.colour")}
              none={t("search.anyColour")}
            />
          </div>
        ) : null}
        <div
          className="mt-3 flex gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label={t("picker.kind")}
        >
          <Chip
            label={t("picker.allKinds")}
            selected={category === null}
            onToggle={() => setCategory(null)}
          />
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              label={t(`picker.kind.${c}`)}
              selected={category === c}
              onToggle={() => setCategory(category === c ? null : c)}
            />
          ))}
        </div>
        {current === undefined ? (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <ItemCardSkeleton />
            <ItemCardSkeleton />
            <ItemCardSkeleton />
          </div>
        ) : current.length === 0 ? (
          <EmptyState
            line={t(
              category && all && all.length > 0
                ? "picker.kindEmpty"
                : tab === "recent"
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
