import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Tabs, type TabItem } from "@/components/kleit";
import { KleitMark } from "@/brand/KleitMark";
import { createQuickDraft, myDrafts, mySets, type SetSummary } from "@/sets/sets";
import { isClosed, myPolls, type PollSummary } from "@/polls/polls";
import { t } from "@/i18n/en";
import { myRoles } from "@/safety/moderation";

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

type Tab = "sets" | "drafts" | "hidden" | "polls";

const TABS: readonly TabItem<Tab>[] = [
  { id: "sets", label: t("profile.sets") },
  { id: "drafts", label: t("profile.drafts") },
  { id: "hidden", label: t("profile.hidden") },
  { id: "polls", label: t("profile.polls") },
];

type Me = { username: string; display_name: string; is_private: boolean };

function YourProfile() {
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("sets");
  const [drafts, setDrafts] = useState<SetSummary[] | null>(null);
  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const [polls, setPolls] = useState<PollSummary[] | null>(null);
  const [moderator, setModerator] = useState(false);
  useEffect(() => {
    void myRoles().then((r) => setModerator(r.includes("admin") || r.includes("moderator")));
  }, []);

  useEffect(() => {
    if (tab !== "polls" || polls !== null) return;
    let cancelled = false;
    void myPolls().then((list) => {
      if (!cancelled) setPolls(list);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, polls]);

  useEffect(() => {
    if (tab !== "sets" || sets !== null) return;
    let cancelled = false;
    void mySets().then((list) => {
      if (!cancelled) setSets(list);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, sets]);

  useEffect(() => {
    if (tab !== "drafts" || drafts !== null) return;
    let cancelled = false;
    void myDrafts().then((list) => {
      if (!cancelled) setDrafts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, drafts]);

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
          {me?.is_private ? (
            <p className="mt-1 text-sm text-ink-soft">{t("profile.private")}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to="/you/closet"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("profile.closet")}
        </Link>
        <Link
          to="/you/drawer"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("profile.drawer")}
        </Link>
        <Link
          to="/you/items"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("profile.myItems")}
        </Link>
        <Link
          to="/you/collections"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("profile.folders")}
        </Link>
        <Link
          to="/asks"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("ask.title")}
        </Link>
        {moderator ? (
          <Link
            to="/mod"
            className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-ink bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            {t("mod.title")}
          </Link>
        ) : null}
        <Link
          to="/you/points"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("points.title")}
        </Link>
        <Link
          to="/contests"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("contest.title")}
        </Link>
        <Link
          to="/groups"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("profile.groups")}
        </Link>
        <Link
          to="/you/people"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("profile.people")}
        </Link>
        <Link
          to="/you/templates"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("profile.templates")}
        </Link>
        <Link
          to="/you/fonts"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("profile.fonts")}
        </Link>
        <Link
          to="/settings"
          className="flex min-h-12 flex-1 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("profile.settings")}
        </Link>
      </div>

      <Tabs items={TABS} current={tab} onChange={setTab} label={t("tabs.you")}>
        {tab === "sets" ? null : (
          <p className="mt-3 text-sm text-ink-soft">{t("profile.onlyYou")}</p>
        )}

        {tab === "sets" && sets && sets.length > 0 ? (
          <ul className="mt-4 divide-y divide-line">
            {sets.map((d) => (
              <li key={d.id}>
                <Link
                  to="/set/$setId"
                  params={{ setId: d.id }}
                  className="flex min-h-12 items-center justify-between py-3 text-base text-ink"
                >
                  <span className="truncate">{d.title || t("profile.draftUntitled")}</span>
                  <span className="ml-3 shrink-0 text-sm text-ink-soft">
                    {d.visibility === "public"
                      ? t("vis.public")
                      : d.visibility === "link"
                        ? t("vis.link")
                        : d.visibility === "only_me"
                          ? t("vis.onlyMe")
                          : d.visibility === "friends"
                            ? t("vis.friends")
                            : t("vis.followers")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : tab === "drafts" && drafts && drafts.length > 0 ? (
          <ul className="mt-4 divide-y divide-line">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link
                  to={
                    (d.layout as { version?: number }).version === 2
                      ? "/set/$setId/canvas"
                      : "/set/$setId/edit"
                  }
                  params={{ setId: d.id }}
                  className="flex min-h-12 items-center justify-between py-3 text-base text-ink"
                >
                  <span className="truncate">
                    {d.title || d.layout.caption || t("profile.draftUntitled")}
                  </span>
                  <span className="ml-3 shrink-0 text-sm text-ink-soft">
                    {new Date(d.updated_at).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : tab === "polls" && polls && polls.length > 0 ? (
          <ul className="mt-4 divide-y divide-line">
            {polls.map((p) => (
              <li key={p.id}>
                <Link
                  to="/poll/$pollId"
                  params={{ pollId: p.id }}
                  className="flex min-h-12 items-center justify-between py-3 text-base text-ink"
                >
                  <span className="truncate">{p.question || t("pollbuilder.title")}</span>
                  <span className="ml-3 shrink-0 text-sm text-ink-soft">
                    {isClosed(p)
                      ? t("pollpage.closed")
                      : new Date(p.closes_at).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            line={t(
              tab === "sets"
                ? "profile.setsEmpty"
                : tab === "drafts"
                  ? "profile.draftsEmpty"
                  : tab === "polls"
                    ? "profile.pollsEmpty"
                    : "profile.hiddenEmpty",
            )}
            {...(tab === "drafts"
              ? {
                  actionLabel: t("profile.newDraft"),
                  onAction: () =>
                    void createQuickDraft().then((id) => {
                      if (id) void navigate({ to: "/set/$setId/edit", params: { setId: id } });
                    }),
                }
              : {})}
          />
        )}
      </Tabs>
    </div>
  );
}
