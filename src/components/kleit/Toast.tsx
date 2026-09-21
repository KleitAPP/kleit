import { useEffect } from "react";
import { cn } from "@/lib/utils";

/**
 * One line at the bottom, gone in 3 seconds, never covering the main action
 * (design pack §7.1 #10). Announced politely to screen readers.
 */
export function Toast({
  message,
  tone = "neutral",
  onDismiss,
  durationMs = 3000,
}: {
  message: string;
  tone?: "neutral" | "positive" | "warning" | "danger";
  onDismiss?: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    if (!onDismiss) return undefined;
    const id = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(id);
  }, [onDismiss, durationMs]);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-4 w-fit max-w-full rounded-pill bg-ink px-4 py-3 text-sm text-canvas shadow-card animate-in fade-in-0 duration-slow",
        tone === "positive" && "border-l-4 border-positive",
        tone === "warning" && "border-l-4 border-warning",
        tone === "danger" && "border-l-4 border-danger",
      )}
    >
      {message}
    </div>
  );
}
