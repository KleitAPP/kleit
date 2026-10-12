import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";

/**
 * S93 — Your points (M6.5; spec 11 #5): level, points, badges and how they came. Every number
 * here was written by the server; nothing on this screen can be edited.
 */
export const Route = createFileRoute("/_app/you_/points")({
  head: () => ({
    meta: [{ title: "Your points" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Points,
});

type Summary = { points: number; level: number; badges: string[] };
type Row = { points: number; reason: string; created_at: string };

const BADGES = [
  "first_set",
  "ten_sets",
  "style_icon",
  "first_contest",
  "well_liked",
  "followed",
  "contest_pick",
] as const;
type BadgeKey = `badge.${(typeof BADGES)[number]}`;
type ReasonKey =
  `points.${"publish" | "like_received" | "follower" | "contest_entry" | "clip_used"}`;
const LEVEL_FLOORS = [0, 100, 500, 2000, 10000];

function Points() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.rpc("my_points");
      const first = (data ?? [])[0];
      const { data: ledger } = await supabase
        .from("points_ledger")
        .select("points, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      setSum(
        first
          ? { points: first.points, level: first.level, badges: first.badges ?? [] }
          : { points: 0, level: 1, badges: [] },
      );
      setRows(ledger ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!sum) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  const next = LEVEL_FLOORS[sum.level] ?? null;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("points.title")}</h1>
      <div className="mt-4 rounded-md border border-line bg-surface p-4 shadow-card">
        <p className="text-sm text-ink-soft">{t("points.level", { level: sum.level })}</p>
        <p className="mt-1 font-display text-3xl text-ink">
          {t("points.count", { count: sum.points })}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {next === null
            ? t("points.top")
            : t("points.toNext", { count: next - sum.points, level: sum.level + 1 })}
        </p>
      </div>
      <p className="mt-2 text-sm text-ink-soft">{t("points.how")}</p>

      <h2 className="mt-6 font-display text-xl text-ink">{t("points.badges")}</h2>
      <ul className="mt-2 grid grid-cols-2 gap-2">
        {BADGES.map((b) => {
          const won = sum.badges.includes(b);
          return (
            <li
              key={b}
              className={`rounded-md border p-3 ${won ? "border-ink bg-surface" : "border-line bg-surface-2"}`}
            >
              <p className={`text-base ${won ? "text-ink" : "text-ink-soft"}`}>
                {t(`badge.${b}` as BadgeKey)}
              </p>
              <p className="text-sm text-ink-soft">{t(`badge.${b}.how` as `${BadgeKey}.how`)}</p>
              {won ? <p className="mt-1 text-sm text-positive">{t("points.earned")}</p> : null}
            </li>
          );
        })}
      </ul>

      <h2 className="mt-6 font-display text-xl text-ink">{t("points.history")}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{t("points.none")}</p>
      ) : (
        <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
          {rows.map((r, i) => (
            <li
              key={i}
              className="flex items-center justify-between border-b border-line px-4 py-3 last:border-b-0"
            >
              <span className="text-base text-ink">{t(`points.${r.reason}` as ReasonKey)}</span>
              <span className="text-sm text-ink-soft">+{r.points}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
