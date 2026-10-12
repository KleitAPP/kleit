import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { signOutEverywhereOnThisPhone } from "@/auth/signOut";
import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * S18 — Where you're signed in (design pack §2.1; security plan #23).
 *
 * "Sign out everywhere" is the one thing on this screen that has to work today, because it is
 * what a person reaches for when they think someone else is in their account. Supabase's global
 * sign-out ends every session on every device, not just this one.
 *
 * The per-device list comes from `user_devices`, which nothing writes to yet — that is part of
 * M1.10 proper. An empty list is stated plainly rather than dressed up.
 */
export const Route = createFileRoute("/_app/settings_/devices")({
  head: () => ({
    meta: [{ title: "Where you're signed in" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Devices,
});

function Devices() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<
    { id: string; device_label: string; city: string | null; last_seen_at: string }[] | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_devices")
        .select("id, device_label, city, last_seen_at")
        .order("last_seen_at", { ascending: false });
      if (!cancelled) setDevices(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("devices.title")}</h1>

      {devices !== null && devices.length === 0 ? (
        <EmptyState line={t("devices.none")} />
      ) : (
        <ul className="mt-6 overflow-hidden rounded-md border border-line bg-surface">
          {(devices ?? []).map((d) => (
            <li key={d.id} className="border-b border-line px-4 py-3 last:border-b-0">
              <p className="text-base text-ink">{d.device_label || t("devices.thisOne")}</p>
              {d.city ? <p className="text-sm text-ink-soft">{d.city}</p> : null}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => {
          void signOutEverywhereOnThisPhone({ scope: "global" }).then(() =>
            navigate({ to: "/welcome", replace: true }),
          );
        }}
        className="mt-6 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
      >
        {t("devices.signOutAll")}
      </button>
    </div>
  );
}
