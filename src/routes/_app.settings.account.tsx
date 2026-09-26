import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { t } from "@/i18n/en";

/**
 * S16 — Account (design pack §2.1).
 * Read-only today. Changing an email needs the code-to-the-new-address flow with an alert to the
 * old one (spec 3.6 #4), and the phone number needs Twilio (M1.11); neither is built, so neither
 * is offered. Showing a field you cannot change is honest; offering a button that does nothing
 * is not.
 */
export const Route = createFileRoute("/_app/settings/account")({
  head: () => ({ meta: [{ title: "Account" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Account,
});

function Account() {
  const [email, setEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const me = data.user;
      if (!me) return;
      if (!cancelled) setEmail(me.email ?? null);
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("user_id", me.id)
        .maybeSingle();
      if (!cancelled && profile) setUsername(profile.username);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("account.title")}</h1>
      <dl className="mt-6 overflow-hidden rounded-md border border-line bg-surface">
        <Field label={t("account.email")} value={email ?? ""} />
        <Field label={t("account.username")} value={username ? `@${username}` : ""} why={t("account.usernameRule")} />
        <Field label={t("account.phone")} value={t("account.phoneNone")} />
      </dl>
    </div>
  );
}

function Field({ label, value, why }: { label: string; value: string; why?: string }) {
  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="mt-1 break-all text-base text-ink">{value}</dd>
      {why ? <p className="mt-1 text-sm text-ink-soft">{why}</p> : null}
    </div>
  );
}
