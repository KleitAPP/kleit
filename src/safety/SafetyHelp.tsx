import { t } from "@/i18n/en";

/** S103 — the help card: two real numbers, no judgement, no tracking of who saw it. */
export function SafetyHelp() {
  return (
    <aside
      role="note"
      aria-label={t("safety.title")}
      className="mt-3 rounded-md border border-ink bg-surface p-4 shadow-card"
    >
      <p className="text-base font-medium text-ink">{t("safety.title")}</p>
      <p className="mt-1 text-sm text-ink">{t("safety.body")}</p>
      <ul className="mt-2 flex flex-col gap-1 text-sm text-ink">
        <li>
          <a href="tel:18666621235" className="underline underline-offset-2">
            {t("safety.alliance")}
          </a>{" "}
          <span className="text-ink-soft">{t("safety.allianceWho")}</span>
        </li>
        <li>
          <a href="tel:988" className="underline underline-offset-2">
            {t("safety.lifeline")}
          </a>{" "}
          <span className="text-ink-soft">{t("safety.lifelineWho")}</span>
        </li>
      </ul>
    </aside>
  );
}
