import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";

import { rememberInvite } from "@/auth/beta";
import { rememberNext, safeNext } from "@/auth/next";
import { KleitMark } from "@/brand/KleitMark";
import { t } from "@/i18n/en";
import { siteUrl } from "@/lib/site";

/**
 * S4 - Welcome (design pack section 2.1, flow 4.1 step 1).
 * One sentence saying what Kleit is, then the two ways in. The main action sits in the thumb
 * zone because on a 6.1" phone that is the only part a thumb reaches without shifting grip.
 */
export const Route = createFileRoute("/welcome")({
  head: () => ({ meta: [{ title: "Kleit" }, { name: "robots", content: "noindex, nofollow" }] }),
  // ?next= is where a shared page's Sign up wants the person back afterwards (spec 8.2 #2).
  // ?invite= is a beta invite link (S111): the code is kept so nobody types it.
  validateSearch: (
    search: Record<string, unknown>,
  ): { next?: string; back?: string; invite?: string } => ({
    ...(typeof search["next"] === "string" && safeNext(search["next"])
      ? { next: search["next"] }
      : {}),
    ...(typeof search["back"] === "string" ? { back: search["back"] } : {}),
    ...(typeof search["invite"] === "string" ? { invite: search["invite"] } : {}),
  }),
  component: Welcome,
});

function Welcome() {
  const { next, invite } = Route.useSearch();
  useEffect(() => {
    rememberNext(next);
    rememberInvite(invite);
  }, [next, invite]);
  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <KleitMark size={56} className="text-ink" />
        <h1 className="font-display text-3xl text-ink">Kleit</h1>
        <p className="max-w-xs text-lg text-ink-soft">{t("welcome.pitch")}</p>
      </div>
      <div className="mx-auto w-full max-w-sm pb-[max(env(safe-area-inset-bottom),var(--kl-space-6))]">
        <Link
          to="/join"
          className="flex min-h-12 w-full items-center justify-center rounded-pill bg-brand px-5 text-base font-medium text-brand-ink transition-opacity duration-fast hover:opacity-90"
        >
          {t("welcome.start")}
        </Link>
        <Link
          to="/join"
          search={{ mode: "signin" }}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("welcome.signIn")}
        </Link>
        {/* Spec 18.1 #1: a Help link in the same place on every page - here, under the two buttons,
            with the documents the stores and a visitor expect to find without an account. */}
        <p className="mt-4 text-center text-sm text-ink-soft">
          <Link to="/help" className="underline underline-offset-2">
            {t("help.link")}
          </Link>{" "}
          ·{" "}
          <a href={siteUrl("/terms")} className="underline underline-offset-2">
            {t("legal.terms")}
          </a>{" "}
          ·{" "}
          <a href={siteUrl("/privacy")} className="underline underline-offset-2">
            {t("legal.privacy")}
          </a>
        </p>
      </div>
    </main>
  );
}
