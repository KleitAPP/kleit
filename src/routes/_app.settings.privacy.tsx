import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { Toast } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * S19 — Privacy (design pack §2.1; spec 3.6).
 *
 * Every switch here is a column on `profiles` that the database itself enforces, so turning one
 * on is not a request to the app to be discreet — a second account's read is refused by the row
 * policy whatever the app does.
 */
export const Route = createFileRoute("/_app/settings/privacy")({
  head: () => ({ meta: [{ title: "Privacy" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Privacy,
});

type Switches = {
  is_private: boolean;
  findable_by_email: boolean;
  findable_by_phone: boolean;
  suggestable: boolean;
};

const ROWS: { key: keyof Switches; title: string; why?: string }[] = [
  { key: "is_private", title: t("privacy.privateAccount"), why: t("privacy.privateWhy") },
  { key: "findable_by_email", title: t("privacy.findEmail") },
  { key: "findable_by_phone", title: t("privacy.findPhone") },
  { key: "suggestable", title: t("privacy.suggest") },
];

function Privacy() {
  const [now, setNow] = useState<Switches | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.id;
      if (!me) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_private, findable_by_email, findable_by_phone, suggestable")
        .eq("user_id", me)
        .maybeSingle();
      if (!cancelled && profile) setNow(profile);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function flip(key: keyof Switches) {
    if (!now) return;
    const next = { ...now, [key]: !now[key] };
    setNow(next); // Move the switch at once; the database is the slow part, not the person.
    const { data } = await supabase.auth.getUser();
    const me = data.user?.id;
    if (!me) return;
    // Written out rather than built from a variable, so the generated types still check that
    // each of these really is a column on profiles.
    const patch =
      key === "is_private" ? { is_private: next.is_private }
      : key === "findable_by_email" ? { findable_by_email: next.findable_by_email }
      : key === "findable_by_phone" ? { findable_by_phone: next.findable_by_phone }
      : { suggestable: next.suggestable };
    const { error } = await supabase.from("profiles").update(patch).eq("user_id", me);
    if (error) setNow(now); // Put it back if it did not land.
    else setSaved(true);
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("privacy.title")}</h1>

      <ul className="mt-6 overflow-hidden rounded-md border border-line bg-surface">
        {ROWS.map(({ key, title, why }) => (
          <li key={key} className="border-b border-line last:border-b-0">
            <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-base text-ink">{title}</span>
                {why ? <span className="block text-sm text-ink-soft">{why}</span> : null}
              </span>
              <input
                type="checkbox"
                checked={now?.[key] ?? false}
                disabled={now === null}
                onChange={() => void flip(key)}
                className="size-6 shrink-0 accent-brand"
              />
            </label>
          </li>
        ))}
      </ul>

      {saved ? <Toast message={t("privacy.saved")} tone="positive" onDismiss={() => setSaved(false)} /> : null}
    </div>
  );
}
