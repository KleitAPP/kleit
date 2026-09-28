import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { addOwnPhoto, type AddProblem } from "@/photos/addOwnPhoto";
import { PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * S36 and S37 in one screen - add a photo of your own piece, and watch it be checked.
 *
 * The design pack has these as two screens, and on a phone they are one moment: you choose a
 * photo and then you wait a few seconds. Splitting them would mean a screen whose only content is
 * a spinner, and a back button that goes to a picker you have already used.
 *
 * Two things this screen owes the person, and both are unusual enough to be worth saying:
 *
 *   - **It tells them the location is removed, before they choose.** Not in a settings page, not
 *     in the Terms - on the screen where the decision is made. A promise nobody is told about is
 *     not a feature, it is a secret.
 *   - **It never shows the photo as added until it has actually passed.** "Checking" is a real
 *     state with its own words, because an item that is still being screened is invisible to
 *     everyone including its owner's followers, and pretending otherwise would have people
 *     wondering why nobody can see their jumper.
 */
export const Route = createFileRoute("/_app/add/photo")({
  head: () => ({ meta: [{ title: "Add a photo" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: AddPhoto,
});

type Stage =
  | { at: "choosing" }
  | { at: "chosen"; file: File; preview: string }
  | { at: "working" }
  | { at: "done"; state: "clean" | "review" | "blocked" | "checking" }
  | { at: "failed"; problem: AddProblem };

const PROBLEM_WORDS: Record<AddProblem, string> = {
  "too-big": t("photo.tooBig"),
  "not-an-image": t("photo.notAnImage"),
  unreadable: t("photo.unreadable"),
  "upload-failed": t("photo.uploadFailed"),
  "save-failed": t("photo.saveFailed"),
  "signed-out": t("photo.signedOut"),
  offline: t("join.offline"),
};

function AddPhoto() {
  const navigate = useNavigate();
  const picker = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ at: "choosing" });

  // A preview is an object URL, which the browser holds until it is told not to.
  useEffect(() => {
    if (stage.at !== "chosen") return;
    const url = stage.preview;
    return () => URL.revokeObjectURL(url);
  }, [stage]);

  async function add() {
    if (stage.at !== "chosen") return;
    const file = stage.file;
    setStage({ at: "working" });
    const result = await addOwnPhoto(file);
    setStage(result.ok ? { at: "done", state: result.state } : { at: "failed", problem: result.problem });
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("photo.title")}</h1>
      <p className="mt-3 text-base text-ink-soft">{t("photo.what")}</p>
      {/* Said before the choice, not after it. */}
      <p className="mt-3 text-base text-ink-soft">{t("photo.privacy")}</p>

      <input
        ref={picker}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
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

      {stage.at === "working" ? (
        <div className="mt-8" role="status">
          <p className="text-base text-ink">{t("photo.checking")}</p>
          <p className="mt-2 text-sm text-ink-soft">{t("photo.checkingWhy")}</p>
        </div>
      ) : null}

      {stage.at === "done" ? (
        <p role="status" className="mt-8 text-base text-ink">
          {stage.state === "clean" ? t("photo.clean")
            : stage.state === "review" ? t("photo.review")
            : stage.state === "blocked" ? t("photo.blocked")
            : t("photo.stillChecking")}
        </p>
      ) : null}

      {stage.at === "failed" ? (
        <p role="alert" className="mt-8 text-base text-ink">
          {PROBLEM_WORDS[stage.problem]}
        </p>
      ) : null}

      <div className="mt-8">
        {stage.at === "chosen" ? (
          <PrimaryButton onClick={() => void add()}>{t("photo.add")}</PrimaryButton>
        ) : stage.at === "working" ? (
          <PrimaryButton disabled>{t("loading")}</PrimaryButton>
        ) : stage.at === "done" ? (
          <PrimaryButton onClick={() => void navigate({ to: "/you" })}>Done</PrimaryButton>
        ) : (
          <PrimaryButton onClick={() => picker.current?.click()}>{t("photo.choose")}</PrimaryButton>
        )}
      </div>

      {stage.at === "chosen" || stage.at === "failed" ? (
        <button
          type="button"
          onClick={() => {
            setStage({ at: "choosing" });
            picker.current?.click();
          }}
          className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("photo.change")}
        </button>
      ) : null}
    </div>
  );
}
