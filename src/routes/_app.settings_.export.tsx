import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";

/**
 * S25 — Download my data (spec 3.7; guardrail 10; privacy policy §5 #1).
 *
 * One button. The server reads every row as you (the same rules as every screen) and writes a
 * ZIP into your own folder; the link works for seven days and nobody else can open it. One new
 * file a day - asking again inside the day hands back the same link, so a tap-tap-tap cannot
 * fill the bucket.
 */
export const Route = createFileRoute("/_app/settings_/export")({
  head: () => ({
    meta: [{ title: "Download my data" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: ExportData,
});

type Ready = {
  url: string;
  madeAt: string;
  reused: boolean;
  photos?: number;
  photosSkipped?: number;
};

function ExportData() {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [failed, setFailed] = useState(false);

  async function request() {
    setBusy(true);
    setFailed(false);
    try {
      const { data, error } = await supabase.functions.invoke<Ready>("export-data", { body: {} });
      if (error || !data?.url) setFailed(true);
      else setReady(data);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("exportData.title")}</h1>
      <p className="mt-2 text-base text-ink-soft">{t("exportData.why")}</p>
      <ul className="mt-4 list-disc pl-5 text-base text-ink">
        <li>{t("exportData.whatSets")}</li>
        <li>{t("exportData.whatPhotos")}</li>
        <li>{t("exportData.whatSocial")}</li>
        <li>{t("exportData.whatMessages")}</li>
      </ul>
      <p className="mt-3 text-sm text-ink-soft">{t("exportData.notVotes")}</p>

      <div className="mt-8">
        {ready ? (
          <div className="rounded-md border border-line bg-surface p-4">
            <p className="text-base text-ink">
              {ready.reused ? t("exportData.readyAgain") : t("exportData.ready")}
            </p>
            <a
              href={ready.url}
              download
              rel="noopener"
              className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill bg-brand px-5 text-base font-medium text-brand-ink"
            >
              {t("exportData.download")}
            </a>
            <p className="mt-2 text-sm text-ink-soft">{t("exportData.expires")}</p>
            {ready.photosSkipped ? (
              <p className="mt-1 text-sm text-ink-soft">
                {t("exportData.skipped", { count: ready.photosSkipped })}
              </p>
            ) : null}
          </div>
        ) : (
          <PrimaryButton onClick={() => void request()} disabled={busy}>
            {busy ? t("exportData.making") : t("exportData.request")}
          </PrimaryButton>
        )}
        {failed ? (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {t("exportData.failed")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
