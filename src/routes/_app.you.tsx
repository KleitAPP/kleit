import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * You — the last tab (design pack §3.1 #2: "You", not "Profile", because it holds Drafts,
 * Hidden, Collections and Settings as well as the public profile).
 *
 * S12's three tabs and the rest of Settings are M1.9 and M1.10. Today it shows who you are and
 * gives you the way out, because a tab you cannot sign out of is a trap.
 */
export const Route = createFileRoute("/_app/you")({
  head: () => ({ meta: [{ title: "You" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: YouTab,
});

function YouTab() {
  const navigate = useNavigate();
  const [me, setMe] = useState<{ username: string; display_name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const id = data.user?.id;
      if (!id) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, display_name")
        .eq("user_id", id)
        .maybeSingle();
      if (!cancelled && profile) setMe(profile);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">
        {me?.display_name?.trim() !== "" && me ? me.display_name : t("tabs.you")}
      </h1>
      {me ? <p className="mt-1 text-base text-ink-soft">@{me.username}</p> : null}

      <EmptyState line={t("you.empty")} />

      <button
        type="button"
        onClick={() => {
          void supabase.auth.signOut().then(() => navigate({ to: "/welcome", replace: true }));
        }}
        className="mt-4 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
      >
        {t("you.signOut")}
      </button>
    </div>
  );
}
