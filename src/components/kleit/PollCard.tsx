import { t } from "@/i18n/en";

export type PollOption = { id: string; label: string; votes: number };

/**
 * "Which one?" — labelled options, one vote per tap, then result bars with the
 * percentage written as text (never colour alone). The privacy line shows BEFORE the
 * first vote (gap G11); "One vote per device" shows under the results (gap G13).
 * Totals only — never voter names (technical pack `poll_totals`).
 */
export function PollCard({
  question,
  options,
  votedId,
  onVote,
  privacyHref,
}: {
  question: string;
  options: PollOption[];
  votedId?: string;
  onVote?: (id: string) => void;
  privacyHref?: string;
}) {
  const total = options.reduce((sum, o) => sum + o.votes, 0);
  const showResults = votedId !== undefined;
  return (
    <section className="rounded-md bg-surface p-4 shadow-card" aria-label={question}>
      <h3 className="font-display text-xl text-ink">{question}</h3>
      {!showResults ? (
        <>
          <div className="mt-3 grid gap-2">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onVote?.(o.id)}
                aria-label={t("poll.vote", { label: o.label })}
                className="min-h-12 rounded-sm border border-line bg-canvas px-4 text-left text-base text-ink transition-colors duration-fast hover:bg-surface-2"
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            {privacyHref ? (
              <a href={privacyHref} className="underline underline-offset-2">
                {t("poll.privacy")}
              </a>
            ) : (
              t("poll.privacy")
            )}
          </p>
        </>
      ) : (
        <>
          <ul className="mt-3 grid gap-3">
            {options.map((o) => {
              const pct = total === 0 ? 0 : Math.round((o.votes / total) * 100);
              const mine = o.id === votedId;
              return (
                <li key={o.id}>
                  <div className="flex justify-between text-base text-ink">
                    <span className={mine ? "font-semibold" : undefined}>
                      {o.label}
                      {mine ? " ✓" : ""}
                    </span>
                    <span className="tabular-nums">{pct}%</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-pill bg-surface-2" aria-hidden="true">
                    <div className="h-full rounded-pill bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-ink-soft">
            {t("poll.votes", { count: total })} · {t("poll.oneVote")}
          </p>
        </>
      )}
    </section>
  );
}
