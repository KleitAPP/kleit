import { useEffect, useState } from "react";

import { PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * "Share my profile" (spec 3.5 #7, #9; CL67): your profile link, a QR code of it for a phone held
 * up across a table, and an invite through the phone's own share sheet - one person at a time,
 * never a list (3.5 #7: no "invite all", no bulk texting). The link opens your profile for anyone
 * signed in and the front door for anyone who is not, which then comes back to you (8.2 #2).
 *
 * The QR is drawn as SVG by a small library loaded only when this sheet opens.
 */
export function ShareProfile({
  username,
  open,
  onOpenChange,
}: {
  username: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const link = `${window.location.origin}/u/${username}`;
  const [qr, setQr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void import("qrcode")
      .then((lib) => lib.toString(link, { type: "svg", margin: 1, width: 192 }))
      .then((svg) => {
        if (!cancelled) setQr(svg);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, link]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setNote(t("shareProfile.copied"));
    } catch {
      setNote(link);
    }
  }

  async function share(invite: boolean) {
    const text = invite ? t("shareProfile.inviteText", { name: `@${username}` }) : `@${username}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: text, text, url: link });
        return;
      } catch {
        /* the person closed the sheet, or the browser has none: fall through to copy */
      }
    }
    await copy();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("shareProfile.title")}
      description={t("shareProfile.what")}
      action={
        <PrimaryButton onClick={() => void share(false)}>{t("shareProfile.share")}</PrimaryButton>
      }
    >
      <div className="flex flex-col items-center gap-3">
        {qr ? (
          <div
            className="rounded-md bg-canvas p-2 [&>svg]:size-48"
            role="img"
            aria-label={t("shareProfile.qrAlt", { name: `@${username}` })}
            // The library's SVG: our own text, drawn as squares; nothing from anyone else.
            dangerouslySetInnerHTML={{ __html: qr }}
          />
        ) : (
          <div className="kl-skeleton size-48 rounded-md bg-surface-2" aria-hidden="true" />
        )}
        <p className="break-all text-center text-sm text-ink-soft">{link}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm font-medium text-ink"
          >
            {t("shareProfile.copy")}
          </button>
          <button
            type="button"
            onClick={() => void share(true)}
            className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm font-medium text-ink"
          >
            {t("shareProfile.invite")}
          </button>
        </div>
        {note ? (
          <p role="status" className="break-all text-center text-sm text-ink">
            {note}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
