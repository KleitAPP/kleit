import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, ItemCard, Tabs, type TabItem } from "@/components/kleit";
import { t } from "@/i18n/en";
import { imageUrlFor, priceLabel, type ItemSummary } from "@/items/items";
import {
  previewUrl,
  searchItems,
  searchPeople,
  searchSets,
  popularTags,
  stores as loadStores,
  type SetHit,
  type Store,
} from "@/search/search";
import { isRiskySearch } from "@/safety/risky";
import { SafetyHelp } from "@/safety/SafetyHelp";
import type { Person } from "@/social/follows";

/**
 * S84–S86 — Search (roadmap M6.1; spec 9 #1): pieces, sets, people, stores. Store pieces only
 * (non-product clips never appear - spec 4.3 #2); a filter for the store and a price cap. What
 * comes back is whatever the row policies let you see, so a private set is never a result.
 */
export const Route = createFileRoute("/_app/search")({
  head: () => ({ meta: [{ title: "Search" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: SearchTab,
});

type Tab = "items" | "sets" | "people" | "stores" | "tags";
const TABS: readonly TabItem<Tab>[] = [
  { id: "items", label: t("search.items") },
  { id: "sets", label: t("search.sets") },
  { id: "people", label: t("search.people") },
  { id: "stores", label: t("search.stores") },
  { id: "tags", label: t("search.tags") },
];
const PRICE_CAPS = [5000, 10000, 25000] as const;

function SearchTab() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("items");
  const [store, setStore] = useState<string | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [items, setItems] = useState<Array<ItemSummary & { url: string | null }> | null>(null);
  const [sets, setSets] = useState<SetHit[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [storeList, setStoreList] = useState<Store[] | null>(null);
  const [tagList, setTagList] = useState<{ tag: string; sets: number }[] | null>(null);

  useEffect(() => {
    void loadStores().then(setStoreList);
    void popularTags().then(setTagList);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (tab === "items") {
          const found = await searchItems(q, store, cap);
          const withUrls = await Promise.all(
            found.map(async (i) => ({ ...i, url: await imageUrlFor(i) })),
          );
          if (!cancelled) setItems(withUrls);
        } else if (tab === "sets") {
          const found = await searchSets(q);
          if (!cancelled) setSets(found);
        } else if (tab === "people") {
          const found = await searchPeople(q);
          if (!cancelled) setPeople(found);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, tab, store, cap]);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("tabs.search")}</h1>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("search.empty")}
        aria-label={t("search.box")}
        className="mt-3 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
      />
      {isRiskySearch(q) ? <SafetyHelp /> : null}
      <div className="mt-3">
        <Tabs items={TABS} current={tab} onChange={setTab} label={t("tabs.search")}>
          {tab === "items" ? (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-sm text-ink-soft">{t("search.productsOnly")}</p>
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                role="group"
                aria-label={t("search.stores")}
              >
                <Chip
                  label={t("search.anyStore")}
                  selected={store === null}
                  onToggle={() => setStore(null)}
                />
                {(storeList ?? []).slice(0, 12).map((s) => (
                  <Chip
                    key={s.domain}
                    label={s.store_name || s.domain}
                    selected={store === s.domain}
                    onToggle={() => setStore(store === s.domain ? null : s.domain)}
                  />
                ))}
              </div>
              <div
                className="flex gap-2 overflow-x-auto pb-1"
                role="group"
                aria-label={t("search.anyPrice")}
              >
                <Chip
                  label={t("search.anyPrice")}
                  selected={cap === null}
                  onToggle={() => setCap(null)}
                />
                {PRICE_CAPS.map((c) => (
                  <Chip
                    key={c}
                    label={t("search.under", {
                      price: priceLabel({ price_cents: c, price_currency: "USD" }) ?? "",
                    })}
                    selected={cap === c}
                    onToggle={() => setCap(cap === c ? null : c)}
                  />
                ))}
              </div>
              {!items ? (
                <div className="kl-skeleton h-40 w-full rounded-md bg-surface-2" />
              ) : items.length === 0 ? (
                <EmptyState line={t("search.none")} />
              ) : (
                <ul className="grid grid-cols-2 gap-3">
                  {items.map((i) => (
                    <li key={i.id}>
                      <ItemCard
                        imageSrc={i.url ?? ""}
                        imageAlt={i.title ?? ""}
                        name={i.title?.trim() || t("item.untitled")}
                        {...(priceLabel(i) ? { price: priceLabel(i)! } : {})}
                        onSelect={() =>
                          void navigate({ to: "/item/$itemId", params: { itemId: i.id } })
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : tab === "sets" ? (
            !sets ? (
              <div className="kl-skeleton mt-3 h-40 w-full rounded-md bg-surface-2" />
            ) : sets.length === 0 ? (
              <div className="mt-3">
                <EmptyState line={t("search.none")} />
              </div>
            ) : (
              <ul className="mt-3 grid grid-cols-2 gap-3">
                {sets.map((s) => {
                  const url = previewUrl(s);
                  return (
                    <li key={s.id}>
                      <Link
                        to="/set/$setId"
                        params={{ setId: s.id }}
                        className="block overflow-hidden rounded-md bg-surface shadow-card"
                      >
                        <div className="aspect-square w-full bg-surface-2">
                          {url ? (
                            <img
                              src={url}
                              alt=""
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          ) : null}
                        </div>
                        <p className="truncate px-3 py-2 text-sm text-ink">{s.title}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )
          ) : tab === "people" ? (
            !people || q.trim().length < 2 ? (
              <p className="mt-3 text-sm text-ink-soft">{t("people.findHint")}</p>
            ) : people.length === 0 ? (
              <div className="mt-3">
                <EmptyState line={t("people.noResults")} />
              </div>
            ) : (
              <ul className="mt-3 overflow-hidden rounded-md border border-line bg-surface">
                {people.map((p) => (
                  <li key={p.user_id} className="border-b border-line last:border-b-0">
                    <Link
                      to="/u/$username"
                      params={{ username: p.username }}
                      className="block min-h-12 px-4 py-3"
                    >
                      <p className="truncate text-base text-ink">
                        {p.display_name?.trim() || p.username}
                      </p>
                      <p className="truncate text-sm text-ink-soft">@{p.username}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : tab === "stores" ? (
            !storeList ? (
              <div className="kl-skeleton mt-3 h-24 w-full rounded-md bg-surface-2" />
            ) : storeList.length === 0 ? (
              <div className="mt-3">
                <EmptyState line={t("search.none")} />
              </div>
            ) : (
              <ul className="mt-3 overflow-hidden rounded-md border border-line bg-surface">
                {storeList
                  .filter(
                    (s) =>
                      !q.trim() ||
                      (s.store_name ?? s.domain).toLowerCase().includes(q.trim().toLowerCase()) ||
                      s.domain.includes(q.trim().toLowerCase()),
                  )
                  .map((s) => (
                    <li key={s.domain} className="border-b border-line last:border-b-0">
                      <Link
                        to="/store/$domain"
                        params={{ domain: s.domain }}
                        className="flex min-h-12 items-center justify-between px-4 py-3"
                      >
                        <span className="truncate text-base text-ink">
                          {s.store_name || s.domain}
                        </span>
                        <span className="shrink-0 text-sm text-ink-soft">
                          {t("search.products", { count: s.products })}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )
          ) : !tagList ? (
            <div className="kl-skeleton mt-3 h-24 w-full rounded-md bg-surface-2" />
          ) : tagList.length === 0 ? (
            <div className="mt-3">
              <EmptyState line={t("search.noTags")} />
            </div>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {tagList
                .filter(
                  (x) => !q.trim() || x.tag.includes(q.trim().toLowerCase().replace(/^#/, "")),
                )
                .map((x) => (
                  <li key={x.tag}>
                    <Link
                      to="/tag/$tag"
                      params={{ tag: x.tag }}
                      className="inline-flex min-h-11 items-center gap-1 rounded-pill border border-line bg-surface px-3 text-sm text-ink"
                    >
                      #{x.tag}
                      <span className="text-ink-soft">{x.sets}</span>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </Tabs>
      </div>
    </div>
  );
}
