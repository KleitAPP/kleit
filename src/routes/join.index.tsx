import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { KleitMark } from "@/brand/KleitMark";
import { PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import { LegalSheet, type LegalDoc } from "@/legal/LegalSheet";
import { usingTestBotCheck } from "@/auth/turnstile";
import { forgetAgreement, rememberAgreement } from "@/auth/agreement";

/**
 * S5 - Sign-up sheet (design pack W1, flow 4.1 step 2).
 *
 * The one rule this screen exists to enforce: nothing below the checkbox works until the checkbox
 * is ticked. That is a legal wall, one of only three things in Kleit allowed to block a person
 * (design pack section 7.1 #7) - the other two are the forced-update screen and a screening result.
 *
 * Signing in is not signing up, so someone coming back skips the checkbox: they agreed already,
 * and asking again would be theatre.
 *
 * This is `join.index.tsx`, not `join.tsx`, on purpose: a `join.tsx` would become a layout that
 * wraps /join/email and /join/code, and the sheet would still be on screen underneath them.
 */
export const Route = createFileRoute("/join/")({
  validateSearch: (search: Record<string, unknown>): { mode?: "signin" } =>
    search["mode"] === "signin" ? { mode: "signin" } : {},
  head: () => ({ meta: [{ title: "Join Kleit" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Join,
});

function Join() {
  const { mode } = Route.useSearch();
  const navigate = useNavigate();
  const signingIn = mode === "signin";
  const [agreed, setAgreed] = useState(false);
  const [openDoc, setOpenDoc] = useState<LegalDoc | null>(null);

  const canContinue = signingIn || agreed;

  return (
    <main className="flex min-h-dvh flex-col items-center bg-canvas px-6 pt-12">
      <div className="w-full max-w-sm">
        <KleitMark size={40} className="text-ink" />
        <h1 className="mt-5 font-display text-2xl text-ink">
          {signingIn ? t("welcome.signIn") : t("join.title")}
        </h1>
        <p className="mt-2 text-base text-ink-soft">{t("welcome.pitch")}</p>

        {signingIn ? null : (
          <label className="mt-8 flex cursor-pointer items-start gap-3 py-2">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => {
                setAgreed(e.target.checked);
                // Carried with the person, because the account is created two screens later.
                if (e.target.checked) rememberAgreement();
                else forgetAgreement();
              }}
              className="mt-1 size-5 shrink-0 accent-brand"
            />
            <span className="text-base text-ink">
              I'm 18 or older and I agree to the{" "}
              <LegalLink onOpen={() => setOpenDoc("terms")}>{t("join.terms")}</LegalLink> and{" "}
              <LegalLink onOpen={() => setOpenDoc("guidelines")}>{t("join.guidelines")}</LegalLink>
            </span>
          </label>
        )}

        <div className="mt-6">
          <PrimaryButton
            disabled={!canContinue}
            onClick={() => void navigate({ to: "/join/email", search: signingIn ? { mode: "signin" } : {} })}
          >
            {t("join.withEmail")}
          </PrimaryButton>
        </div>

        <p className="mt-4 text-sm text-ink-soft">
          {t("join.usOnly")}{" "}
          <LegalLink onOpen={() => setOpenDoc("privacy")}>{t("join.privacy")}</LegalLink>
        </p>

        {/* The bot check still runs on Cloudflare's test key. That is a note for us, not for the
            person signing up, so it goes to the console and never on screen. */}
        {usingTestBotCheck ? <TestKeyNote /> : null}
      </div>

      <LegalSheet doc={openDoc} onClose={() => setOpenDoc(null)} />
    </main>
  );
}

/** Says once, in the console, that the bot check is still on the published test key. */
function TestKeyNote() {
  useEffect(() => {
    console.warn("[Kleit] Bot check is using Cloudflare's test key. Real keys before the beta.");
  }, []);
  return null;
}

/** A link that opens a document over this screen instead of navigating away from it. */
function LegalLink({ children, onOpen }: { children: React.ReactNode; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onOpen();
      }}
      className="underline underline-offset-2"
    >
      {children}
    </button>
  );
}
