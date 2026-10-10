import { useState } from "react";

import { PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";

import { fileReport, REASONS, type Reason, type ReportTarget } from "./report";
import { siteUrl } from "@/lib/site";

type ReasonKey = `report.reason.${Reason}`;

/**
 * S95/S96 — the Report sheet and the "report sent" view (M7.1; spec 13.3). The same sheet on
 * every set, piece, comment, profile, conversation and group. Plain words, a reason, an
 * optional note, and a reference number back with what happens next.
 */
export function ReportButton({
  type,
  id,
  label,
  className,
  onDone,
}: {
  type: ReportTarget;
  id: string;
  /** The words on the button; default "Report". */
  label?: string;
  className?: string;
  /** Called with the reference once the report is in (Block-and-report chains a block after it). */
  onDone?: (ref: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink transition-colors duration-fast hover:bg-surface-2"
        }
      >
        {label ?? t("report.button")}
      </button>
      <ReportSheet
        type={type}
        id={id}
        open={open}
        onOpenChange={setOpen}
        {...(onDone ? { onDone } : {})}
      />
    </>
  );
}

export function ReportSheet({
  type,
  id,
  open,
  onOpenChange,
  onDone,
}: {
  type: ReportTarget;
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (ref: string) => void;
}) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setReason(null);
      setNote("");
      setRef(null);
      setProblem(null);
    }
  }

  async function send() {
    if (!reason || busy) return;
    setBusy(true);
    setProblem(null);
    const r = await fileReport(type, id, reason, note);
    setBusy(false);
    if ("error" in r) {
      setProblem(t(`report.err.${r.error}`));
      return;
    }
    setRef(r.ref);
    onDone?.(r.ref);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={ref ? t("report.sentTitle") : t("report.title")}
      {...(ref ? {} : { description: t(`report.what.${type}`) })}
      action={
        ref ? (
          <PrimaryButton onClick={() => close(false)}>{t("report.done")}</PrimaryButton>
        ) : (
          <PrimaryButton onClick={() => void send()} disabled={!reason || busy}>
            {busy ? t("loading") : t("report.send")}
          </PrimaryButton>
        )
      }
    >
      {ref ? (
        <div className="flex flex-col gap-2">
          <p className="text-base text-ink">
            {t("report.ref")} <span className="font-medium">{ref}</span>
          </p>
          <p className="text-sm text-ink-soft">{t("report.next")}</p>
          <p className="text-sm text-ink-soft">{t("report.where")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <fieldset>
            <legend className="text-sm text-ink-soft">{t("report.why")}</legend>
            <ul className="mt-2 flex flex-col gap-1">
              {REASONS.map((r) => (
                <li key={r}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-base text-ink hover:bg-surface-2">
                    <input
                      type="radio"
                      name="report-reason"
                      value={r}
                      checked={reason === r}
                      onChange={() => setReason(r)}
                      className="size-4 accent-current"
                    />
                    {t(`report.reason.${r}` as ReasonKey)}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <label className="block">
            <span className="text-sm text-ink-soft">{t("report.note")}</span>
            <input
              type="text"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
            />
          </label>
          {type === "conversation" ? (
            <p className="text-sm text-ink-soft">{t("report.dmNote")}</p>
          ) : null}
          {reason === "intimate_image" || reason === "copyright" ? (
            <p className="text-sm text-ink-soft">
              {reason === "intimate_image" ? t("report.intimateHint") : t("report.copyrightHint")}{" "}
              <a
                href={siteUrl(reason === "intimate_image" ? "/takedown" : "/copyright")}
                className="underline underline-offset-2"
              >
                {reason === "intimate_image" ? t("report.intimateLink") : t("report.copyrightLink")}
              </a>
            </p>
          ) : null}
          {problem ? (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
