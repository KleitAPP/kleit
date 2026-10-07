import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import { appeal as sendAppeal, myStrikes, type Strike } from "@/safety/moderation";

/** S98 — the strike notice: what happened, in plain words, and one appeal (M7.2; spec 13.4 #3–#4). */
export const Route = createFileRoute("/_app/settings_/strikes")({
  head: () => ({ meta: [{ title: "Strikes" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Strikes,
});

function Strikes() {
  const [rows, setRows] = useState<Strike[] | null>(null);
  const [body, setBody] = useState<Record<string, string>>({});
  async function refresh() {
    setRows(await myStrikes());
  }
  useEffect(() => {
    void refresh();
  }, []);
  const live = (rows ?? []).filter((s) => Date.parse(s.expires_at) > Date.now());
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("strikes.title")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("strikes.why", { count: live.length })}</p>
      {rows === null ? (
        <div className="kl-skeleton mt-4 h-24 w-full rounded-md bg-surface-2" />
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("strikes.none")} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {rows.map((s) => {
            const over = Date.parse(s.expires_at) <= Date.now();
            return (
              <li key={s.id} className="rounded-md border border-line bg-surface p-3">
                <p className="text-sm text-ink-soft">
                  {new Date(s.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}{" "}
                  · {s.kind === "copyright" ? t("strikes.copyright") : t("strikes.community")}
                  {over ? ` · ${t("strikes.over")}` : ""}
                </p>
                {s.reason ? <p className="mt-1 text-base text-ink">{s.reason}</p> : null}
                {s.appeal_state ? (
                  <p className="mt-2 text-sm text-ink-soft">
                    {t(`strikes.appeal.${s.appeal_state}`)}
                    {s.appeal_note ? ` — ${s.appeal_note}` : ""}
                  </p>
                ) : over ? null : (
                  <form
                    className="mt-2 flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void sendAppeal(s.id, body[s.id] ?? "").then(refresh);
                    }}
                  >
                    <input
                      type="text"
                      maxLength={1000}
                      value={body[s.id] ?? ""}
                      onChange={(e) => setBody({ ...body, [s.id]: e.target.value })}
                      placeholder={t("strikes.appealHint")}
                      aria-label={t("strikes.appealHint")}
                      className="min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
                    />
                    <PrimaryButton
                      onClick={() => void sendAppeal(s.id, body[s.id] ?? "").then(refresh)}
                      disabled={!(body[s.id] ?? "").trim()}
                    >
                      {t("strikes.appeal")}
                    </PrimaryButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
