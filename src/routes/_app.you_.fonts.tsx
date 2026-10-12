import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import {
  FONT_MAX_BYTES,
  myFonts,
  removeFont,
  uploadFont,
  type MyFont,
  type UploadProblem,
} from "@/fonts/myFonts";
import { t } from "@/i18n/en";

/** S63 — My fonts (spec 6.2 #1): your own font files, only yours, never served to anyone else. */
export const Route = createFileRoute("/_app/you_/fonts")({
  head: () => ({ meta: [{ title: "My fonts" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: MyFontsScreen,
});

const WORDS: Record<UploadProblem, string> = {
  "signed-out": t("photo.signedOut"),
  "too-big": t("fonts.tooBig"),
  "not-a-font": t("fonts.notAFont"),
  "upload-failed": t("photo.uploadFailed"),
};

function MyFontsScreen() {
  const [fonts, setFonts] = useState<MyFont[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<MyFont | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void myFonts().then((list) => {
      if (!cancelled) setFonts(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function add(file: File) {
    setBusy(true);
    setProblem(null);
    const result = await uploadFont(file);
    setBusy(false);
    if (!result.ok) {
      setProblem(WORDS[result.problem]);
      return;
    }
    setFonts([result.font, ...(fonts ?? [])]);
  }

  async function remove(font: MyFont) {
    setConfirm(null);
    const ok = await removeFont(font.path);
    if (ok) setFonts((fonts ?? []).filter((f) => f.path !== font.path));
    else setProblem(t("fonts.removeFailed"));
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("fonts.title")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("fonts.what")}</p>
      <p className="mt-1 text-sm text-ink-soft">{t("fonts.rights")}</p>

      <input
        ref={picker}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
        aria-label={t("fonts.title")}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void add(file);
          e.target.value = "";
        }}
      />
      <div className="mt-4">
        <PrimaryButton disabled={busy} onClick={() => picker.current?.click()}>
          {busy ? t("loading") : t("fonts.add")}
        </PrimaryButton>
        <p className="mt-1 text-xs text-ink-soft">
          {t("fonts.limits", { mb: Math.round(FONT_MAX_BYTES / 1048576) })}
        </p>
      </div>

      {problem ? (
        <p role="alert" className="mt-3 text-base text-ink">
          {problem}
        </p>
      ) : null}

      {fonts === null ? (
        <div className="mt-6" role="status" aria-label={t("loading")}>
          <div className="kl-skeleton h-12 w-full rounded-md bg-surface-2" />
        </div>
      ) : fonts.length === 0 ? (
        <EmptyState line={t("fonts.empty")} />
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {fonts.map((f) => (
            <li key={f.path} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-base text-ink">{f.name}</p>
                <p className="text-sm text-ink-soft">{Math.round(f.bytes / 1024)} KB</p>
              </div>
              <button
                type="button"
                onClick={() => setConfirm(f)}
                className="shrink-0 rounded-pill border border-line bg-surface px-4 py-2 text-sm font-medium text-danger"
              >
                {t("fonts.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t("fonts.remove")}
        description={t("fonts.removeWarning")}
        action={
          <PrimaryButton onClick={() => confirm && void remove(confirm)}>
            {t("fonts.removeConfirm")}
          </PrimaryButton>
        }
      />
    </div>
  );
}
