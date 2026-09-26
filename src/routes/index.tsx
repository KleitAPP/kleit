import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { whereDoIBelong, type Landing } from "@/auth/session";
import { KleitMark } from "@/brand/KleitMark";
import { LaunchSplash } from "@/screens/LaunchGate";
import { t } from "@/i18n/en";

/**
 * The front door. Everyone lands here: a first visit, a return visit, and — because the free
 * tier will not let us replace Supabase's own sign-in email — anyone who clicked the link in
 * that email instead of typing the code.
 *
 * It asks where the person belongs rather than assuming, and sends them on:
 *   signed out      -> Welcome (S4)
 *   no profile yet  -> Pick a username (S8), which is where a half-finished sign-up resumes
 *   profile exists  -> Home, which is the tab shell at M1.8
 */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kleit" },
      { name: "description", content: "Kleit" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [landing, setLanding] = useState<Landing | null>(null);

  useEffect(() => {
    let cancelled = false;
    void whereDoIBelong().then((where) => {
      if (cancelled) return;
      setLanding(where);
      if (where === "signed-out") void navigate({ to: "/welcome", replace: true });
      if (where === "needs-username") void navigate({ to: "/join/username", replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (landing === null || landing !== "ready") return <LaunchSplash />;

  // M1.8 replaces this with the five tabs and the start cards.
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <KleitMark size={48} className="text-ink" />
      <h1 className="font-display text-3xl text-ink">Kleit</h1>
      <p className="text-base text-ink-soft">{t("home.placeholder")}</p>
    </main>
  );
}
