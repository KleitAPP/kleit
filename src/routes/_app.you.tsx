import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { capWords, takeSetProblem } from "@/sets/caps";
import { EmptyState, PrimaryButton, Sheet, Tabs, type TabItem } from "@/components/kleit";
import { Avatar } from "@/social/Avatar";
import { myPhotoState } from "@/social/profilePhoto";
import { PhotoSheet } from "@/social/PhotoSheet";
import { ShareProfile } from "@/social/ShareProfile";
import { SaveToCollection } from "@/collections/SaveToCollection";
import {
  createQuickDraft,
  deleteSet,
  myDrafts,
  mySets,
  refreshPreview,
  type SetSummary,
} from "@/sets/sets";
import { isClosed, myPolls, type PollSummary } from "@/polls/polls";
import { t, type MessageKey } from "@/i18n/en";
import { AccountLabelChip } from "@/social/AccountLabel";
import type { AccountLabel } from "@/social/labels";
import { myRoles } from "@/safety/moderation";
import {
  Archive,
  ChevronRight,
  Folder,
  LayoutTemplate,
  MessageCircleQuestion,
  Share2,
  ShieldCheck,
  Shirt,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  Trophy,
  Type,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * S12 — Your profile (design pack W15).
 *
 * Four tabs: Sets · Drafts · Hidden · Polls. Sets is what others may see (each set's own
 * setting decides who); Hidden is your published sets set to Only me (spec 7.1a). Drafts and
 * Hidden are yours alone, and the screen says so rather than leaving you to wonder. Recently
 * deleted (S26) is reachable from here too, quietly, at the bottom.
 *
 * Select (spec 7.1 #10): tick many sets on the Sets or Hidden tab and change who can see them,
 * put them in a folder, or delete them, in one go. Each change is the same row update the set
 * page makes, so the row policies decide exactly as they do one at a time.
 */
export const Route = createFileRoute("/_app/you")({
  head: () => ({ meta: [{ title: "You" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: YourProfile,
});

type Tab = "sets" | "drafts" | "hidden" | "polls";
type Visibility = SetSummary["visibility"];
const VISIBILITY: ReadonlyArray<{ id: Visibility; label: string }> = [
  { id: "public", label: t("vis.public") },
  { id: "link", label: t("vis.link") },
  { id: "followers", label: t("vis.followers") },
  { id: "friends", label: t("vis.friends") },
  { id: "only_me", label: t("vis.onlyMe") },
];

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

type Me = {
  username: string;
  display_name: string;
  is_private: boolean;
  bio: string;
  label: AccountLabel;
  avatar_item_id: string | null;
};

function YourProfile() {
  const navigate = useNavigate();
  const [me, setMe] = useState<Me | null>(null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [sharing, setSharing] = useState(false);
  /** "Checking your photo" after an upload the scan has not yet cleared (it shows once it has). */
  const [photoChecking, setPhotoChecking] = useState(false);
  const [tab, setTab] = useState<Tab>("sets");
  const [drafts, setDrafts] = useState<SetSummary[] | null>(null);
  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const [polls, setPolls] = useState<PollSummary[] | null>(null);
  const [moderator, setModerator] = useState(false);
  useEffect(() => {
    void myRoles().then((r) => setModerator(r.includes("admin") || r.includes("moderator")));
  }, []);

  // Select mode (spec 7.1 #10): which sets are ticked, and which sheet is open for them.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"visibility" | "folder" | "delete" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pickedIds = [...picked];

  function stopSelecting() {
    setSelecting(false);
    setPicked(new Set());
    setBulk(null);
  }

  function togglePick(id: string) {
    setPicked((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkVisibility(next: Visibility) {
    if (pickedIds.length === 0) return;
    setBulkBusy(true);
    const { error } = await supabase.from("sets").update({ visibility: next }).in("id", pickedIds);
    setBulkBusy(false);
    if (error) {
      setNotice(t("select.failed"));
      return;
    }
    for (const id of pickedIds) refreshPreview(id);
    setSets(
      (list) => list?.map((s) => (picked.has(s.id) ? { ...s, visibility: next } : s)) ?? null,
    );
    setNotice(t("select.visibilityDone", { count: pickedIds.length }));
    stopSelecting();
  }

  async function bulkDelete() {
    if (pickedIds.length === 0) return;
    setBulkBusy(true);
    const results = await Promise.all(pickedIds.map((id) => deleteSet(id)));
    setBulkBusy(false);
    const gone = new Set(pickedIds.filter((_, i) => results[i]));
    setSets((list) => list?.filter((s) => !gone.has(s.id)) ?? null);
    setNotice(
      gone.size === pickedIds.length
        ? t("select.deleteDone", { count: gone.size })
        : t("select.failed"),
    );
    stopSelecting();
  }

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
    if ((tab !== "sets" && tab !== "hidden") || sets !== null) return;
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
        .select("username, display_name, is_private, bio, label, avatar_item_id")
        .eq("user_id", id)
        .maybeSingle();
      if (cancelled || !profile) return;
      setMe(profile);
      if (profile.avatar_item_id) {
        const state = await myPhotoState(profile.avatar_item_id);
        if (!cancelled) setPhotoChecking(state === "checking");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const name = me?.display_name?.trim() ? me.display_name : (me?.username ?? "");
  // Only me sets live in Hidden, not in Sets (spec 7.1a #1, #3).
  const shown =
    tab === "hidden"
      ? sets?.filter((s) => s.visibility === "only_me")
      : sets?.filter((s) => s.visibility !== "only_me");

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setPhotoSheet(true)}
          aria-label={t("avatar.title")}
          className="shrink-0 rounded-pill"
        >
          <Avatar itemId={photoChecking ? null : me?.avatar_item_id} size={64} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl text-ink">{name || t("tabs.you")}</h1>
          {photoChecking ? (
            <p className="text-sm text-ink-soft">{t("avatar.checkingLine")}</p>
          ) : null}
          {me ? (
            <p className="truncate text-base text-ink-soft">
              @{me.username} <AccountLabelChip label={me.label} className="ml-1 align-middle" />
            </p>
          ) : null}
          {me?.is_private ? (
            <p className="mt-1 text-sm text-ink-soft">{t("profile.private")}</p>
          ) : null}
        </div>
        {me ? (
          <button
            type="button"
            onClick={() => setSharing(true)}
            aria-label={t("shareProfile.title")}
            className="flex size-12 shrink-0 items-center justify-center rounded-pill border border-line bg-surface text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            <Share2 className="size-5" aria-hidden="true" />
          </button>
        ) : null}
        <Link
          to="/settings"
          aria-label={t("profile.settings")}
          className="flex size-12 shrink-0 items-center justify-center rounded-pill border border-line bg-surface text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          <SlidersHorizontal className="size-5" aria-hidden="true" />
        </Link>
      </div>
      {me ? <ShareProfile username={me.username} open={sharing} onOpenChange={setSharing} /> : null}
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

      <Tabs
        items={TABS}
        current={tab}
        onChange={(next) => {
          stopSelecting();
          setTab(next);
        }}
        label={t("tabs.you")}
      >
        {tab === "sets" ? null : (
          <p className="mt-3 text-sm text-ink-soft">{t("profile.onlyYou")}</p>
        )}

        {notice ? (
          <p
            role="status"
            className="mt-3 rounded-md border border-line bg-surface p-3 text-sm text-ink"
          >
            {notice}
          </p>
        ) : null}

        {(tab === "sets" || tab === "hidden") && shown && shown.length > 0 ? (
          <>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-ink-soft">
                {selecting ? t("select.count", { count: picked.size }) : ""}
              </span>
              <button
                type="button"
                onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                className="min-h-10 rounded-pill px-3 text-sm font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
              >
                {selecting ? t("select.cancel") : t("select.start")}
              </button>
            </div>
            <ul className="mt-1 divide-y divide-line">
              {shown.map((d) => {
                const who =
                  d.visibility === "public"
                    ? t("vis.public")
                    : d.visibility === "link"
                      ? t("vis.link")
                      : d.visibility === "only_me"
                        ? t("vis.onlyMe")
                        : d.visibility === "friends"
                          ? t("vis.friends")
                          : t("vis.followers");
                return (
                  <li key={d.id}>
                    {selecting ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={picked.has(d.id)}
                        onClick={() => togglePick(d.id)}
                        className="flex min-h-12 w-full items-center gap-3 py-3 text-left text-base text-ink"
                      >
                        <span
                          aria-hidden="true"
                          className={`flex size-6 shrink-0 items-center justify-center rounded-sm border ${picked.has(d.id) ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface"}`}
                        >
                          {picked.has(d.id) ? "✓" : ""}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {d.title || t("profile.draftUntitled")}
                        </span>
                        <span className="ml-3 shrink-0 text-sm text-ink-soft">{who}</span>
                      </button>
                    ) : (
                      <Link
                        to="/set/$setId"
                        params={{ setId: d.id }}
                        className="flex min-h-12 items-center justify-between py-3 text-base text-ink"
                      >
                        <span className="truncate">{d.title || t("profile.draftUntitled")}</span>
                        <span className="ml-3 shrink-0 text-sm text-ink-soft">{who}</span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            {selecting && picked.size > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionPill label={t("send.whoCanSee")} onClick={() => setBulk("visibility")} />
                <ActionPill label={t("collections.saveTo")} onClick={() => setBulk("folder")} />
                <ActionPill label={t("setpage.delete")} onClick={() => setBulk("delete")} danger />
              </div>
            ) : null}
          </>
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
                      else
                        setNotice(
                          takeSetProblem() === "cap" ? capWords("sets") : t("create.failed"),
                        );
                    }),
                }
              : {})}
          />
        )}
      </Tabs>

      <Link
        to="/you/deleted"
        className="mt-6 flex min-h-12 items-center gap-2 text-sm font-medium text-ink-soft transition-colors duration-fast hover:text-ink"
      >
        <Trash2 className="size-4" aria-hidden="true" />
        {t("profile.bin")}
      </Link>

      <Sheet
        open={bulk === "visibility"}
        onOpenChange={(open) => {
          if (!open) setBulk(null);
        }}
        title={t("send.whoCanSee")}
        description={t("select.visibilityWhat", { count: picked.size })}
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("send.whoCanSee")}>
          {VISIBILITY.map((v) => (
            <ActionPill
              key={v.id}
              label={v.label}
              onClick={() => {
                if (!bulkBusy) void bulkVisibility(v.id);
              }}
            />
          ))}
        </div>
      </Sheet>
      <SaveToCollection
        setId={pickedIds[0] ?? ""}
        setIds={pickedIds}
        open={bulk === "folder"}
        onOpenChange={(open) => {
          if (!open) setBulk(null);
        }}
      />
      <Sheet
        open={bulk === "delete"}
        onOpenChange={(open) => {
          if (!open) setBulk(null);
        }}
        title={t("select.deleteTitle", { count: picked.size })}
        description={t("setpage.deleteWarning")}
        action={
          <PrimaryButton onClick={() => void bulkDelete()} disabled={bulkBusy}>
            {t("select.deleteConfirm", { count: picked.size })}
          </PrimaryButton>
        }
      />
      <PhotoSheet
        hasPhoto={!!me?.avatar_item_id}
        open={photoSheet}
        onOpenChange={setPhotoSheet}
        onChanged={(itemId, state) => {
          setMe((cur) => (cur ? { ...cur, avatar_item_id: itemId } : cur));
          setPhotoChecking(!!itemId && state === "checking");
        }}
      />
    </div>
  );
}

/** One of the Select mode's actions: a pill that does something, not a toggle. */
function ActionPill({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 rounded-pill border border-line bg-surface px-4 text-sm font-medium transition-colors duration-fast hover:bg-surface-2 ${danger ? "text-danger" : "text-ink"}`}
    >
      {label}
    </button>
  );
}
