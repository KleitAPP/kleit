import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/kleit";
import { KleitMark } from "@/brand/KleitMark";
import { t } from "@/i18n/en";
import { FollowButton } from "@/social/FollowButton";

/**
 * S13 — Someone else's profile (design pack §2.1).
 *
 * What you may see is decided by the database, not by this screen: the `profiles` read policy
 * hides a deactivated account from everyone but its owner, so a deactivated person simply is not
 * found here. A private account is found but its sets are not shown — and there are no sets to
 * show for anyone until M3.1, so today that difference is a line of text rather than a grid.
 */
export const Route = createFileRoute("/_app/u/$username")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  component: SomeonesProfile,
});

type Them = { user_id: string; username: string; display_name: string; is_private: boolean };

function SomeonesProfile() {
  const { username } = Route.useParams();
  const [them, setThem] = useState<Them | null>(null);
  const [looked, setLooked] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, username, display_name, is_private")
        .eq("username", username.toLowerCase())
        .maybeSingle();
      const { data: who } = await supabase.auth.getUser();
      if (cancelled) return;
      setMe(who.user?.id ?? null);
      setThem(data ?? null);
      setLooked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (!looked) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;

  if (!them) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("profile.notFound")} />
      </div>
    );
  }

  const name = them.display_name?.trim() ? them.display_name : them.username;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <div className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-pill bg-surface-2 text-ink">
          <KleitMark size={28} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl text-ink">{name}</h1>
          <p className="truncate text-base text-ink-soft">@{them.username}</p>
        </div>
      </div>

      <FollowButton them={them} me={me} />

      {them.is_private ? (
        <EmptyState line={t("profile.isPrivate", { name: them.username })} />
      ) : (
        <EmptyState line={t("profile.setsEmpty")} />
      )}
    </div>
  );
}
