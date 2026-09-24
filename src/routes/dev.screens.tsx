import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { appSettingsQuery } from "@/app/appSettings";
import { APP_VERSION, isVersionBelow } from "@/app/version";
import { ForcedUpdate } from "@/screens/ForcedUpdate";
import { LaunchSplash } from "@/screens/LaunchGate";
import { Maintenance } from "@/screens/Maintenance";

/**
 * Review page for S1-S3 (roadmap M1.14). Shows the three launch screens next to each other and
 * prints the seven switches as the app currently reads them, so the look and the live values can
 * be checked in one place. Debug route - removed before launch, like /dev/components.
 */
export const Route = createFileRoute("/dev/screens")({
  head: () => ({
    meta: [{ title: "Kleit - launch screens" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: DevScreens,
});

function DevScreens() {
  const { data, error, isPending, isFetching, refetch } = useQuery({
    ...appSettingsQuery,
    enabled: typeof window !== "undefined",
  });

  const blocking = isVersionBelow(APP_VERSION, data?.min_app_version ?? "0.0.0")
    ? "the update screen"
    : data?.maintenance_mode
      ? "the maintenance screen"
      : "nothing - the app is open";

  return (
    <div className="min-h-dvh bg-canvas px-4 py-8 text-ink">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl text-ink">Launch screens</h1>
        <p className="mt-2 text-base text-ink-soft">
          S1 launch check, S2 forced update, S3 maintenance. This bundle is version {APP_VERSION}.
        </p>

        <h2 className="mt-8 font-display text-xl text-ink">The switches, as this app reads them</h2>
        {isPending ? (
          <p className="mt-2 text-sm text-ink-soft">Reading the switches.</p>
        ) : error ? (
          <p className="mt-2 text-sm text-danger">
            Could not read the switches. The app carries on regardless.
          </p>
        ) : (
          <table className="mt-3 w-full border-collapse text-left text-sm">
            <tbody>
              {Object.entries(data ?? {}).map(([key, value]) => (
                <tr key={key} className="border-b border-line">
                  <th scope="row" className="py-2 pr-4 font-normal text-ink-soft">
                    {key}
                  </th>
                  <td className="py-2 text-ink">{JSON.stringify(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-sm text-ink-soft">Blocking right now: {blocking}.</p>

        <h2 className="mt-10 font-display text-xl text-ink">S1 - Launch check</h2>
        <Frame>
          <LaunchSplash />
        </Frame>

        <h2 className="mt-10 font-display text-xl text-ink">S2 - Forced update</h2>
        <Frame>
          <ForcedUpdate running={APP_VERSION} minimum="1.2.0" />
        </Frame>

        <h2 className="mt-10 font-display text-xl text-ink">S3 - Maintenance</h2>
        <Frame>
          <Maintenance onRetry={() => void refetch()} retrying={isFetching} />
        </Frame>
      </div>
    </div>
  );
}

/** A phone-shaped window, so each screen is judged at roughly the size it will be seen at. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 max-w-sm overflow-hidden rounded-md border border-line">
      <div className="h-96 overflow-y-auto">{children}</div>
    </div>
  );
}
