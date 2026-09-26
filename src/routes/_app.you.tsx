import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/kleit";
import { KleitMark } from "@/brand/KleitMark";
import { t } from "@/i18n/en";

/**
 * S12 — Your profile (design pack W15).
 *
 * Three tabs: Sets · Drafts · Hidden. The last two are yours alone, and this screen says so
 * rather than leaving you to wonder. They are empty for everyone today because `sets` does not
 * exist until M3.1 — the tabs ship now so the shape of the screen never changes under people,
 * which is the same reason Search and Inbox shipped empty at M1.8.
 */
export const Route = createFileRoute("/_app/you")({
  head: () => ({ meta: [{ title: "You" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: YourProfile,
});

type Tab = "sets" | "drafts" | "hidden";

type Me = { username: string; display_name: string; is_private: boolean };

function YourProfile() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("sets");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const id = data.user?.id;
      if (!id) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, display_name, is_private")
        .eq("user_id", id)
        .maybeSingle();
      if (!cancelled && profile) setMe(profile);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const name = me?.display_name?.trim() ? me.display_name : (me?.username ?? "");

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <div className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-pill bg-surface-2 text-ink">
          <KleitMark size={28} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl text-ink">{name || t("tabs.you")}</h1>
          {me ? <p className="truncate text-base text-ink-soft">@{me.username}</p> : null}
          {me?.is_private ? <p className="mt-1 text-sm text-ink-soft">{t("profile.private")}</p> : null}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          to="/settings"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("profile.settings")}
        </Link>
      </div>

      <div role="tablist" aria-label={t("tabs.you")} className="mt-6 flex border-b border-line">
        {(["sets", "drafts", "hidden"] as Tab[]).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={
              tab === id
                ? "min-h-12 flex-1 border-b-2 border-brand text-base font-semibold text-brand"
                : "min-h-12 flex-1 border-b-2 border-transparent text-base text-ink-soft"
            }
          >
            {t(id === "sets" ? "profile.sets" : id === "drafts" ? "profile.drafts" : "profile.hidden")}
          </button>
        ))}
      </div>

      {tab === "sets" ? null : (
        <p className="mt-3 text-sm text-ink-soft">{t("profile.onlyYou")}</p>
      )}

      <EmptyState
        line={t(
          tab === "sets" ? "profile.setsEmpty" : tab === "drafts" ? "profile.draftsEmpty" : "profile.hiddenEmpty",
        )}
      />
    </div>
  );
}
