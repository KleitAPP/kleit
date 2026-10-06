import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { t } from "@/i18n/en";

import { closesIn, currentContest, type Contest } from "./contests";

/** S94 (first half) — the Monday theme on Home: this week's open challenge, one tap away (M6.2/M6.4). */
export function ContestCard() {
  const [contest, setContest] = useState<Contest | null>(null);
  useEffect(() => {
    let cancelled = false;
    void currentContest().then((c) => !cancelled && setContest(c));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!contest) return null;
  return (
    <Link
      to="/contests/$contestId"
      params={{ contestId: contest.id }}
      className="mt-6 block rounded-md border border-line bg-surface p-4 shadow-card transition-colors duration-fast hover:bg-surface-2"
    >
      <p className="text-sm text-ink-soft">{t("contest.homeCard")}</p>
      <p className="mt-1 text-base font-medium text-ink">{contest.title}</p>
      <p className="mt-1 text-sm text-ink-soft">{closesIn(contest)}</p>
    </Link>
  );
}
