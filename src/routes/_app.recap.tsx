import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/kleit";
import { weeklyRecap, type Recap, type RecapEntry, type RecapSet } from "@/contests/recap";
import { t } from "@/i18n/en";
import { previewUrl } from "@/search/search";

/**
 * S94 — The weekly recap (spec 11 #4): Friday's results for the Monday theme (Kleit's picks,
 * then the three most-liked entries), the remix of the week, and your own week in four numbers.
 * Reachable from the Home card over the weekend and from the challenges page any time.
 */
export const Route = createFileRoute("/_app/recap")({
  head: () => ({
    meta: [{ title: "This week" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: RecapPage,
});

function SetRow({ set, line, rank }: { set: RecapSet; line: string; rank?: number }) {
  const url = previewUrl(set);
  return (
    <li className="rounded-md border border-line bg-surface p-3">
      <Link to="/set/$setId" params={{ setId: set.set_id }} className="flex items-center gap-3">
        {rank ? <span className="w-6 text-base text-ink-soft">{rank}</span> : null}
        <span className="size-14 shrink-0 overflow-hidden rounded-sm bg-surface-2">
          {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base text-ink">{set.title || "…"}</span>
          <span className="block text-sm text-ink-soft">{line}</span>
        </span>
      </Link>
    </li>
  );
}

function RecapPage() {
  const [recap, setRecap] = useState<Recap | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void weeklyRecap().then((r) => !cancelled && setRecap(r));
    return () => {
      cancelled = true;
    };
  }, []);

  if (recap === undefined) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <div className="kl-skeleton mt-4 h-24 w-full rounded-md bg-surface-2" />
      </div>
    );
  }
  if (!recap) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("recap.failed")} />
      </div>
    );
  }
  const { contest, remix, me } = recap;
  const topLine = (e: RecapEntry) => `@${e.username} · ${t("contest.likes", { count: e.likes })}`;
  const numbers: { key: string; label: string; value: number }[] = [
    { key: "sets", label: t("recap.setsPublished"), value: me.sets_published },
    { key: "likes", label: t("recap.likesReceived"), value: me.likes_received },
    { key: "followers", label: t("recap.newFollowers"), value: me.new_followers },
    { key: "saved", label: t("recap.piecesSaved"), value: me.pieces_saved },
  ];

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("recap.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("recap.why")}</p>

      <h2 className="mt-6 font-display text-xl text-ink">{t("recap.challenge")}</h2>
      {!contest ? (
        <p className="mt-2 text-sm text-ink-soft">{t("recap.noChallenge")}</p>
      ) : (
        <>
          <Link
            to="/contests/$contestId"
            params={{ contestId: contest.id }}
            className="mt-2 block rounded-md border border-line bg-surface p-4 shadow-card"
          >
            <p className="text-base font-medium text-ink">{contest.title}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {t("recap.entries", { count: contest.entries })} · {t("recap.seeAll")}
            </p>
          </Link>
          {contest.picks.length > 0 ? (
            <>
              <h3 className="mt-4 text-base font-medium text-ink">{t("recap.picks")}</h3>
              <p className="text-sm text-ink-soft">{t("contest.pickedWhy")}</p>
              <ul className="mt-2 flex flex-col gap-2">
                {contest.picks.map((s) => (
                  <SetRow key={s.set_id} set={s} line={`@${s.username}`} />
                ))}
              </ul>
            </>
          ) : null}
          <h3 className="mt-4 text-base font-medium text-ink">{t("recap.top")}</h3>
          {contest.top.length === 0 ? (
            <p className="mt-1 text-sm text-ink-soft">{t("recap.noEntries")}</p>
          ) : (
            <ol className="mt-2 flex flex-col gap-2">
              {contest.top.map((e, i) => (
                <SetRow key={e.set_id} set={e} line={topLine(e)} rank={i + 1} />
              ))}
            </ol>
          )}
        </>
      )}

      <h2 className="mt-6 font-display text-xl text-ink">{t("recap.remix")}</h2>
      <p className="mt-1 text-sm text-ink-soft">{t("recap.remixWhy")}</p>
      {!remix ? (
        <p className="mt-2 text-sm text-ink-soft">{t("recap.noRemix")}</p>
      ) : (
        <ul className="mt-2">
          <SetRow
            set={remix}
            line={`${topLine(remix)}${remix.remixed_from_label ? ` · ${remix.remixed_from_label}` : ""}`}
          />
        </ul>
      )}

      <h2 className="mt-6 font-display text-xl text-ink">{t("recap.yourWeek")}</h2>
      <dl className="mt-2 grid grid-cols-2 gap-2">
        {numbers.map((n) => (
          <div key={n.key} className="rounded-md border border-line bg-surface p-3">
            <dt className="text-sm text-ink-soft">{n.label}</dt>
            <dd className="mt-1 font-display text-2xl text-ink">{n.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-sm text-ink-soft">{t("recap.yourWeekWhy")}</p>
    </div>
  );
}
