import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, PrimaryButton } from "@/components/kleit";
import {
  closesIn,
  enter as enterContest,
  isOpen,
  myPublicSets,
  oneContest,
  withdraw as withdrawEntry,
  type Contest,
  type Entry,
} from "@/contests/contests";
import { t } from "@/i18n/en";
import { previewUrl } from "@/search/search";
import { me as whoAmI } from "@/social/follows";

/** S92 — one contest: the theme, how to enter, the board; enter with a public set, withdraw (M6.4). */
export const Route = createFileRoute("/_app/contests_/$contestId")({
  head: () => ({ meta: [{ title: "Contest" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: ContestPage,
});

function ContestPage() {
  const { contestId } = Route.useParams();
  const [me, setMe] = useState<string | null>(null);
  const [contest, setContest] = useState<Contest | null | undefined>(undefined);
  const [board, setBoard] = useState<Entry[]>([]);
  const [sets, setSets] = useState<{ id: string; title: string }[]>([]);
  const [setId, setSetId] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);

  async function refresh() {
    const r = await oneContest(contestId);
    setContest(r?.contest ?? null);
    setBoard(r?.board ?? []);
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const who = await whoAmI();
      if (cancelled) return;
      setMe(who);
      await refresh();
      setSets(await myPublicSets());
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestId]);

  if (contest === undefined) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!contest) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("contest.notFound")} />
      </div>
    );
  }
  const open = isOpen(contest);
  const mine = board.find((e) => e.user_id === me) ?? null;

  async function submit() {
    if (!setId) return;
    setProblem(false);
    const ok = await enterContest(contestId, setId);
    if (!ok) {
      setProblem(true);
      return;
    }
    setSetId(null);
    await refresh();
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{contest.title}</h1>
      {contest.theme ? <p className="mt-2 text-base text-ink">{contest.theme}</p> : null}
      <p className="mt-1 text-sm text-ink-soft">
        {closesIn(contest)} · {t("contest.badgesOnly")}
      </p>

      {open && !mine ? (
        <form
          className="mt-4 flex flex-col gap-2 rounded-md border border-line bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-base text-ink">{t("contest.enterWith")}</p>
          {sets.length === 0 ? (
            <p className="text-sm text-ink-soft">{t("ask.noPublicSets")}</p>
          ) : (
            <div
              className="flex gap-2 overflow-x-auto pb-1"
              role="group"
              aria-label={t("contest.enterWith")}
            >
              {sets.map((s) => (
                <Chip
                  key={s.id}
                  label={s.title || "…"}
                  selected={setId === s.id}
                  onToggle={() => setSetId(setId === s.id ? null : s.id)}
                />
              ))}
            </div>
          )}
          <PrimaryButton onClick={() => void submit()} disabled={!setId}>
            {t("contest.enter")}
          </PrimaryButton>
          {problem ? (
            <p role="alert" className="text-sm text-danger">
              {t("dm.failed")}
            </p>
          ) : null}
        </form>
      ) : null}
      {mine ? (
        <div className="mt-4 flex items-center justify-between rounded-md border border-line bg-surface p-3">
          <p className="text-sm text-ink">
            {t("contest.youEntered", { title: mine.title || "…" })}
          </p>
          {open ? (
            <button
              type="button"
              onClick={() => void withdrawEntry(contestId).then(refresh)}
              className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
            >
              {t("contest.withdraw")}
            </button>
          ) : null}
        </div>
      ) : null}

      <h2 className="mt-6 font-display text-xl text-ink">
        {open ? t("contest.board") : t("contest.results")}
      </h2>
      {board.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{t("contest.noEntries")}</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-2">
          {board.map((e, i) => {
            const url = previewUrl(e);
            return (
              <li key={e.set_id} className="rounded-md border border-line bg-surface p-3">
                <Link
                  to="/set/$setId"
                  params={{ setId: e.set_id }}
                  className="flex items-center gap-3"
                >
                  <span className="w-6 text-base text-ink-soft">{i + 1}</span>
                  <span className="size-14 shrink-0 overflow-hidden rounded-sm bg-surface-2">
                    {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-ink">{e.title || "…"}</span>
                    <span className="block text-sm text-ink-soft">
                      @{e.username} · {t("contest.likes", { count: e.likes })}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
