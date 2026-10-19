import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useState } from "react";

import { GROUPS, searchArticles } from "@/help/articles";
import { t } from "@/i18n/en";
import { siteUrl } from "@/lib/site";

/**
 * S115 — the help centre: open to anyone, signed in or not. The list, grouped like the FAQ
 * (spec 18.2), with a filter box above it (spec 18.1 #1: "so someone who can't find one can
 * search for it"), and each article beneath.
 */
export const Route = createFileRoute("/help")({
  head: () => ({ meta: [{ title: "Help" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Help,
});

function Help() {
  const { pathname } = useLocation();
  const onArticle = pathname !== "/help" && pathname !== "/help/";
  const [query, setQuery] = useState("");
  const found = searchArticles(query);
  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-8 pb-10">
      <Link to="/welcome" className="font-display text-xl text-ink">
        Kleit
      </Link>
      <h1 className="mt-4 font-display text-2xl text-ink">{t("help.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("help.why")}</p>
      {onArticle ? (
        <div className="mt-4">
          <Outlet />
          <p className="mt-6 text-sm">
            <Link to="/help" className="text-ink underline underline-offset-2">
              {t("help.all")}
            </Link>
          </p>
        </div>
      ) : (
        <>
          <label className="mt-4 block">
            <span className="sr-only">{t("help.search")}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("help.searchHint")}
              autoComplete="off"
              className="min-h-12 w-full rounded-md border border-line bg-surface px-4 text-base text-ink placeholder:text-ink-soft"
            />
          </label>
          <p className="sr-only" role="status" aria-live="polite">
            {query.trim() ? `${found.length} ${found.length === 1 ? "article" : "articles"}` : ""}
          </p>
          {found.length === 0 ? (
            <p className="mt-6 text-base text-ink-soft">{t("help.noMatch")}</p>
          ) : null}
          {GROUPS.map((g) => {
            const inGroup = found.filter((a) => a.group === g);
            if (inGroup.length === 0) return null;
            return (
              <section key={g} className="mt-6">
                <h2 className="font-display text-xl text-ink">{g}</h2>
                <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
                  {inGroup.map((a) => (
                    <li key={a.slug} className="border-b border-line last:border-b-0">
                      <Link
                        to="/help/$slug"
                        params={{ slug: a.slug }}
                        className="flex min-h-12 items-center px-4 py-3 text-base text-ink"
                      >
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
      <footer className="mt-10 text-sm text-ink-soft">
        <a href={siteUrl("/contact")} className="underline underline-offset-2">
          {t("help.contact")}
        </a>{" "}
        ·{" "}
        <a href={siteUrl("/takedown")} className="underline underline-offset-2">
          {t("help.takedown")}
        </a>{" "}
        ·{" "}
        <a href={siteUrl("/copyright")} className="underline underline-offset-2">
          {t("help.copyright")}
        </a>{" "}
        ·{" "}
        <a href={siteUrl("/terms")} className="underline underline-offset-2">
          {t("legal.terms")}
        </a>{" "}
        ·{" "}
        <a href={siteUrl("/privacy")} className="underline underline-offset-2">
          {t("legal.privacy")}
        </a>{" "}
        ·{" "}
        <a href={siteUrl("/accessibility")} className="underline underline-offset-2">
          {t("legal.accessibility")}
        </a>
      </footer>
    </main>
  );
}
