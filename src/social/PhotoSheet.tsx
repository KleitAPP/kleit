import { useRef, useState } from "react";

import { Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";

import { removeProfilePhoto, uploadProfilePhoto, type PhotoState } from "./avatar";

/**
 * The profile-photo sheet on You (S12; spec 3.5): choose a photo from the phone, or take the
 * current one off. The photo is screened like every other (spec 13.1) and shows to others only
 * once it clears; the sheet says so plainly.
 */
export function PhotoSheet({
  hasPhoto,
  open,
  onOpenChange,
  onChanged,
}: {
  hasPhoto: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (itemId: string | null, state: PhotoState | null) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function chosen(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setProblem(null);
    const r = await uploadProfilePhoto(file);
    setBusy(false);
    if (!r.ok) {
      setProblem(t(`avatar.problem.${r.problem}`));
      return;
    }
    onChanged(r.itemId, r.state);
    onOpenChange(false);
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    const ok = await removeProfilePhoto();
    setBusy(false);
    if (!ok) {
      setProblem(t("avatar.problem.upload-failed"));
      return;
    }
    onChanged(null, null);
    onOpenChange(false);
  }

  const row = "flex min-h-12 w-full items-center text-left text-base text-ink disabled:opacity-50";
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) setProblem(null);
        onOpenChange(o);
      }}
      title={t("avatar.title")}
      description={t("avatar.why")}
    >
      <input
        ref={picker}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void chosen(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <ul className="flex flex-col divide-y divide-line">
        <li>
          <button
            type="button"
            className={row}
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            {busy ? t("avatar.checking") : hasPhoto ? t("avatar.change") : t("avatar.choose")}
          </button>
        </li>
        {hasPhoto ? (
          <li>
            <button type="button" className={row} disabled={busy} onClick={() => void remove()}>
              {t("avatar.remove")}
            </button>
          </li>
        ) : null}
      </ul>
      {problem ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {problem}
        </p>
      ) : null}
    </Sheet>
  );
}
