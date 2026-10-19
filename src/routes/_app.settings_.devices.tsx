import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { myDevices, signOutDevice, type Device } from "@/auth/devices";
import { signOutEverywhereOnThisPhone } from "@/auth/signOut";
import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * S18 — Where you're signed in (design pack §2.1; security plan #23; spec 3.6 #6).
 *
 * "Sign out everywhere" is what a person reaches for when they think someone else is in their
 * account: Supabase's global sign-out ends every session on every device, not just this one.
 *
 * The list is one row per live session (migration 105): the kind of device and browser, when it
 * was last here, the one you are on marked. "Sign out there" ends one other session on the
 * server; that device is out within the hour (an access token already issued lives out its
 * hour, the same as Supabase's own global sign-out), and the row goes at once.
 */
export const Route = createFileRoute("/_app/settings_/devices")({
  head: () => ({
    meta: [{ title: "Where you're signed in" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Devices,
});

function Devices() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void myDevices().then((list) => {
      if (!cancelled) setDevices(list ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOutThere(device: Device) {
    setBusy(device.id);
    setProblem(null);
    const ok = await signOutDevice(device.id);
    if (ok) setDevices((devices ?? []).filter((d) => d.id !== device.id));
    else setProblem(t("devices.failed"));
    setBusy(null);
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("devices.title")}</h1>

      {devices !== null && devices.length === 0 ? (
        <EmptyState line={t("devices.none")} />
      ) : (
        <ul className="mt-6 overflow-hidden rounded-md border border-line bg-surface">
          {(devices ?? []).map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-base text-ink">
                  {d.device_label || t("devices.unknown")}
                  {d.this_one ? (
                    <span className="ml-2 text-sm text-ink-soft">{t("devices.thisOne")}</span>
                  ) : null}
                </p>
                <p className="text-sm text-ink-soft">
                  {d.this_one
                    ? t("devices.now")
                    : t("devices.lastSeen", { when: whenLabel(d.last_seen_at) })}
                </p>
              </div>
              {!d.this_one ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void signOutThere(d)}
                  className="shrink-0 rounded-pill border border-line bg-surface px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
                >
                  {busy === d.id ? t("loading") : t("devices.signOutThere")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {devices !== null && devices.length > 1 ? (
        <p className="mt-2 text-sm text-ink-soft">{t("devices.howLong")}</p>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-3 text-base text-ink">
          {problem}
        </p>
      ) : null}

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

/** "today", "yesterday", or a short date - a list of devices wants a glance, not a timestamp. */
function whenLabel(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return t("devices.today");
  if (days === 1) return t("devices.yesterday");
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
