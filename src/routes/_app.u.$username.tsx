import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/kleit";
import { Avatar } from "@/social/Avatar";
import { t } from "@/i18n/en";
import { previewUrl } from "@/search/search";
import { setsOf, type ProfileSet } from "@/sets/sets";
import { AccountLabelChip } from "@/social/AccountLabel";
import type { AccountLabel } from "@/social/labels";
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

type Them = {
  user_id: string;
  username: string;
  display_name: string;
  is_private: boolean;
  bio: string;
  label: AccountLabel;
  avatar_item_id: string | null;
};

function SomeonesProfile() {
  const { username } = Route.useParams();
  const [them, setThem] = useState<Them | null>(null);
  const [looked, setLooked] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [sets, setSets] = useState<ProfileSet[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, username, display_name, is_private, bio, label, avatar_item_id")
        .eq("username", username.toLowerCase())
        .maybeSingle();
      const { data: who } = await supabase.auth.getUser();
      if (cancelled) return;
      setMe(who.user?.id ?? null);
      setThem(data ?? null);
      setLooked(true);
      if (data) {
        const list = await setsOf(data.user_id);
        if (!cancelled) setSets(list);
      }
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
        <Avatar itemId={them.avatar_item_id} size={64} />
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl text-ink">{name}</h1>
          <p className="truncate text-base text-ink-soft">
            @{them.username} <AccountLabelChip label={them.label} className="ml-1 align-middle" />
          </p>
        </div>
      </div>
      {them.bio?.trim() ? (
        <p className="mt-3 whitespace-pre-wrap text-base text-ink">{them.bio}</p>
      ) : null}

      <FollowButton them={them} me={me} />

      {sets === null ? (
        <div className="kl-skeleton mt-6 h-40 w-full rounded-md bg-surface-2" />
      ) : sets.length === 0 ? (
        them.is_private ? (
          <EmptyState line={t("profile.isPrivate", { name: them.username })} />
        ) : (
          <EmptyState line={t("profile.setsEmpty")} />
        )
      ) : (
        <section className="mt-6" aria-labelledby="their-sets">
          <h2 id="their-sets" className="text-base font-medium text-ink">
            {t("profile.setsN", { count: sets.length })}
          </h2>
          <ul className="mt-2 grid grid-cols-2 gap-3">
            {sets.map((s) => {
              const url = previewUrl(s);
              return (
                <li key={s.id}>
                  <Link
                    to="/set/$setId"
                    params={{ setId: s.id }}
                    className="block overflow-hidden rounded-md bg-surface shadow-card"
                  >
                    <div className="aspect-square w-full bg-surface-2">
                      {url ? (
                        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
                      ) : null}
                    </div>
                    <p className="truncate px-3 py-2 text-sm text-ink">
                      {s.title || "…"}
                      {s.visibility !== "public" ? (
                        <span className="ml-1 text-xs text-ink-soft">
                          · {t(`profile.visibility.${s.visibility}`)}
                        </span>
                      ) : null}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
