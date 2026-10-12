import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { t } from "@/i18n/en";

import { weeklyRecap, type Recap } from "./recap";

/**
 * S94 on Home — from the Friday close until Monday: the results are in, one tap to the recap.
 * Nothing on the other days; the Monday theme has its own card (ContestCard).
 */
export function RecapCard() {
  const [recap, setRecap] = useState<Recap | null>(null);
  useEffect(() => {
    let cancelled = false;
    void weeklyRecap().then((r) => !cancelled && setRecap(r));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!recap?.show || !recap.contest) return null;
  const { contest, remix } = recap;
  return (
    <Link
      to="/recap"
      className="mt-6 block rounded-md border border-line bg-surface p-4 shadow-card transition-colors duration-fast hover:bg-surface-2"
    >
      <p className="text-sm text-ink-soft">{t("recap.homeCard")}</p>
      <p className="mt-1 text-base font-medium text-ink">{contest.title}</p>
      <p className="mt-1 text-sm text-ink-soft">
        {t("recap.homeLine", { count: contest.entries })}
        {remix ? ` · ${t("recap.homeRemix")}` : ""}
      </p>
    </Link>
  );
}
