import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { PrimaryButton } from "@/components/kleit";
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
 */
export const Route = createFileRoute("/_app/settings/break")({
  head: () => ({ meta: [{ title: "Take a break" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: TakeABreak,
});

function TakeABreak() {
  const navigate = useNavigate();
  const [hiding, setHiding] = useState(false);

  async function hide() {
    setHiding(true);
    const { data } = await supabase.auth.getUser();
    const me = data.user?.id;
    if (!me) return;
    const { error } = await supabase
      .from("profiles")
      .update({ deactivated_at: new Date().toISOString() })
      .eq("user_id", me);
    if (error) {
      setHiding(false);
      return;
    }
    // Signed out everywhere, so the account is really gone from view rather than still open on
    // another device. Signing in again is what brings it back.
    await supabase.auth.signOut({ scope: "global" });
    void navigate({ to: "/welcome", replace: true, search: { back: "hidden" } });
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("break.title")}</h1>
      <p className="mt-4 text-base text-ink">{t("break.what")}</p>
      <p className="mt-3 text-base text-ink-soft">{t("break.how")}</p>
      <p className="mt-3 text-base text-ink-soft">{t("break.notDelete")}</p>

      <div className="mt-8">
        <PrimaryButton disabled={hiding} onClick={() => void hide()}>
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
    </div>
  );
}
