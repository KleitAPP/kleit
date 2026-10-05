import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { t } from "@/i18n/en";
import { libraryUrl, loadCatalogue, type Catalogue } from "@/library/library";

/**
 * Where the pictures come from (M4.4; artwork pack §3a, §6.3): the credit page for the
 * decoration library. CC0 asks for no credit; we give it anyway, with a link to each object,
 * because that is also the takedown path by construction (artwork pack §3a.5 #3).
 */
export const Route = createFileRoute("/_app/settings/library")({
  head: () => ({
    meta: [
      { title: "Where the pictures come from" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: LibraryCredits,
});

function LibraryCredits() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  useEffect(() => {
    void loadCatalogue().then(setCatalogue);
  }, []);

  const museums = useMemo(() => {
    if (!catalogue) return [];
    const counts = new Map<string, number>();
    for (const a of [...Object.values(catalogue.assets), ...Object.values(catalogue.backgrounds)]) {
      if (a.kind !== "cutout") continue;
      const name = a.credit.split(",")[0] ?? a.credit;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [catalogue]);

  if (!catalogue)
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8" role="status" aria-label={t("loading")}>
        <div className="kl-skeleton h-40 w-full rounded-md bg-surface-2" />
      </div>
    );

  const all = [...Object.entries(catalogue.assets), ...Object.entries(catalogue.backgrounds)];
  const cutouts = all.filter(([, a]) => a.kind === "cutout");
  const drawn = Object.values(catalogue.assets).filter((a) => a.kind === "drawn").length;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("legal.library")}</h1>
      <p className="mt-2 text-base text-ink">{t("library.aboutIntro")}</p>
      <p className="mt-2 text-sm text-ink-soft">
        {t("library.aboutCounts", {
          cutouts: Object.values(catalogue.assets).filter((a) => a.kind === "cutout").length,
          drawn,
          backgrounds: Object.keys(catalogue.backgrounds).length,
        })}
      </p>

      <h2 className="mt-6 font-display text-xl text-ink">{t("library.museums")}</h2>
      <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
        {museums.map(([name, n]) => (
          <li
            key={name}
            className="flex items-center justify-between border-b border-line px-4 py-3 text-base text-ink last:border-b-0"
          >
            <span>{name}</span>
            <span className="text-sm text-ink-soft">{t("library.pieces", { count: n })}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 font-display text-xl text-ink">{t("library.everyPicture")}</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {cutouts.map(([id, a]) => (
          <li
            key={id}
            className="flex items-center gap-3 rounded-md border border-line bg-surface p-2"
          >
            <img
              src={libraryUrl(a.thumb)}
              alt=""
              loading="lazy"
              width={48}
              height={48}
              className="size-12 shrink-0 object-contain"
            />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm text-ink">{a.title}</p>
              <p className="text-xs text-ink-soft">{a.credit} · CC0</p>
            </div>
            {a.source ? (
              <a
                href={a.source}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-sm text-ink underline underline-offset-2"
              >
                {t("library.openObject")}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
