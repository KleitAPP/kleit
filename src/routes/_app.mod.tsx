import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import {
  decideAppeal,
  moderate,
  myRoles,
  openAppeals,
  queue as loadQueue,
  type Action,
  type OpenAppeal,
  type QueueItem,
} from "@/safety/moderation";
import { previewUrl } from "@/search/search";

/**
 * S99 — the review queue (M7.2; spec 13.4 #1–#2). Moderators only; everyone else sees "not
 * here". Pictures start blurred and greyed and sharpen on tap, so nobody has to look at
 * anything they did not choose to. Urgent first (a child, an intimate image, self-harm).
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
  const [acting, setActing] = useState<{ item: QueueItem; action: Action } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [q, a] = await Promise.all([loadQueue(), openAppeals()]);
    setItems(q);
    setAppeals(a);
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
    const ok = await moderate(acting.item.id, acting.action, note);
    setBusy(false);
    if (ok) {
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

      {items.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("mod.empty")} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {items.map((r) => (
            <QueueRow key={r.id} r={r} onAct={(action) => setActing({ item: r, action })} />
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
              <p className="text-sm text-ink-soft">@{a.username ?? "…"}</p>
              <p className="mt-1 text-base text-ink">{a.body}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void decideAppeal(a.id, "overturned", "").then(refresh)}
                  className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
                >
                  {t("mod.overturn")}
                </button>
                <button
                  type="button"
                  onClick={() => void decideAppeal(a.id, "upheld", "").then(refresh)}
                  className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
                >
                  {t("mod.uphold")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={acting !== null}
        onOpenChange={(o) => !o && setActing(null)}
        title={acting ? t(`mod.confirm.${acting.action}`) : ""}
        {...(acting ? { description: t(`mod.confirmWhy.${acting.action}`) } : {})}
        action={
          <PrimaryButton onClick={() => void act()} disabled={busy}>
            {busy ? t("loading") : acting ? t(`mod.act.${acting.action}`) : ""}
          </PrimaryButton>
        }
      >
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

function QueueRow({ r, onAct }: { r: QueueItem; onAct: (a: Action) => void }) {
  const [shown, setShown] = useState(false);
  const url = r.preview_image_id ? previewUrl({ preview_image_id: r.preview_image_id }) : null;
  const when = new Date(r.created_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const btn = "min-h-11 rounded-pill border border-line bg-surface px-3 text-sm text-ink";
  return (
    <li className="rounded-md border border-line bg-surface p-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ink-soft">
          {r.request_ref} · {when}
          {r.priority === "urgent" ? (
            <span className="ml-2 font-medium text-danger">{t("mod.urgent")}</span>
          ) : null}
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
