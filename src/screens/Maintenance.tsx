import { KleitMark } from "@/brand/KleitMark";
import { PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * S3 - Maintenance (design pack section 2.1). Shown while `maintenance_mode` is on. It says what
 * happened and what to do next, promises nothing about how long, and never says "oops"
 * (design pack section 6). "Try again" re-reads the switch rather than reloading the whole app.
 */
export function Maintenance({ onRetry, retrying = false }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-6 text-center">
      <KleitMark size={48} className="text-ink" />
      <div className="max-w-sm">
        <h1 className="font-display text-2xl text-ink">{t("maintenance.title")}</h1>
        <p className="mt-2 text-base text-ink-soft">{t("maintenance.body")}</p>
      </div>
      <div className="w-full max-w-sm">
        <PrimaryButton onClick={onRetry} disabled={retrying}>
          {retrying ? t("loading") : t("maintenance.action")}
        </PrimaryButton>
      </div>
    </main>
  );
}
