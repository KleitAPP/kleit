import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";
import { previewUrl, setsByTag, type SetHit } from "@/search/search";

/** S89 — Tag page: every set under one tag that you could open anyway (M6.1). */
export const Route = createFileRoute("/_app/tag/$tag")({
  head: () => ({ meta: [{ title: "Tag" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: TagPage,
});

function TagPage() {
  const { tag } = Route.useParams();
  const [sets, setSets] = useState<SetHit[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSets(null);
    void setsByTag(tag).then((s) => !cancelled && setSets(s));
    return () => {
      cancelled = true;
    };
  }, [tag]);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">#{tag}</h1>
      {!sets ? (
        <div className="kl-skeleton mt-4 h-40 w-full rounded-md bg-surface-2" />
      ) : sets.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("tag.none")} />
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-soft">{t("tag.count", { count: sets.length })}</p>
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
                        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
                      ) : null}
                    </div>
                    <p className="truncate px-3 py-2 text-sm text-ink">{s.title}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
