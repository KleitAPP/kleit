import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import {
  closePoll,
  deletePoll,
  isClosed,
  loadPoll,
  pollLink,
  reopenPoll,
  type PollOptionRow,
  type PollSummary,
  type PollTotal,
} from "@/polls/polls";
import type { SetSummary } from "@/sets/sets";

/**
 * S53 — poll results, for the owner (design pack §2.3; spec 7.3 #8: totals only, never names).
 *
 * The numbers come from `poll_totals`; the votes table itself is closed to everyone. Under the
 * bars: how many friends voted (counted, not named), the link to send, Close, and "Change the
 * sets", which warns that it clears every vote before it does (spec 7.3 #7).
 */
export const Route = createFileRoute("/_app/poll/$pollId/")({
  head: () => ({ meta: [{ title: "Poll" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: PollPage,
});

function PollPage() {
  const { pollId } = Route.useParams();
  const navigate = useNavigate();
  const [poll, setPoll] = useState<PollSummary | null>(null);
  const [options, setOptions] = useState<PollOptionRow[]>([]);
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [totals, setTotals] = useState<PollTotal[]>([]);
  const [mine, setMine] = useState(false);
  const [missing, setMissing] = useState(false);
  const [confirm, setConfirm] = useState<"reopen" | "delete" | null>(null);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function refresh() {
    const loaded = await loadPoll(pollId);
    if (!loaded) {
      setMissing(true);
      return;
    }
    setPoll(loaded.poll);
    setOptions(loaded.options);
    setSets(loaded.sets);
    setTotals(loaded.totals);
    setMine(loaded.mine);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollId]);

  if (missing) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("pollpage.notFound")} />
      </div>
    );
  }
  if (!poll) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8" role="status" aria-label={t("loading")}>
        <div className="kl-skeleton h-24 w-full rounded-md bg-surface-2" />
      </div>
    );
  }

  const closed = isClosed(poll);
  const link = pollLink(poll);
  const sum = totals.reduce((n, x) => n + x.votes, 0);
  const rawSum = totals.reduce((n, x) => n + x.raw_votes, 0);
  const friends = totals.reduce((n, x) => n + x.friend_votes, 0);
  const closesText = new Date(poll.closes_at).toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });

  async function share() {
    const text = poll?.question || t("pollbuilder.title");
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: text, url: link });
        return;
      }
    } catch {
      /* closed the sheet */
    }
    await copy();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setProblem(t("send.copyFailed"));
    }
  }
  async function reopen() {
    setConfirm(null);
    const ok = await reopenPoll(pollId);
    if (!ok) {
      setProblem(t("pollpage.failed"));
      return;
    }
    void navigate({ to: "/poll/$pollId/edit", params: { pollId } });
  }
  async function close() {
    const ok = await closePoll(pollId);
    if (!ok) setProblem(t("pollpage.failed"));
    else await refresh();
  }
  async function remove() {
    setConfirm(null);
    const ok = await deletePoll(pollId);
    if (!ok) {
      setProblem(t("pollpage.failed"));
      return;
    }
    void navigate({ to: "/you" });
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{poll.question || t("pollbuilder.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {closed ? t("pollpage.closed") : t("pollpage.until", { when: closesText })}
      </p>

      {problem ? (
        <p role="alert" className="mt-3 text-base text-ink">
          {problem}
        </p>
      ) : null}

      <ul className="mt-5 grid gap-4" aria-label={t("pollpage.results")}>
        {options.map((o, i) => {
          const set = sets.find((s) => s.id === o.set_id);
          const row = totals.find((x) => x.option_id === o.id);
          const votes = row?.votes ?? 0;
          const pct = sum === 0 ? 0 : Math.round((votes / sum) * 100);
          const label = o.label.trim() || set?.title || t("pollbuilder.option", { n: i + 1 });
          return (
            <li key={o.id}>
              <div className="flex justify-between text-base text-ink">
                <Link
                  to="/set/$setId"
                  params={{ setId: o.set_id }}
                  className="truncate underline-offset-2 hover:underline"
                >
                  {label}
                </Link>
                <span className="ml-3 shrink-0 tabular-nums">{pct}%</span>
              </div>
              <div
                className="mt-1 h-2 overflow-hidden rounded-pill bg-surface-2"
                aria-hidden="true"
              >
                <div className="h-full rounded-pill bg-brand" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                {(row?.raw_votes ?? 0) === 1
                  ? t("poll.vote1")
                  : t("poll.votes", { count: row?.raw_votes ?? 0 })}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-ink-soft">
        {rawSum === 0
          ? t("pollpage.noVotes")
          : `${rawSum === 1 ? t("poll.vote1") : t("poll.votes", { count: rawSum })} · ${t("pollpage.friends", { count: friends })}`}{" "}
        · {t("pollpage.totalsOnly")}
      </p>

      {mine ? (
        <>
          <section className="mt-6 rounded-md border border-line bg-surface p-4">
            <h2 className="text-base font-medium text-ink">{t("send.theLink")}</h2>
            <p className="mt-1 break-all text-sm text-ink-soft">{link}</p>
            <div className="mt-3 flex gap-2">
              <PrimaryButton onClick={() => void share()} disabled={closed}>
                {t("send.send")}
              </PrimaryButton>
              <button
                type="button"
                onClick={() => void copy()}
                className="flex min-h-12 shrink-0 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink"
              >
                {copied ? t("send.copied") : t("send.copyLink")}
              </button>
            </div>
          </section>

          <ul className="mt-6 divide-y divide-line">
            {!closed ? (
              <li>
                <button
                  type="button"
                  onClick={() => void close()}
                  className="flex min-h-12 w-full items-center text-left text-base text-ink"
                >
                  {t("pollpage.close")}
                </button>
              </li>
            ) : null}
            {!closed ? (
              <li>
                {poll.locked ? (
                  <button
                    type="button"
                    onClick={() => setConfirm("reopen")}
                    className="flex min-h-12 w-full items-center text-left text-base text-ink"
                  >
                    {t("pollpage.changeSets")}
                  </button>
                ) : (
                  <Link
                    to="/poll/$pollId/edit"
                    params={{ pollId }}
                    className="flex min-h-12 items-center text-base text-ink"
                  >
                    {t("pollpage.changeSets")}
                  </Link>
                )}
              </li>
            ) : null}
            <li>
              <button
                type="button"
                onClick={() => setConfirm("delete")}
                className="flex min-h-12 w-full items-center text-left text-base text-danger"
              >
                {t("pollpage.delete")}
              </button>
            </li>
          </ul>
        </>
      ) : null}

      <Sheet
        open={confirm === "reopen"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t("pollpage.changeSets")}
        description={t("pollpage.reopenWarning")}
        action={
          <PrimaryButton onClick={() => void reopen()}>{t("pollpage.reopenConfirm")}</PrimaryButton>
        }
      />
      <Sheet
        open={confirm === "delete"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t("pollpage.delete")}
        description={t("pollpage.deleteWarning")}
        action={
          <PrimaryButton onClick={() => void remove()}>{t("pollpage.deleteConfirm")}</PrimaryButton>
        }
      />
    </div>
  );
}
