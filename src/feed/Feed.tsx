import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, SetCard, SetCardSkeleton, Tabs, type TabItem } from "@/components/kleit";
import { t } from "@/i18n/en";
import { previewUrl } from "@/search/search";

import { FEED_PAGE, featuredFeed, followingFeed, type FeedSet } from "./feed";

/**
 * S11/S90 — the feed on Home (roadmap M6.2; decision 84): Following and Featured. Following
 * opens first when it has anything in it; a brand-new person lands on Featured, which is Top
 * sets - whole public sets other people published and loved this week, never your own.
 * Every card's buttons open the set, where liking, reacting and commenting live.
 */
type FeedTab = "following" | "featured";
const TABS: readonly TabItem<FeedTab>[] = [
  { id: "following", label: t("feed.following") },
  { id: "featured", label: t("feed.featured") },
];

export function Feed() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<FeedTab | null>(null);
  const [following, setFollowing] = useState<FeedSet[] | null>(null);
  const [featured, setFeatured] = useState<FeedSet[] | null>(null);
  const [more, setMore] = useState<{ following: boolean; featured: boolean }>({
    following: true,
    featured: true,
  });
  const [busy, setBusy] = useState(false);

  // First load: both pages at once, then pick the tab that has something to show.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [f, g] = await Promise.all([followingFeed(null), featuredFeed(0)]);
      if (cancelled) return;
      setFollowing(f);
      setFeatured(g);
      setMore({ following: f.length === FEED_PAGE, featured: g.length === FEED_PAGE });
      setTab(f.length > 0 ? "following" : "featured");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadMore() {
    if (busy || !tab) return;
    setBusy(true);
    try {
      if (tab === "following") {
        const last = following?.[following.length - 1]?.published_at ?? null;
        const next = await followingFeed(last);
        setFollowing((cur) => [...(cur ?? []), ...next]);
        setMore((m) => ({ ...m, following: next.length === FEED_PAGE }));
      } else {
        const next = await featuredFeed(featured?.length ?? 0);
        setFeatured((cur) => [...(cur ?? []), ...next]);
        setMore((m) => ({ ...m, featured: next.length === FEED_PAGE }));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!tab) {
    return (
      <div className="flex flex-col gap-4">
        <SetCardSkeleton />
        <SetCardSkeleton />
      </div>
    );
  }
  const rows = tab === "following" ? following : featured;
  const open = (id: string) => void navigate({ to: "/set/$setId", params: { setId: id } });

  return (
    <Tabs items={TABS} current={tab} onChange={setTab} label={t("feed.label")}>
      {!rows || rows.length === 0 ? (
        tab === "following" ? (
          <EmptyState
            line={t("feed.empty")}
            actionLabel={t("feed.findPeople")}
            onAction={() => void navigate({ to: "/you/people" })}
          />
        ) : (
          <EmptyState line={t("feed.emptyFeatured")} />
        )
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-4">
            {rows.map((s) => (
              <li key={s.id}>
                <SetCard
                  imageSrc={previewUrl(s) ?? ""}
                  imageAlt={s.title || t("feed.untitled")}
                  username={s.username}
                  {...(s.avatar_url ? { avatarSrc: s.avatar_url } : {})}
                  {...(s.layout?.caption || s.title
                    ? { caption: s.layout?.caption || s.title }
                    : {})}
                  onOpen={() => open(s.id)}
                  onLike={() => open(s.id)}
                  onComment={() => open(s.id)}
                  onSave={() => open(s.id)}
                  onMore={() => open(s.id)}
                />
              </li>
            ))}
          </ul>
          {more[tab] ? (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={busy}
              className="mt-4 min-h-12 w-full rounded-pill border border-line bg-surface text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-60"
            >
              {busy ? t("loading") : t("feed.more")}
            </button>
          ) : null}
        </>
      )}
    </Tabs>
  );
}
