import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { EmptyState, Tabs, type TabItem } from "@/components/kleit";
import { KleitMark } from "@/brand/KleitMark";
import { createQuickDraft, myDrafts, mySets, type SetSummary } from "@/sets/sets";
import { isClosed, myPolls, type PollSummary } from "@/polls/polls";
import { t, type MessageKey } from "@/i18n/en";
import { myRoles } from "@/safety/moderation";
import {
  Archive,
  ChevronRight,
  Folder,
  LayoutTemplate,
  MessageCircleQuestion,
  ShieldCheck,
  Shirt,
  SlidersHorizontal,
  Star,
  Tag,
  Trophy,
  Type,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

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

type Shortcut = { to: string; label: MessageKey; hint?: MessageKey; Icon: LucideIcon };

const BIG: readonly (Shortcut & { hint: MessageKey })[] = [
  { to: "/you/closet", label: "profile.closet", hint: "profile.closetHint", Icon: Shirt },
  { to: "/you/drawer", label: "profile.drawer", hint: "profile.drawerHint", Icon: Archive },
  { to: "/you/collections", label: "profile.folders", hint: "profile.foldersHint", Icon: Folder },
  {
    to: "/you/templates",
    label: "profile.templates",
    hint: "profile.templatesHint",
    Icon: LayoutTemplate,
  },
];

const MORE: readonly Shortcut[] = [
  { to: "/you/points", label: "profile.points", Icon: Star },
  { to: "/contests", label: "contest.title", Icon: Trophy },
  { to: "/asks", label: "ask.title", Icon: MessageCircleQuestion },
  { to: "/groups", label: "profile.groups", Icon: Users },
  { to: "/you/people", label: "profile.people", Icon: UserPlus },
  { to: "/you/items", label: "profile.myItems", Icon: Tag },
  { to: "/you/fonts", label: "profile.fonts", Icon: Type },
];

type Me = { username: string; display_name: string; is_private: boolean; bio: string };

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
        .select("username, display_name, is_private, bio")
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
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl text-ink">{name || t("tabs.you")}</h1>
          {me ? <p className="truncate text-base text-ink-soft">@{me.username}</p> : null}
          {me?.is_private ? (
            <p className="mt-1 text-sm text-ink-soft">{t("profile.private")}</p>
          ) : null}
        </div>
        <Link
          to="/settings"
          aria-label={t("profile.settings")}
          className="flex size-12 shrink-0 items-center justify-center rounded-pill border border-line bg-surface text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          <SlidersHorizontal className="size-5" aria-hidden="true" />
        </Link>
      </div>
      {me?.bio?.trim() ? (
        <p className="mt-3 whitespace-pre-wrap text-base text-ink">{me.bio}</p>
      ) : null}

      {moderator ? (
        <Link
          to="/mod"
          className="mt-5 flex min-h-12 items-center gap-3 rounded-md border border-brand bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          <ShieldCheck className="size-5 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t("mod.title")}</span>
          <ChevronRight className="size-5 shrink-0 text-ink-soft" aria-hidden="true" />
        </Link>
      ) : null}

      {/* The four places people go most, big; everything else on one row that scrolls sideways.
          Every label is one line and never wraps (the owner's call, 2026-10-09: design C). */}
      <ul className="mt-4 grid grid-cols-2 gap-3">
        {BIG.map(({ to, label, hint, Icon }) => (
          <li key={to} className="min-w-0">
            <Link
              to={to}
              className="flex h-full flex-col gap-3 rounded-md border border-line bg-surface p-4 text-ink transition-colors duration-fast hover:bg-surface-2"
            >
              <Icon className="size-6 text-brand" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-base font-semibold">{t(label)}</span>
                <span className="truncate text-sm text-ink-soft">{t(hint)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        {t("profile.more")}
      </h2>
      <ul className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
        {MORE.map(({ to, label, Icon }) => (
          <li key={to} className="shrink-0">
            <Link
              to={to}
              className="flex min-h-12 items-center gap-2 whitespace-nowrap rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
            >
              <Icon className="size-4" aria-hidden="true" />
              {t(label)}
            </Link>
          </li>
        ))}
      </ul>

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
