import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { signOutEverywhereOnThisPhone } from "@/auth/signOut";
import { PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * S23 — Take a break (design pack §2.1; spec 3.6 #8; gap G14).
 *
 * Deactivating writes one timestamp, and the database does the rest: the `profiles` read policy
 * already hides a row with `deactivated_at` set from everyone except its owner, so the account
 * vanishes for other people the moment this saves — not because every screen remembers to check.
 *
 * It is deliberately on its own screen, away from Delete, and every line here says the same
 * thing in a different way: nothing is being destroyed. G14 exists because these two sat
 * together looking alike, and only one of them can be undone.
 *
 * The confirm step is not decoration. Hiding also signs the person out of every device, so a
 * mis-tap on a phone in a pocket would lock them out of the app until an email arrives - and on
 * the test deployment, where sign-in email does not deliver, that is unrecoverable. So the button
 * asks first, and the screen now says out loud that it signs you out everywhere.
 */
export const Route = createFileRoute("/_app/settings_/break")({
  head: () => ({
    meta: [{ title: "Take a break" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: TakeABreak,
});

function TakeABreak() {
  const navigate = useNavigate();
  const [hiding, setHiding] = useState(false);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function hide() {
    setHiding(true);
    setFailed(false);
    const { data } = await supabase.auth.getUser();
    const me = data.user?.id;
    if (!me) {
      // No session to hide behind. Not an error worth explaining - the guard will bounce them.
      setHiding(false);
      setAsking(false);
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ deactivated_at: new Date().toISOString() })
      .eq("user_id", me);
    if (error) {
      // Say so. A silent no-op here reads as "it worked", and the person walks away believing
      // they are hidden when they are not.
      setHiding(false);
      setAsking(false);
      setFailed(true);
      return;
    }
    // Signed out everywhere, so the account is really gone from view rather than still open on
    // another device. Signing in again is what brings it back.
    await signOutEverywhereOnThisPhone({ scope: "global" });
    void navigate({ to: "/welcome", replace: true, search: { back: "hidden" } });
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("break.title")}</h1>
      <p className="mt-4 text-base text-ink">{t("break.what")}</p>
      <p className="mt-3 text-base text-ink-soft">{t("break.how")}</p>
      <p className="mt-3 text-base text-ink-soft">{t("break.notDelete")}</p>
      <p className="mt-3 text-base text-ink-soft">{t("break.signsYouOut")}</p>

      {failed ? (
        <p
          role="alert"
          className="mt-6 rounded-sm border border-line bg-surface-2 px-4 py-3 text-base text-ink"
        >
          {t("break.failed")}
        </p>
      ) : null}

      <div className="mt-8">
        <PrimaryButton disabled={hiding} onClick={() => setAsking(true)}>
          {hiding ? t("loading") : t("break.confirm")}
        </PrimaryButton>
      </div>

      <button
        type="button"
        onClick={() => void navigate({ to: "/settings" })}
        className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
      >
        {t("break.cancel")}
      </button>

      <Sheet
        open={asking}
        onOpenChange={(open) => {
          if (!hiding) setAsking(open);
        }}
        title={t("break.sureTitle")}
        description={t("break.sureWhat")}
        action={
          <div>
            <PrimaryButton disabled={hiding} onClick={() => void hide()}>
              {hiding ? t("loading") : t("break.sureYes")}
            </PrimaryButton>
            <button
              type="button"
              disabled={hiding}
              onClick={() => setAsking(false)}
              className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-50"
            >
              {t("break.sureNo")}
            </button>
          </div>
        }
      />
    </div>
  );
}
