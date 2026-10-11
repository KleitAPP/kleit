import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import {
  adminContests,
  closeNow,
  closesIn,
  dropTheme,
  isOpen,
  moveTheme,
  oneContest,
  openNextNow,
  pickEntry,
  queueTheme,
  startContest,
  waitingThemes,
  type AdminContest,
  type Entry,
  type Theme,
} from "@/contests/contests";
import { t } from "@/i18n/en";
import { myRoles } from "@/safety/moderation";
import { previewUrl } from "@/search/search";

/**
 * S101 — admin contests (spec 11 #3–#4; migration 085). Admins only. The Monday timer still
 * opens the front of the queue by itself; this screen fills the queue, opens or closes one by
 * hand, and judges a closed one: a pick is a feature on Home, a badge and a note to the person.
 * Badges and features only - never money (spec 11 #3). Every act is in the audit log.
 */
export const Route = createFileRoute("/_app/mod_/contests")({
  head: () => ({
    meta: [{ title: "Challenges" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminContests,
});

function AdminContests() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [list, setList] = useState<AdminContest[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [board, setBoard] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [days, setDays] = useState(7);
  const [startProblem, setStartProblem] = useState<"open" | "failed" | null>(null);

  const now = Date.now();
  const open = list.find((c) => isOpen(c, now)) ?? null;
  const latestClosed = list.find((c) => !isOpen(c, now) && Date.parse(c.closes_at) <= now) ?? null;
  // The board shown is the open one's while one is open, else the most recent closed one's
  // (that is the one waiting to be judged).
  const judged = open ?? latestClosed;

  async function refresh() {
    const [c, th] = await Promise.all([adminContests(), waitingThemes()]);
    setList(c);
    setThemes(th);
    const nowMs = Date.now();
    const current =
      c.find((x) => isOpen(x, nowMs)) ??
      c.find((x) => !isOpen(x, nowMs) && Date.parse(x.closes_at) <= nowMs) ??
      null;
    setBoard(current ? ((await oneContest(current.id))?.board ?? []) : []);
  }
  useEffect(() => {
    let cancelled = false;
    void myRoles().then(async (r) => {
      const ok = r.includes("admin");
      if (cancelled) return;
      setAllowed(ok);
      if (ok) await refresh();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await action();
    if (!ok) setFailed(true);
    await refresh();
    setBusy(false);
  }

  async function add() {
    const tt = title.trim();
    if (tt.length < 3 || tt.length > 80 || brief.length > 500) return;
    await run(async () => {
      const ok = await queueTheme(tt, brief.trim());
      if (ok) {
        setTitle("");
        setBrief("");
      }
      return ok;
    });
  }

  async function start() {
    const tt = title.trim();
    if (tt.length < 3 || tt.length > 80 || brief.length > 500) return;
    setStartProblem(null);
    await run(async () => {
      const r = await startContest(tt, brief.trim(), days);
      if (!r.ok) {
        setStartProblem(r.problem);
        return r.problem === "open"; // a clear message of its own, not "didn't go through"
      }
      setTitle("");
      setBrief("");
      return true;
    });
  }

  if (allowed === null) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("mod.notHere")} />
      </div>
    );
  }

  const past = list.filter((c) => c.id !== judged?.id && Date.parse(c.closes_at) <= now);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("admincontest.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("admincontest.why")}</p>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {t("admincontest.failed")}
        </p>
      ) : null}

      {/* This week */}
      <h2 className="mt-6 font-display text-xl text-ink">{t("contest.thisWeek")}</h2>
      {open ? (
        <div className="mt-2 rounded-md border border-line bg-surface p-4 shadow-card">
          <Link
            to="/contests/$contestId"
            params={{ contestId: open.id }}
            className="block text-base font-medium text-ink"
          >
            {open.title}
          </Link>
          {open.theme ? <p className="mt-1 text-sm text-ink-soft">{open.theme}</p> : null}
          <p className="mt-2 text-sm text-ink-soft">
            {t("admincontest.closesIn", { when: closesIn(open), count: open.entries })}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setClosing(true)}
            className="mt-3 min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
          >
            {t("admincontest.closeEarly")}
          </button>
          <p className="mt-1 text-sm text-ink-soft">{t("admincontest.closeEarlyWhy")}</p>
        </div>
      ) : (
        <div className="mt-2 rounded-md border border-line bg-surface p-4">
          <p className="text-base text-ink">{t("admincontest.nothingOpen")}</p>
          <button
            type="button"
            disabled={busy || themes.length === 0}
            onClick={() => void run(async () => (await openNextNow()) !== null)}
            className="mt-3 min-h-11 rounded-pill border border-ink bg-ink px-4 text-sm text-canvas disabled:opacity-50"
          >
            {t("admincontest.openNext")}
          </button>
          <p className="mt-1 text-sm text-ink-soft">{t("admincontest.openNextWhy")}</p>
        </div>
      )}

      {/* The board of the open one, or of the last closed one (judging) */}
      {judged ? (
        <>
          <h2 className="mt-6 font-display text-xl text-ink">
            {t("admincontest.board")}
            {judged.id !== open?.id ? (
              <span className="ml-2 text-sm font-normal text-ink-soft">{judged.title}</span>
            ) : null}
          </h2>
          {judged.id !== open?.id ? (
            <p className="mt-1 text-sm text-ink-soft">{t("admincontest.pickWhy")}</p>
          ) : null}
          {board.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">{t("contest.noEntries")}</p>
          ) : (
            <ol className="mt-2 flex flex-col gap-2">
              {board.map((e, i) => {
                const url = previewUrl(e);
                const picked = !!e.picked_at;
                return (
                  <li
                    key={e.set_id}
                    className="flex items-center gap-3 rounded-md border border-line bg-surface p-3"
                  >
                    <span className="w-6 text-base text-ink-soft">{i + 1}</span>
                    <Link
                      to="/set/$setId"
                      params={{ setId: e.set_id }}
                      className="size-14 shrink-0 overflow-hidden rounded-sm bg-surface-2"
                    >
                      {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
                    </Link>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base text-ink">{e.title || "…"}</span>
                      <span className="block text-sm text-ink-soft">
                        @{e.username} · {t("contest.likes", { count: e.likes })}
                      </span>
                    </span>
                    {judged.id !== open?.id ? (
                      <button
                        type="button"
                        disabled={busy}
                        aria-pressed={picked}
                        onClick={() => void run(() => pickEntry(judged.id, e.set_id, !picked))}
                        className={`min-h-11 shrink-0 rounded-pill border px-3 text-sm ${picked ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink"}`}
                      >
                        {picked ? t("admincontest.unpick") : t("admincontest.pick")}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      ) : null}

      {/* The queue */}
      <h2 className="mt-6 font-display text-xl text-ink">{t("admincontest.queue")}</h2>
      {themes.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{t("admincontest.queueEmpty")}</p>
      ) : (
        <ol className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
          {themes.map((th, i) => (
            <li
              key={th.id}
              className="flex items-center gap-2 border-b border-line px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base text-ink">
                  {i === 0 ? (
                    <span className="mr-2 rounded-pill border border-ink px-2 py-0.5 text-xs">
                      {t("admincontest.position")}
                    </span>
                  ) : null}
                  {th.title}
                </span>
                {th.theme ? (
                  <span className="block truncate text-sm text-ink-soft">{th.theme}</span>
                ) : null}
              </span>
              <button
                type="button"
                disabled={busy || i === 0}
                aria-label={`${t("admincontest.up")}: ${th.title}`}
                onClick={() => void run(() => moveTheme(th.id, "up"))}
                className="min-h-11 rounded-pill border border-line bg-surface px-3 text-sm text-ink disabled:opacity-40"
              >
                {t("admincontest.up")}
              </button>
              <button
                type="button"
                disabled={busy || i === themes.length - 1}
                aria-label={`${t("admincontest.down")}: ${th.title}`}
                onClick={() => void run(() => moveTheme(th.id, "down"))}
                className="min-h-11 rounded-pill border border-line bg-surface px-3 text-sm text-ink disabled:opacity-40"
              >
                {t("admincontest.down")}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`${t("admincontest.drop")}: ${th.title}`}
                onClick={() => void run(() => dropTheme(th.id))}
                className="min-h-11 rounded-pill border border-line bg-surface px-3 text-sm text-danger"
              >
                {t("admincontest.drop")}
              </button>
            </li>
          ))}
        </ol>
      )}

      {/* Add a theme / start one now */}
      <form
        className="mt-4 flex flex-col gap-2 rounded-md border border-line bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <p className="text-base font-medium text-ink">{t("admincontest.add")}</p>
        <label className="block">
          <span className="text-sm text-ink-soft">{t("admincontest.addTitle")}</span>
          <input
            type="text"
            value={title}
            maxLength={80}
            placeholder={t("admincontest.addTitlePlaceholder")}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        </label>
        <label className="block">
          <span className="text-sm text-ink-soft">{t("admincontest.addTheme")}</span>
          <textarea
            value={brief}
            maxLength={500}
            rows={2}
            placeholder={t("admincontest.addThemePlaceholder")}
            onChange={(e) => setBrief(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink"
          />
        </label>
        <PrimaryButton onClick={() => void add()} disabled={busy || title.trim().length < 3}>
          {t("admincontest.addGo")}
        </PrimaryButton>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-sm text-ink-soft">{t("admincontest.start")}</span>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            {t("admincontest.days")}
            <input
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 7)))}
              className="min-h-11 w-16 rounded-md border border-line bg-surface px-2 text-base text-ink"
            />
          </label>
          <button
            type="button"
            disabled={busy || !!open || title.trim().length < 3}
            onClick={() => void start()}
            className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink disabled:opacity-40"
          >
            {t("admincontest.startGo")}
          </button>
        </div>
        <p className="text-sm text-ink-soft">
          {startProblem === "open" ? t("admincontest.startOpen") : t("admincontest.startWhy")}
        </p>
      </form>

      {/* Past */}
      {past.length > 0 ? (
        <>
          <h2 className="mt-6 font-display text-xl text-ink">{t("admincontest.past")}</h2>
          <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
            {past.map((c) => (
              <li key={c.id} className="border-b border-line last:border-b-0">
                <Link
                  to="/contests/$contestId"
                  params={{ contestId: c.id }}
                  className="block min-h-12 px-4 py-3"
                >
                  <p className="text-base text-ink">{c.title}</p>
                  <p className="text-sm text-ink-soft">
                    {t("admincontest.pastLine", { entries: c.entries, picks: c.picks })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {/* Closing early: the plain warning first (G6). */}
      <Sheet open={closing} onOpenChange={setClosing} title={t("admincontest.closeEarly")}>
        <p className="text-base text-ink">{t("admincontest.closeEarlyConfirm")}</p>
        <div className="mt-4 flex gap-2">
          <PrimaryButton
            onClick={() => {
              if (!open) return;
              setClosing(false);
              void run(() => closeNow(open.id));
            }}
          >
            {t("admincontest.closeEarlyGo")}
          </PrimaryButton>
        </div>
      </Sheet>
    </div>
  );
}
