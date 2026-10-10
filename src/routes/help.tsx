import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";

import { ARTICLES, GROUPS } from "@/help/articles";
import { t } from "@/i18n/en";
import { siteUrl } from "@/lib/site";

/** S115 — the help centre: open to anyone, signed in or not. The list, with each article beneath. */
export const Route = createFileRoute("/help")({
  head: () => ({ meta: [{ title: "Help" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Help,
});

function Help() {
  const { pathname } = useLocation();
  const onArticle = pathname !== "/help" && pathname !== "/help/";
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
        GROUPS.map((g) => (
          <section key={g} className="mt-6">
            <h2 className="font-display text-xl text-ink">{g}</h2>
            <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
              {ARTICLES.filter((a) => a.group === g).map((a) => (
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
        ))
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
        </a>
      </footer>
    </main>
  );
}
