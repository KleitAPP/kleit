import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { GoogleButton } from "@/auth/GoogleButton";
import { whereDoIBelong } from "@/auth/session";
import { signOutEverywhereOnThisPhone } from "@/auth/signOut";
import { KleitMark } from "@/brand/KleitMark";
import { t } from "@/i18n/en";

/**
 * Can't sign in? (spec 3.6 #2; CL66). Recovery, in the three cases there are:
 *
 *   1. You still have your email: there is nothing to recover - the code goes there.
 *   2. You linked Google: signing in with it IS the identity check the spec asks for. Google
 *      sends the person back here, and the front door's own question (`whereDoIBelong`) tells a
 *      real account from a Google account that is linked to nothing - which Supabase would have
 *      just made an account for. That new, empty account is signed out again on the spot and the
 *      screen says so, because a recovery screen must not quietly turn into a sign-up.
 *   3. Neither: a human, through the contact form's "I can't sign in" topic, from the email on
 *      the account. The rule is written on the screen as it is kept: never by username alone,
 *      and an account nobody can prove is theirs is not handed over - it can be deleted instead.
 */
export const Route = createFileRoute("/recover")({
  head: () => ({
    meta: [{ title: "Can't sign in?" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  validateSearch: (search: Record<string, unknown>): { checked?: boolean } =>
    search["checked"] === true || search["checked"] === "1" ? { checked: true } : {},
  component: Recover,
});

type Check = "idle" | "looking" | "in" | "unlinked";

function Recover() {
  const { checked } = Route.useSearch();
  const [check, setCheck] = useState<Check>(checked ? "looking" : "idle");

  // Back from Google (?checked=1): a real account is in; a Google account linked to nothing has
  // just been made one by Supabase, and that one is closed again here.
  useEffect(() => {
    if (!checked) return;
    let cancelled = false;
    void (async () => {
      const where = await whereDoIBelong();
      if (cancelled) return;
      if (where === "ready" || where === "deleting" || where === "suspended") {
        setCheck("in");
        return;
      }
      // Nobody signed in: Google was cancelled or refused, and there is nothing to say.
      if (where === "signed-out") {
        setCheck("idle");
        return;
      }
      await signOutEverywhereOnThisPhone();
      if (!cancelled) setCheck("unlinked");
    })();
    return () => {
      cancelled = true;
    };
  }, [checked]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-canvas px-6 pt-8 pb-[max(env(safe-area-inset-bottom),var(--kl-space-6))]">
      <Link to="/welcome" className="inline-flex items-center gap-2 text-ink" aria-label="Kleit">
        <KleitMark size={28} className="text-ink" />
      </Link>
      <h1 className="mt-6 font-display text-2xl text-ink">{t("recover.title")}</h1>
      <p className="mt-2 text-base text-ink-soft">{t("recover.why")}</p>

      {check === "looking" ? (
        <p role="status" className="mt-6 text-base text-ink">
          {t("recover.looking")}
        </p>
      ) : check === "in" ? (
        <section role="status" className="mt-6 rounded-md border border-line bg-surface p-4">
          <h2 className="text-base font-medium text-ink">{t("recover.inTitle")}</h2>
          <p className="mt-1 text-base text-ink-soft">{t("recover.inWhy")}</p>
          <Link
            to="/settings/account"
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill bg-brand px-5 text-base font-medium text-brand-ink"
          >
            {t("recover.inGo")}
          </Link>
        </section>
      ) : check === "unlinked" ? (
        <section role="alert" className="mt-6 rounded-md border border-line bg-surface p-4">
          <h2 className="text-base font-medium text-ink">{t("recover.unlinkedTitle")}</h2>
          <p className="mt-1 text-base text-ink-soft">{t("recover.unlinkedWhy")}</p>
        </section>
      ) : null}

      <ol className="mt-6 flex flex-col gap-4">
        <li className="rounded-md border border-line bg-surface p-4">
          <h2 className="text-base font-medium text-ink">{t("recover.emailTitle")}</h2>
          <p className="mt-1 text-base text-ink-soft">{t("recover.emailWhy")}</p>
          <Link
            to="/join"
            search={{ mode: "signin" }}
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            {t("recover.emailGo")}
          </Link>
        </li>
        <li className="rounded-md border border-line bg-surface p-4">
          <h2 className="text-base font-medium text-ink">{t("recover.googleTitle")}</h2>
          <p className="mt-1 text-base text-ink-soft">{t("recover.googleWhy")}</p>
          <div className="mt-3">
            <GoogleButton backTo="/recover?checked=1" label={t("recover.googleGo")} />
          </div>
        </li>
        <li className="rounded-md border border-line bg-surface p-4">
          <h2 className="text-base font-medium text-ink">{t("recover.humanTitle")}</h2>
          <p className="mt-1 text-base text-ink-soft">{t("recover.humanWhy")}</p>
          <p className="mt-2 text-sm text-ink-soft">{t("recover.humanRule")}</p>
          <a
            href="/contact?topic=recovery"
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            {t("recover.humanGo")}
          </a>
          <p className="mt-2 text-sm text-ink-soft">
            {t("recover.deleteInstead")}{" "}
            <a href="/delete-account" className="underline">
              {t("recover.deleteGo")}
            </a>
          </p>
        </li>
      </ol>
    </main>
  );
}
