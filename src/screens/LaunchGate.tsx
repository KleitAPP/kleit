import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { appSettingsQuery, SETTINGS_WHEN_UNREADABLE } from "@/app/appSettings";
import { APP_VERSION, isVersionBelow } from "@/app/version";
import { KleitMark } from "@/brand/KleitMark";
import { t } from "@/i18n/en";

import { ForcedUpdate } from "./ForcedUpdate";
import { Maintenance } from "./Maintenance";

/**
 * S1 - Launch check (design pack section 2.1; roadmap M1.14).
 *
 * The first thing that runs. It reads the seven switches, then either blocks the app behind the
 * update screen (S2), behind the maintenance screen (S3), or gets out of the way. It sits above
 * sign-in on purpose: we have to be able to turn the app off for people who are not signed in,
 * which is why `app_settings` is readable by everyone.
 *
 * If the switches cannot be read at all the app carries on (see SETTINGS_WHEN_UNREADABLE) - a
 * database hiccup must not lock everybody out of an app that is working.
 */
export function LaunchGate({ children }: { children: ReactNode }) {
  const { data, isPending, isFetching, refetch } = useQuery({
    ...appSettingsQuery,
    // Read in the browser only: the prerendered shell has no network, so it renders the splash
    // and the real check runs the moment the page wakes up on the phone.
    enabled: typeof window !== "undefined",
    refetchOnWindowFocus: true,
  });

  if (isPending) return <LaunchSplash />;

  const settings = data ?? SETTINGS_WHEN_UNREADABLE;

  if (isVersionBelow(APP_VERSION, settings.min_app_version)) {
    return <ForcedUpdate running={APP_VERSION} minimum={settings.min_app_version} />;
  }

  if (settings.maintenance_mode) {
    return <Maintenance onRetry={() => void refetch()} retrying={isFetching} />;
  }

  return <>{children}</>;
}

/** The quiet moment while the switches are read: the mark, and nothing that moves. */
export function LaunchSplash() {
  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-canvas"
      aria-busy="true"
      aria-label={t("launch.checking")}
    >
      <KleitMark size={48} className="text-ink" />
    </main>
  );
}
