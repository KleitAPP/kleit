import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { APP_VERSION } from "@/app/version";
import { LegalSheet, type LegalDoc } from "@/legal/LegalSheet";
import { t } from "@/i18n/en";
import { siteUrl } from "@/lib/site";

/**
 * S22 — Help and legal (design pack §2.1; spec 13.5, 17.2).
 *
 * The same documents the sign-up checkbox links to (and kleit.app/terms, /privacy, … show), read
 * from the same files, so there is one copy of each and it cannot drift. They open in a sheet here for the same reason they do at
 * sign-up: you should not lose your place to read them.
 *
 * The note about them being drafts is on the screen, not buried, because they say so themselves
 * on their first line and a person deserves to know before they rely on one.
 */
export const Route = createFileRoute("/_app/settings_/legal")({
  head: () => ({
    meta: [{ title: "Help and legal" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: HelpAndLegal,
});

const DOCS: { key: LegalDoc; title: string }[] = [
  { key: "terms", title: t("legal.terms") },
  { key: "privacy", title: t("legal.privacy") },
  { key: "guidelines", title: t("legal.guidelines") },
  { key: "copyright", title: t("legal.copyright") },
  { key: "cookies", title: t("legal.cookies") },
  { key: "accessibility", title: t("legal.accessibility") },
];

function HelpAndLegal() {
  const [open, setOpen] = useState<LegalDoc | null>(null);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("legal.title")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("legal.draftNote")}</p>

      <ul className="mt-6 overflow-hidden rounded-md border border-line bg-surface">
        <li className="border-b border-line">
          <Link
            to="/help"
            className="flex min-h-12 w-full items-center px-4 py-3 text-base text-ink"
          >
            {t("help.centre")}
          </Link>
        </li>
        <li className="border-b border-line">
          <a
            href={siteUrl(`/contact?v=${APP_VERSION}`)}
            className="flex min-h-12 w-full items-center px-4 py-3 text-base text-ink"
          >
            {t("help.contactUs")}
          </a>
        </li>
      </ul>

      <ul className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
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

      {/* Spec 14.1 #5: the "Your Privacy Choices" link, to the section of the policy on the public
          page (the sheet above shows the same text; the page can open at the section). */}
      <a
        href={siteUrl("/privacy#your-choices-and-rights")}
        className="mt-4 flex min-h-12 items-center rounded-md border border-line bg-surface px-4 text-base text-ink"
      >
        {t("legal.privacyChoices")}
      </a>

      <Link
        to="/settings/library"
        className="mt-4 flex min-h-12 items-center rounded-md border border-line bg-surface px-4 text-base text-ink"
      >
        {t("legal.library")}
      </Link>

      <LegalSheet doc={open} onClose={() => setOpen(null)} />
    </div>
  );
}
