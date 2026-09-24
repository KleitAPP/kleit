import { KleitMark } from "@/brand/KleitMark";
import { PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * S2 - Forced update (design pack section 2.1). Blocking: no way past it and no tab bar,
 * because the bundle underneath is older than the database will talk to. On the web, reloading
 * is how you get the newest bundle; the app-store link arrives with the phone apps at M8.
 */
export function ForcedUpdate({ running, minimum }: { running: string; minimum: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-6 text-center">
      <KleitMark size={48} className="text-ink" />
      <div className="max-w-sm">
        <h1 className="font-display text-2xl text-ink">{t("update.title")}</h1>
        <p className="mt-2 text-base text-ink-soft">{t("update.body")}</p>
      </div>
      <div className="w-full max-w-sm">
        <PrimaryButton onClick={() => window.location.reload()}>{t("update.action")}</PrimaryButton>
      </div>
      <p className="text-sm text-ink-soft">{t("update.versions", { running, minimum })}</p>
    </main>
  );
}
