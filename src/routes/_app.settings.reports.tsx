import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";
import { myReports, type MyReport } from "@/safety/report";

/** S97 — Settings > Your reports: where each one got to (M7.1). */
export const Route = createFileRoute("/_app/settings/reports")({
  head: () => ({
    meta: [{ title: "Your reports" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: YourReports,
});

type StateKey = `report.state.${MyReport["state"]}`;
type WhatKey = `report.what.${MyReport["target_type"]}`;
type ReasonKey = `report.reason.${MyReport["reason"]}`;

function YourReports() {
  const [rows, setRows] = useState<MyReport[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void myReports().then((r) => !cancelled && setRows(r));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("settings.reports")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("report.statusWhy")}</p>
      {rows === null ? (
        <div className="kl-skeleton mt-4 h-24 w-full rounded-md bg-surface-2" />
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("report.none")} />
        </div>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
          {rows.map((r) => (
            <li key={r.request_ref} className="border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-base text-ink">{r.request_ref}</p>
                <p className="shrink-0 text-sm text-ink-soft">
                  {t(`report.state.${r.state}` as StateKey)}
                </p>
              </div>
              <p className="text-sm text-ink-soft">
                {t(`report.what.${r.target_type}` as WhatKey)} ·{" "}
                {t(`report.reason.${r.reason}` as ReasonKey)} ·{" "}
                {new Date(r.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
