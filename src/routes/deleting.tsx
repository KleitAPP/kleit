import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";

/**
 * The screen a sign-in lands on while a deletion is pending (spec 3.7 #2): the date it becomes
 * final, Undo, and Sign out. Nothing else opens until it is undone.
 */
export const Route = createFileRoute("/deleting")({
  head: () => ({
    meta: [{ title: "Account being deleted" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Deleting,
});

function Deleting() {
  const navigate = useNavigate();
  const [when, setWhen] = useState("");
  useEffect(() => {
    void supabase
      .from("account_deletions")
      .select("final_at, state")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.state !== "pending") {
          void navigate({ to: "/", replace: true });
          return;
        }
        setWhen(
          new Date(data.final_at).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          }),
        );
      });
  }, [navigate]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pt-12 pb-8">
      <h1 className="font-display text-3xl text-ink">{t("delete.landingTitle")}</h1>
      <p className="mt-3 text-base text-ink">{when ? t("delete.pending", { date: when }) : ""}</p>
      <p className="mt-2 text-sm text-ink-soft">{t("delete.pendingWhy")}</p>
      <button
        type="button"
        onClick={() =>
          void supabase
            .rpc("cancel_account_deletion")
            .then(() => navigate({ to: "/", replace: true }))
        }
        className="mt-6 min-h-12 rounded-pill bg-brand px-5 text-base font-medium text-brand-ink"
      >
        {t("delete.undo")}
      </button>
      <button
        type="button"
        onClick={() =>
          void supabase.auth.signOut().then(() => navigate({ to: "/welcome", replace: true }))
        }
        className="mt-3 min-h-12 rounded-pill border border-line bg-surface px-5 text-base text-ink"
      >
        {t("you.signOut")}
      </button>
    </main>
  );
}
