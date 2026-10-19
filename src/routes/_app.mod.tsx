import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { ChevronRight } from "lucide-react";

import { t, type MessageKey } from "@/i18n/en";
import {
  decideAppeal,
  modImageUrl,
  moderate,
  myRoles,
  openAppeals,
  queue as loadQueue,
  scanDecide,
  scanReviewQueue,
  type Action,
  type OpenAppeal,
  type QueueItem,
  type ScanReview,
} from "@/safety/moderation";
import { previewUrl } from "@/search/search";

/**
 * S99 — the review queue (M7.2; spec 13.4 #1–#2). Moderators only; everyone else sees "not
 * here". Pictures start blurred and greyed and sharpen on tap, so nobody has to look at
 * anything they did not choose to. Urgent first (a child, an intimate image, self-harm), each
 * with the time it is due (a day for urgent, three days for the rest). The photos the scanner
 * sent to a person wait in their own list (spec 13.1 #3; migration 113), and an appeal on a
 * blocked photo sits with the strike appeals - decided by a different person than the one who
 * blocked or struck. A picture the world may not see opens through the mod-image function,
 * which logs the view (spec 13.4 #9).
 */
export const Route = createFileRoute("/_app/mod")({
  head: () => ({
    meta: [{ title: "Review queue" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: ModQueue,
});

type ReasonKey = Parameters<typeof t>[0];
type WhatKey = `report.what.${QueueItem["target_type"]}`;

function ModQueue() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [appeals, setAppeals] = useState<OpenAppeal[]>([]);
  const [scans, setScans] = useState<ScanReview[]>([]);
  const [acting, setActing] = useState<{ item: QueueItem; action: Action } | null>(null);
  const [deciding, setDeciding] = useState<{
    scan: ScanReview;
    outcome: "clean" | "blocked";
  } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [appealFailure, setAppealFailure] = useState<Record<string, string>>({});

  async function refresh() {
    const [q, a, sc] = await Promise.all([loadQueue(), openAppeals(), scanReviewQueue()]);
    setItems(q);
    setAppeals(a);
    setScans(sc);
  }

  async function decideScan() {
    if (!deciding || busy) return;
    setBusy(true);
    const problem = await scanDecide(deciding.scan.item_id, deciding.outcome, note);
    setBusy(false);
    setFailure(problem);
    if (!problem || problem === t("mod.err.done")) {
      setDeciding(null);
      setNote("");
      await refresh();
    }
  }

  async function decide(a: OpenAppeal, outcome: "upheld" | "overturned") {
    const problem = await decideAppeal(a.id, outcome, "");
    setAppealFailure({ ...appealFailure, [a.id]: problem ?? "" });
    if (!problem) await refresh();
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const roles = await myRoles();
      if (cancelled) return;
      const ok = roles.includes("admin") || roles.includes("moderator");
      setAllowed(ok);
      if (ok) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function act() {
    if (!acting || busy) return;
    setBusy(true);
    const problem = await moderate(acting.item.id, acting.action, note);
    setBusy(false);
    setFailure(problem);
    if (!problem || problem === t("mod.err.done")) {
      setActing(null);
      setNote("");
      await refresh();
    }
  }

  if (allowed === null) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("mod.notHere")} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("mod.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("mod.why")}</p>
      {/* The five other screens, as real rows - they were a line of small underlined words
          that read as text on a phone (2026-10-09). */}
      <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        {t("mod.tools")}
      </h2>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
        {TOOLS.map(({ to, label, hint }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex min-h-14 items-center gap-3 px-4 py-2 text-ink transition-colors duration-fast hover:bg-surface-2"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-medium">{t(label)}</span>
                <span className="truncate text-sm text-ink-soft">{t(hint)}</span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-ink-soft" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 font-display text-xl text-ink">{t("mod.queueTitle")}</h2>

      {items.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("mod.empty")} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {items.map((r) => (
            <QueueRow
              key={r.id}
              r={r}
              onAct={(action) => {
                setFailure(null);
                setActing({ item: r, action });
              }}
            />
          ))}
        </ul>
      )}

      <h2 className="mt-8 font-display text-xl text-ink">{t("mod.scanTitle")}</h2>
      <p className="mt-1 text-sm text-ink-soft">{t("mod.scanWhy")}</p>
      {scans.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{t("mod.scanNone")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {scans.map((sc) => (
            <li key={sc.item_id} className="rounded-md border border-line bg-surface p-3">
              <p className="text-sm text-ink-soft">
                @{sc.owner_username ?? "…"} · {when(sc.created_at)}
              </p>
              {sc.title ? <p className="mt-1 text-base text-ink">{sc.title}</p> : null}
              {sc.because?.length ? (
                <p className="mt-1 text-sm text-ink-soft">
                  {t("mod.scanBecause", { labels: sc.because.join(", ") })}
                </p>
              ) : null}
              <PrivatePicture itemId={sc.item_id} why="scan-review" />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFailure(null);
                    setDeciding({ scan: sc, outcome: "clean" });
                  }}
                  className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
                >
                  {t("mod.scanAllow")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFailure(null);
                    setDeciding({ scan: sc, outcome: "blocked" });
                  }}
                  className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-danger"
                >
                  {t("mod.scanBlock")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 font-display text-xl text-ink">{t("mod.appeals")}</h2>
      {appeals.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{t("mod.noAppeals")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {appeals.map((a) => (
            <li key={a.id} className="rounded-md border border-line bg-surface p-3">
              <p className="text-sm text-ink-soft">
                @{a.username ?? "…"} · {a.item_id ? t("mod.appealPhoto") : t("mod.appealStrike")} ·{" "}
                {t("mod.appealDue", { date: dueDate(a.created_at, 7 * 24) })}
              </p>
              <p className="mt-1 text-base text-ink">{a.body}</p>
              {a.item_id ? <PrivatePicture itemId={a.item_id} why="appeal" /> : null}
              {appealFailure[a.id] ? (
                <p role="alert" className="mt-2 text-sm font-medium text-danger">
                  {appealFailure[a.id]}
                </p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void decide(a, "overturned")}
                  className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
                >
                  {a.item_id ? t("mod.overturnPhoto") : t("mod.overturn")}
                </button>
                <button
                  type="button"
                  onClick={() => void decide(a, "upheld")}
                  className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
                >
                  {a.item_id ? t("mod.upholdPhoto") : t("mod.uphold")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={deciding !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDeciding(null);
            setFailure(null);
          }
        }}
        title={
          deciding ? (deciding.outcome === "clean" ? t("mod.scanAllow") : t("mod.scanBlock")) : ""
        }
        action={
          <PrimaryButton onClick={() => void decideScan()} disabled={busy}>
            {busy
              ? t("loading")
              : deciding?.outcome === "clean"
                ? t("mod.scanAllow")
                : t("mod.scanBlock")}
          </PrimaryButton>
        }
      >
        {failure && deciding ? (
          <p role="alert" className="mb-3 text-sm font-medium text-danger">
            {failure}
          </p>
        ) : null}
        <label className="block">
          <span className="text-sm text-ink-soft">{t("mod.note")}</span>
          <input
            type="text"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        </label>
      </Sheet>

      <Sheet
        open={acting !== null}
        onOpenChange={(o) => {
          if (!o) {
            setActing(null);
            setFailure(null);
          }
        }}
        title={acting ? t(`mod.confirm.${acting.action}`) : ""}
        {...(acting ? { description: t(`mod.confirmWhy.${acting.action}`) } : {})}
        action={
          <PrimaryButton onClick={() => void act()} disabled={busy}>
            {busy ? t("loading") : acting ? t(`mod.act.${acting.action}`) : ""}
          </PrimaryButton>
        }
      >
        {failure ? (
          <p role="alert" className="mb-3 text-sm font-medium text-danger">
            {failure}
          </p>
        ) : null}
        <label className="block">
          <span className="text-sm text-ink-soft">{t("mod.note")}</span>
          <input
            type="text"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        </label>
      </Sheet>
    </div>
  );
}

const TOOLS: readonly { to: string; label: MessageKey; hint: MessageKey }[] = [
  { to: "/mod/takedowns", label: "mod.takedowns", hint: "mod.toolsTakedowns" },
  { to: "/mod/contact", label: "mod.contact", hint: "mod.toolsContact" },
  { to: "/mod/users", label: "mod.users", hint: "mod.toolsUsers" },
  { to: "/mod/switches", label: "mod.switches", hint: "mod.toolsSwitches" },
  { to: "/mod/contests", label: "mod.contests", hint: "mod.toolsContests" },
  { to: "/mod/invites", label: "mod.invites", hint: "mod.toolsInvites" },
  { to: "/mod/log", label: "mod.log", hint: "mod.toolsLog" },
];

function when(at: string): string {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Due in 20 h" or "Overdue by 3 h", from the queue's due time (spec 13.4 #1). */
function dueWords(dueAt: string): string {
  const hours = Math.round((new Date(dueAt).getTime() - Date.now()) / 3_600_000);
  return hours >= 0 ? t("mod.dueIn", { hours }) : t("mod.overdue", { hours: -hours });
}

function dueDate(from: string, hours: number): string {
  return new Date(new Date(from).getTime() + hours * 3_600_000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * A picture the world may not see: fetched through mod-image on the first tap (the function
 * logs the view), shown blurred and greyed until tapped again.
 */
function PrivatePicture({
  itemId,
  why,
}: {
  itemId: string;
  why: "queue" | "scan-review" | "appeal";
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [problem, setProblem] = useState(false);
  async function open() {
    if (url) {
      setShown(!shown);
      return;
    }
    const signed = await modImageUrl(itemId, why);
    if (!signed) {
      setProblem(true);
      return;
    }
    setUrl(signed);
  }
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => void open()}
        aria-label={shown ? t("mod.hide") : t("mod.show")}
        className="block size-40 overflow-hidden rounded-sm bg-surface-2"
      >
        {url ? (
          <img
            src={url}
            alt=""
            className={
              shown ? "size-full object-cover" : "size-full object-cover blur-lg grayscale"
            }
          />
        ) : null}
      </button>
      {problem ? <p className="mt-1 text-sm text-danger">{t("mod.pictureFailed")}</p> : null}
    </div>
  );
}

function QueueRow({ r, onAct }: { r: QueueItem; onAct: (a: Action) => void }) {
  const [shown, setShown] = useState(false);
  const url = r.preview_image_id ? previewUrl({ preview_image_id: r.preview_image_id }) : null;
  const btn = "min-h-11 rounded-pill border border-line bg-surface px-3 text-sm text-ink";
  const overdue = new Date(r.due_at).getTime() < Date.now();
  return (
    <li className="rounded-md border border-line bg-surface p-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ink-soft">
          {r.request_ref} · {when(r.created_at)}
          {r.priority === "urgent" ? (
            <span className="ml-2 font-medium text-danger">{t("mod.urgent")}</span>
          ) : null}
          <span className={`ml-2 ${overdue ? "font-medium text-danger" : ""}`}>
            {dueWords(r.due_at)}
          </span>
        </p>
        <p className="shrink-0 text-sm text-ink-soft">
          {t("mod.reportsOn", { count: r.reports_on_target })}
        </p>
      </div>
      <p className="mt-1 text-base text-ink">
        {t(`report.what.${r.target_type}` as WhatKey)} ·{" "}
        {t(`report.reason.${r.reason}` as ReasonKey)}
        {r.target_username ? <span className="text-ink-soft"> · @{r.target_username}</span> : null}
      </p>
      {r.note ? <p className="mt-1 text-sm text-ink-soft">“{r.note}”</p> : null}
      {r.title ? <p className="mt-2 text-base text-ink">{r.title}</p> : null}
      {r.body ? (
        <p className="mt-2 rounded-sm bg-surface-2 p-2 text-base text-ink">{r.body}</p>
      ) : null}
      {url ? (
        <button
          type="button"
          onClick={() => setShown(!shown)}
          aria-label={shown ? t("mod.hide") : t("mod.show")}
          className="mt-2 block size-40 overflow-hidden rounded-sm bg-surface-2"
        >
          <img
            src={url}
            alt=""
            className={
              shown ? "size-full object-cover" : "size-full object-cover blur-lg grayscale"
            }
          />
        </button>
      ) : null}
      {!url && r.picture_item_id ? <PrivatePicture itemId={r.picture_item_id} why="queue" /> : null}
      {r.evidence ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-ink">
            {t("mod.evidence", { count: r.evidence.length })}
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {r.evidence.map((m, i) => (
              <li key={i} className="rounded-sm bg-surface-2 p-2 text-sm text-ink">
                <span className="text-ink-soft">
                  {m.sender === r.target_owner ? t("mod.them") : t("mod.reporter")}:{" "}
                </span>
                {m.body}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onAct("dismiss")} className={btn}>
          {t("mod.act.dismiss")}
        </button>
        {r.target_type !== "profile" && r.target_type !== "conversation" ? (
          <>
            <button type="button" onClick={() => onAct("remove")} className={btn}>
              {t("mod.act.remove")}
            </button>
            <button type="button" onClick={() => onAct("strike")} className={btn}>
              {t("mod.act.strike")}
            </button>
          </>
        ) : null}
        <button type="button" onClick={() => onAct("ban")} className={`${btn} text-danger`}>
          {t("mod.act.ban")}
        </button>
      </div>
    </li>
  );
}
