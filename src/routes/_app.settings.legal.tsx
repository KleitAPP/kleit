import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { LegalSheet, type LegalDoc } from "@/legal/LegalSheet";
import { t } from "@/i18n/en";

/**
 * S22 — Help and legal (design pack §2.1; spec 13.5, 17.2).
 *
 * The same four documents the sign-up checkbox links to, read from the same files, so there is
 * one copy of each and it cannot drift. They open in a sheet here for the same reason they do at
 * sign-up: you should not lose your place to read them.
 *
 * The note about them being drafts is on the screen, not buried, because they say so themselves
 * on their first line and a person deserves to know before they rely on one.
 */
export const Route = createFileRoute("/_app/settings/legal")({
  head: () => ({ meta: [{ title: "Help and legal" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: HelpAndLegal,
});

const DOCS: { key: LegalDoc; title: string }[] = [
  { key: "terms", title: t("legal.terms") },
  { key: "privacy", title: t("legal.privacy") },
  { key: "guidelines", title: t("legal.guidelines") },
  { key: "copyright", title: t("legal.copyright") },
];

function HelpAndLegal() {
  const [open, setOpen] = useState<LegalDoc | null>(null);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("legal.title")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("legal.draftNote")}</p>

      <ul className="mt-6 overflow-hidden rounded-md border border-line bg-surface">
        {DOCS.map(({ key, title }) => (
          <li key={key} className="border-b border-line last:border-b-0">
            <button
              type="button"
              onClick={() => setOpen(key)}
              className="flex min-h-12 w-full items-center px-4 py-3 text-left text-base text-ink"
            >
              {title}
            </button>
          </li>
        ))}
      </ul>

      <LegalSheet doc={open} onClose={() => setOpen(null)} />
    </div>
  );
}
