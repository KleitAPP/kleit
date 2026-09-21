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
}: {
  label: string;
  selected?: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className="group inline-flex min-h-12 items-center"
    >
      <span
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-pill border px-3 text-sm transition-colors duration-fast",
          selected ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink group-hover:bg-surface-2",
        )}
      >
        {selected ? <Check className="size-4" aria-hidden="true" /> : null}
        {label}
        {selected ? <span className="sr-only">, {t("chip.selected")}</span> : null}
      </span>
    </button>
  );
}
