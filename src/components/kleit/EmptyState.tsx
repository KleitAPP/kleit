/** Empty is not an error: one friendly line and one button that fixes it (spec 3.4 #3, design pack §7.1 #5). */
export function EmptyState({
  line,
  actionLabel,
  onAction,
}: {
  line: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <p className="max-w-xs text-base text-ink-soft">{line}</p>
      {actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          className="min-h-12 rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
