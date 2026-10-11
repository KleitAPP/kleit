import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { checkInvite, forgetInvite, peekInvite, rememberInvite, tidyInvite } from "@/auth/beta";
import { PrimaryButton } from "@/components/kleit";
import { supabase } from "@/integrations/supabase/client";
import { t } from "@/i18n/en";

/**
 * S111 - The invite (spec 23.2 #1). Shown between signing in and picking a username while the
 * beta is invite-only. A code is checked here as a courtesy (a typo is caught where it was
 * typed) and spent by the database when the profile is written, so nothing here is the gate.
 * Someone who arrived through an invite link never sees this screen: the code was kept.
 */
export const Route = createFileRoute("/join/invite")({
  head: () => ({
    meta: [{ title: "Your invite" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  validateSearch: (search: Record<string, unknown>): { bad?: boolean } =>
    search["bad"] === true || search["bad"] === "1" ? { bad: true } : {},
  component: Invite,
});

function Invite() {
  const navigate = useNavigate();
  const { bad } = Route.useSearch();
  const [typed, setTyped] = useState(() => (bad ? "" : (peekInvite() ?? "")));
  const [state, setState] = useState<"idle" | "checking" | "no" | "offline">("idle");
  const [wasBad] = useState(!!bad);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && !data.session) void navigate({ to: "/welcome", replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);
  // A kept code that the database no longer accepts is forgotten, so the person is not stuck.
  useEffect(() => {
    if (bad) forgetInvite();
  }, [bad]);

  const code = tidyInvite(typed);
  const ready = code.length === 8 && state !== "checking";

  async function next() {
    if (!ready) return;
    setState("checking");
    const ok = await checkInvite(code);
    if (ok === null) {
      setState("offline");
      return;
    }
    if (!ok) {
      setState("no");
      return;
    }
    rememberInvite(code);
    void navigate({ to: "/join/username", replace: true });
  }

  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-6 pt-12">
      <div className="mx-auto w-full max-w-sm flex-1">
        <h1 className="font-display text-2xl text-ink">{t("invite.title")}</h1>
        <p className="mt-2 text-base text-ink-soft">{t("invite.why")}</p>

        <label htmlFor="invite" className="mt-8 block text-sm text-ink-soft">
          {t("invite.label")}
        </label>
        <input
          id="invite"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setState("idle");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) void next();
          }}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          placeholder="ABCD2345"
          className="mt-2 min-h-12 w-full rounded-sm border border-line bg-surface px-4 font-mono text-lg tracking-widest text-ink"
        />
        <p aria-live="polite" className="mt-3 min-h-10 text-sm">
          {state === "checking" ? (
            <span className="text-ink-soft">{t("username.checking")}</span>
          ) : null}
          {state === "no" || (wasBad && state === "idle" && typed === "") ? (
            <span className="text-danger">{t("invite.no")}</span>
          ) : null}
          {state === "offline" ? <span className="text-warning">{t("join.offline")}</span> : null}
        </p>
        <PrimaryButton onClick={() => void next()} disabled={!ready}>
          {t("username.next")}
        </PrimaryButton>
        <p className="mt-6 text-sm text-ink-soft">{t("invite.none")}</p>
      </div>
    </main>
  );
}
