import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { addOwnPhoto, type AddProblem } from "@/photos/addOwnPhoto";
import { CutoutEditor } from "@/photos/CutoutEditor";
import { finishCutout, type Cutout } from "@/photos/cutout";
import { prepareCanvas, type PrepareProblem } from "@/photos/prepare";
import { PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import { nativeMask } from "@/native/cutout";
import { usePermissionPrimer } from "@/native/primers";

/**
 * S34/S36 (choose), S35 (cut it out) and S37 (checking) as one flow - add a photo of your own
 * piece, optionally cut it out of its background, and watch it be checked.
 *
 * The design pack has these as separate screens, and on a phone they are one moment: you choose
 * a photo, maybe rub the background out, and then you wait a few seconds. Splitting them would
 * mean a screen whose only content is a spinner, and a back button that goes to a picker you have
 * already used.
 *
 * Three things this screen owes the person, and all are unusual enough to be worth saying:
 *
 *   - **It tells them the location is removed, before they choose.** Not in a settings page, not
 *     in the Terms - on the screen where the decision is made. A promise nobody is told about is
 *     not a feature, it is a secret.
 *   - **Cutting out is offered, never forced** (spec 4.4 #6). On the web there is no automatic
 *     background removal, so it is an eraser and a brush; on the phone (M8) the system's cutout
 *     goes first and the same brushes fix it.
 *   - **It never shows the photo as added until it has actually passed.** "Checking" is a real
 *     state with its own words, because an item that is still being screened is invisible to
 *     everyone including its owner's followers, and pretending otherwise would have people
 *     wondering why nobody can see their jumper.
 *
 * Many at once (spec 4.5 #2; S36 "one or many"): choosing several photos adds them one after
 * another with their backgrounds kept, a running count on screen, and a plain tally at the end.
 * Each one goes through exactly the same preparation and screening as a single photo.
 */
export const Route = createFileRoute("/_app/add/photo")({
  head: () => ({
    meta: [{ title: "Add a photo" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AddPhoto,
});

type Stage =
  | { at: "choosing" }
  | { at: "chosen"; file: File; preview: string }
  | { at: "editing"; source: HTMLCanvasElement; base: HTMLCanvasElement | null }
  | { at: "working" }
  | { at: "done"; state: "clean" | "review" | "blocked" | "checking" }
  | { at: "many"; total: number; done: number; added: number; failed: number }
  | { at: "failed"; problem: AddProblem };

const PROBLEM_WORDS: Record<AddProblem, string> = {
  "too-big": t("photo.tooBig"),
  "not-an-image": t("photo.notAnImage"),
  animated: t("photo.animated"),
  unreadable: t("photo.unreadable"),
  "upload-failed": t("photo.uploadFailed"),
  "save-failed": t("photo.saveFailed"),
  "signed-out": t("photo.signedOut"),
  offline: t("join.offline"),
};

function AddPhoto() {
  const navigate = useNavigate();
  const picker = useRef<HTMLInputElement>(null);
  const photos = usePermissionPrimer("photos", () => picker.current?.click());
  const [stage, setStage] = useState<Stage>({ at: "choosing" });
  // Kept across the editor so "keep background" can still add the original file.
  const chosen = useRef<File | null>(null);

  // A preview is an object URL, which the browser holds until it is told not to.
  useEffect(() => {
    if (stage.at !== "chosen") return;
    const url = stage.preview;
    return () => URL.revokeObjectURL(url);
  }, [stage]);

  async function add(photo: Parameters<typeof addOwnPhoto>[0]) {
    setStage({ at: "working" });
    const result = await addOwnPhoto(photo);
    setStage(
      result.ok ? { at: "done", state: result.state } : { at: "failed", problem: result.problem },
    );
  }

  async function openEditor() {
    if (stage.at !== "chosen") return;
    const prepared = await prepareCanvas(stage.file);
    if (!prepared.ok) {
      setStage({ at: "failed", problem: prepared.problem satisfies PrepareProblem });
      return;
    }
    // On the phone the system's cutout goes first (M8.3) and the brushes fix it; on the web, or
    // when the phone cannot, this is null and the eraser starts from "keep all" as before.
    setStage({ at: "working" });
    const base = await nativeMask(prepared.canvas);
    setStage({ at: "editing", source: prepared.canvas, base });
  }

  /** Several photos: one after another, backgrounds kept, a tally at the end. */
  async function addMany(files: File[]) {
    let added = 0;
    let failed = 0;
    setStage({ at: "many", total: files.length, done: 0, added, failed });
    for (const [index, file] of files.entries()) {
      const result = await addOwnPhoto(file);
      if (result.ok) added++;
      else failed++;
      setStage({ at: "many", total: files.length, done: index + 1, added, failed });
    }
  }

  async function finishEditing(cutout: Cutout) {
    setStage({ at: "working" });
    try {
      const finished = await finishCutout(cutout);
      await add({
        blob: finished.blob,
        type: finished.type,
        width: finished.width,
        height: finished.height,
      });
    } catch {
      setStage({ at: "failed", problem: "unreadable" });
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("photo.title")}</h1>
      <p className="mt-3 text-base text-ink-soft">{t("photo.what")}</p>
      {/* Said before the choice, not after it. */}
      <p className="mt-3 text-base text-ink-soft">{t("photo.privacy")}</p>

      {photos.sheet}
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        aria-label={t("a11y.photoFile")}
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          const file = files[0];
          if (!file) return;
          if (files.length > 1) {
            void addMany(files);
            return;
          }
          chosen.current = file;
          setStage({ at: "chosen", file, preview: URL.createObjectURL(file) });
        }}
      />

      {stage.at === "chosen" ? (
        <img
          src={stage.preview}
          alt=""
          className="mt-6 max-h-80 w-full rounded-md border border-line object-contain"
        />
      ) : null}

      {stage.at === "editing" ? (
        <CutoutEditor
          source={stage.source}
          base={stage.base}
          onDone={(cutout) => void finishEditing(cutout)}
          onKeepBackground={() => {
            const file = chosen.current;
            if (file) void add(file);
          }}
        />
      ) : null}

      {stage.at === "working" ? (
        <div className="mt-8" role="status">
          <p className="text-base text-ink">{t("photo.checking")}</p>
          <p className="mt-2 text-sm text-ink-soft">{t("photo.checkingWhy")}</p>
        </div>
      ) : null}

      {stage.at === "done" ? (
        <p role="status" className="mt-8 text-base text-ink">
          {stage.state === "clean"
            ? t("photo.clean")
            : stage.state === "review"
              ? t("photo.review")
              : stage.state === "blocked"
                ? t("photo.blocked")
                : t("photo.stillChecking")}
        </p>
      ) : null}

      {stage.at === "many" ? (
        <div className="mt-8" role="status">
          <p className="text-base text-ink">
            {stage.done < stage.total
              ? t("photo.manyProgress", { done: stage.done, total: stage.total })
              : t("photo.manyDone", { count: stage.added })}
          </p>
          {stage.done < stage.total ? (
            <p className="mt-2 text-sm text-ink-soft">{t("photo.checkingWhy")}</p>
          ) : stage.failed > 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              {t("photo.manyFailed", { count: stage.failed })}
            </p>
          ) : null}
        </div>
      ) : null}

      {stage.at === "failed" ? (
        <p role="alert" className="mt-8 text-base text-ink">
          {PROBLEM_WORDS[stage.problem]}
        </p>
      ) : null}

      <div className="mt-8">
        {stage.at === "chosen" ? (
          <>
            <PrimaryButton onClick={() => void add(stage.file)}>{t("photo.add")}</PrimaryButton>
            <button
              type="button"
              onClick={() => void openEditor()}
              className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
            >
              {t("photo.cutOut")}
            </button>
          </>
        ) : stage.at === "working" || (stage.at === "many" && stage.done < stage.total) ? (
          <PrimaryButton disabled>{t("loading")}</PrimaryButton>
        ) : stage.at === "done" || stage.at === "many" ? (
          <PrimaryButton onClick={() => void navigate({ to: "/you/closet" })}>
            {t("photo.seeCloset")}
          </PrimaryButton>
        ) : stage.at === "editing" ? null : (
          <PrimaryButton onClick={photos.ask}>{t("photo.choose")}</PrimaryButton>
        )}
      </div>

      {stage.at === "chosen" || stage.at === "failed" || stage.at === "editing" ? (
        <button
          type="button"
          onClick={() => {
            setStage({ at: "choosing" });
            photos.ask();
          }}
          className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("photo.change")}
        </button>
      ) : null}
    </div>
  );
}
