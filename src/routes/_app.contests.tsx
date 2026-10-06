import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/kleit";
import { closesIn, contests as loadContests, isOpen, type Contest } from "@/contests/contests";
import { t } from "@/i18n/en";

/** S91 — Contests list: this week's challenge and past ones (M6.4; spec 11 #3–#4). */
export const Route = createFileRoute("/_app/contests")({
  head: () => ({ meta: [{ title: "Contests" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Contests,
});

function Contests() {
  const [list, setList] = useState<Contest[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadContests().then((c) => !cancelled && setList(c));
    return () => {
      cancelled = true;
    };
  }, []);

  const now = Date.now();
  const open = (list ?? []).filter((c) => isOpen(c, now));
  const past = (list ?? []).filter((c) => !isOpen(c, now) && Date.parse(c.closes_at) <= now);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("contest.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("contest.why")}</p>
      {!list ? (
        <div className="kl-skeleton mt-4 h-24 w-full rounded-md bg-surface-2" />
      ) : list.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("contest.none")} />
        </div>
      ) : (
        <>
          <h2 className="mt-6 font-display text-xl text-ink">{t("contest.thisWeek")}</h2>
          {open.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">{t("contest.noneOpen")}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3">
              {open.map((c) => (
                <li key={c.id}>
                  <Link
                    to="/contests/$contestId"
                    params={{ contestId: c.id }}
                    className="block rounded-md border border-line bg-surface p-4 shadow-card"
                  >
                    <p className="text-base font-medium text-ink">{c.title}</p>
                    {c.theme ? <p className="mt-1 text-sm text-ink-soft">{c.theme}</p> : null}
                    <p className="mt-2 text-sm text-ink-soft">{closesIn(c)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {past.length > 0 ? (
            <>
              <h2 className="mt-6 font-display text-xl text-ink">{t("contest.past")}</h2>
              <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
                {past.map((c) => (
                  <li key={c.id} className="border-b border-line last:border-b-0">
                    <Link
                      to="/contests/$contestId"
                      params={{ contestId: c.id }}
                      className="block min-h-12 px-4 py-3"
                    >
                      <p className="text-base text-ink">{c.title}</p>
                      <p className="text-sm text-ink-soft">{t("contest.closed")}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
