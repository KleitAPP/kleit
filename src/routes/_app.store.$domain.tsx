import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, ItemCard } from "@/components/kleit";
import { t } from "@/i18n/en";
import { imageUrlFor, priceLabel, type ItemSummary } from "@/items/items";
import { searchItems } from "@/search/search";

/** S86 — a store page (spec 9 #1): every cleared product clipped from one store. */
export const Route = createFileRoute("/_app/store/$domain")({
  head: () => ({ meta: [{ title: "Store" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: StorePage,
});

function StorePage() {
  const { domain } = Route.useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<ItemSummary & { url: string | null }> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = await searchItems("", domain, null);
      const withUrls = await Promise.all(
        found.map(async (i) => ({ ...i, url: await imageUrlFor(i) })),
      );
      if (!cancelled) setItems(withUrls);
    })();
    return () => {
      cancelled = true;
    };
  }, [domain]);
  const name = items?.[0]?.store_name?.trim() || domain;
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{name}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {items ? t("store.pieces", { count: items.length }) : domain}
      </p>
      {!items ? (
        <div className="kl-skeleton mt-4 h-40 w-full rounded-md bg-surface-2" />
      ) : items.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("store.none")} />
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3">
          {items.map((i) => (
            <li key={i.id}>
              <ItemCard
                imageSrc={i.url ?? ""}
                imageAlt={i.title ?? ""}
                name={i.title?.trim() || t("item.untitled")}
                {...(priceLabel(i) ? { price: priceLabel(i)! } : {})}
                onSelect={() => void navigate({ to: "/item/$itemId", params: { itemId: i.id } })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
