import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/i18n/en";

/**
 * Filters, tags, vibes. 32 px tall to the eye, 48 dp to the thumb; the selected state
 * shows a tick as well as the fill (never colour alone — design pack §8.2, §8.3 #3).
 */
export function Chip({
  label,
  selected = false,
  onToggle,
  swatch,
}: {
  label: string;
  selected?: boolean;
  onToggle?: () => void;
  /** A colour to show as a dot before the label (the colour chips); the word still carries the meaning. */
  swatch?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className="group inline-flex min-h-12 shrink-0 items-center"
    >
      <span
        className={cn(
          "inline-flex h-8 max-w-56 items-center gap-1 whitespace-nowrap rounded-pill border px-3 text-sm transition-colors duration-fast",
          selected
            ? "border-ink bg-ink text-canvas"
            : "border-line bg-surface text-ink group-hover:bg-surface-2",
        )}
      >
        {selected ? <Check className="size-4" aria-hidden="true" /> : null}
        {swatch ? (
          <span
            aria-hidden="true"
            className="size-3.5 shrink-0 rounded-pill border border-line"
            style={{ backgroundColor: swatch }}
          />
        ) : null}
        <span className="truncate">{label}</span>
        {selected ? <span className="sr-only">, {t("chip.selected")}</span> : null}
      </span>
    </button>
  );
}
