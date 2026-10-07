import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, PrimaryButton, Sheet, Tabs, type TabItem } from "@/components/kleit";
import { t } from "@/i18n/en";
import { ReportButton } from "@/safety/ReportButton";
import { findPeople, me as whoAmI, type Person } from "@/social/follows";
import {
  accept,
  group as loadGroup,
  invite,
  join,
  leaveGroup,
  makeAdmin,
  members as loadMembers,
  mySetsForPosting,
  post as sendPost,
  posts as loadPosts,
  removeMember,
  setVisibility,
  takeDown,
  type Group,
  type Member,
  type Post,
} from "@/social/groups";

/**
 * S80 — a group: its posts (talk, and sets shared into it) and its members; S81 — the admin
 * bits (invite, remove, make admin, who can find it). An invited person sees Accept / Decline
 * first; leaving is quiet (spec 10.3).
 */
export const Route = createFileRoute("/_app/groups_/$groupId")({
  head: () => ({ meta: [{ title: "Group" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: GroupPage,
});

type Tab = "posts" | "members";
const TABS: readonly TabItem<Tab>[] = [
  { id: "posts", label: t("groups.posts") },
  { id: "members", label: t("groups.members") },
];

function GroupPage() {
  const { groupId } = Route.useParams();
  const navigate = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  const [g, setG] = useState<Group | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [tab, setTab] = useState<Tab>("posts");
  const [body, setBody] = useState("");
  const [setId, setSetId] = useState<string | null>(null);
  const [mySets, setMySets] = useState<{ id: string; title: string }[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);

  async function refresh() {
    const [gg, mm, pp] = await Promise.all([
      loadGroup(groupId),
      loadMembers(groupId),
      loadPosts(groupId),
    ]);
    setG(gg);
    setMembers(mm);
    setPosts(pp);
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const who = await whoAmI();
      if (cancelled) return;
      setMe(who);
      await refresh();
      setMySets(await mySetsForPosting());
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);
  useEffect(() => {
    if (query.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = window.setTimeout(() => void findPeople(query).then(setFound), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  if (g === undefined) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!g) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("groups.notFound")} />
      </div>
    );
  }
  const mine = members.find((m) => m.person.user_id === me);
  const joined = mine?.state === "joined";
  const admin = joined && mine?.role === "admin";
  const invited = mine?.state === "invited";

  async function submit() {
    if ((!body.trim() && !setId) || !joined) return;
    if (await sendPost(groupId, body, setId)) {
      setBody("");
      setSetId(null);
      setPosts(await loadPosts(groupId));
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-2xl text-ink">{g.name}</h1>
        <ReportButton type="group" id={groupId} />
      </div>
      {g.description ? <p className="mt-1 text-base text-ink">{g.description}</p> : null}
      <p className="mt-1 text-sm text-ink-soft">
        {g.visibility === "public" ? t("groups.public") : t("groups.private")} ·{" "}
        {members.filter((m) => m.state === "joined").length} {t("groups.members").toLowerCase()}
      </p>

      {invited ? (
        <div className="mt-3 rounded-md border border-line bg-surface p-3 text-sm text-ink">
          <p>{t("groups.inviteBanner")}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void accept(groupId).then(refresh)}
              className="min-h-11 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
            >
              {t("groups.accept")}
            </button>
            <button
              type="button"
              onClick={() => void leaveGroup(groupId).then(() => navigate({ to: "/groups" }))}
              className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
            >
              {t("groups.decline")}
            </button>
          </div>
        </div>
      ) : !joined && g.visibility === "public" ? (
        <div className="mt-3">
          <PrimaryButton onClick={() => void join(groupId).then(refresh)}>
            {t("groups.join")}
          </PrimaryButton>
        </div>
      ) : joined ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConfirmLeave(true)}
            className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
          >
            {t("groups.leave")}
          </button>
          {admin ? (
            <div className="flex gap-2" role="group" aria-label={t("groups.visibility")}>
              <Chip
                label={t("groups.public")}
                selected={g.visibility === "public"}
                onToggle={() => void setVisibility(groupId, "public").then(refresh)}
              />
              <Chip
                label={t("groups.private")}
                selected={g.visibility === "private"}
                onToggle={() => void setVisibility(groupId, "private").then(refresh)}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4">
        <Tabs items={TABS} current={tab} onChange={setTab} label={g.name}>
          {tab === "posts" ? (
            <div className="mt-3 flex flex-col gap-3">
              {joined ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <input
                    type="text"
                    value={body}
                    maxLength={500}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={t("groups.write")}
                    aria-label={t("groups.write")}
                    className="min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
                  />
                  {mySets.length ? (
                    <div
                      className="flex gap-2 overflow-x-auto pb-1"
                      role="group"
                      aria-label={t("groups.attachSet")}
                    >
                      <Chip
                        label={t("groups.noSet")}
                        selected={setId === null}
                        onToggle={() => setSetId(null)}
                      />
                      {mySets.map((s) => (
                        <Chip
                          key={s.id}
                          label={s.title || "…"}
                          selected={setId === s.id}
                          onToggle={() => setSetId(s.id)}
                        />
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="submit"
                    disabled={!body.trim() && !setId}
                    className="min-h-12 rounded-pill bg-brand px-5 text-base font-medium text-brand-ink disabled:opacity-40"
                  >
                    {t("groups.post")}
                  </button>
                </form>
              ) : null}
              {posts.length === 0 ? (
                <EmptyState line={t("groups.noPosts")} />
              ) : (
                <ul className="flex flex-col gap-2">
                  {posts.map((p) => (
                    <li key={p.id} className="rounded-md border border-line bg-surface p-3">
                      <p className="text-sm text-ink-soft">@{p.author?.username ?? "…"}</p>
                      {p.deleted_at ? (
                        <p className="text-base text-ink-soft">
                          <em>{t("groups.takenDown")}</em>
                        </p>
                      ) : (
                        <>
                          {p.body ? (
                            <p className="whitespace-pre-wrap break-words text-base text-ink">
                              {p.body}
                            </p>
                          ) : null}
                          {p.set_id ? (
                            <Link
                              to="/set/$setId"
                              params={{ setId: p.set_id }}
                              className="mt-1 block text-base text-ink underline underline-offset-2"
                            >
                              {p.set_title || "Set"}
                            </Link>
                          ) : null}
                          {p.author_id === me || admin ? (
                            <button
                              type="button"
                              onClick={() =>
                                void takeDown(p.id).then(() => loadPosts(groupId).then(setPosts))
                              }
                              className="mt-2 text-sm text-ink underline underline-offset-2"
                            >
                              {t("groups.takeDown")}
                            </button>
                          ) : null}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {admin ? (
                <div>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("groups.invite")}
                    aria-label={t("groups.invite")}
                    className="min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
                  />
                  {found.length ? (
                    <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
                      {found
                        .filter((p) => !members.some((m) => m.person.user_id === p.user_id))
                        .map((p) => (
                          <li
                            key={p.user_id}
                            className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 last:border-b-0"
                          >
                            <span className="truncate text-base text-ink">@{p.username}</span>
                            <button
                              type="button"
                              onClick={() =>
                                void invite(groupId, p.user_id).then(() => {
                                  setQuery("");
                                  void refresh();
                                })
                              }
                              className="min-h-11 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
                            >
                              {t("groups.inviteGo")}
                            </button>
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <ul className="overflow-hidden rounded-md border border-line bg-surface">
                {members.map((m) => (
                  <li
                    key={m.person.user_id}
                    className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
                  >
                    <Link
                      to="/u/$username"
                      params={{ username: m.person.username }}
                      className="min-w-0 flex-1"
                    >
                      <p className="truncate text-base text-ink">
                        {m.person.display_name?.trim() || m.person.username}
                      </p>
                      <p className="truncate text-sm text-ink-soft">
                        @{m.person.username}
                        {m.role === "admin" ? ` · ${t("groups.admin")}` : ""}
                        {m.state === "invited" ? ` · ${t("groups.invited")}` : ""}
                      </p>
                    </Link>
                    {admin && m.person.user_id !== me ? (
                      <div className="flex shrink-0 gap-2">
                        {m.role !== "admin" && m.state === "joined" ? (
                          <button
                            type="button"
                            onClick={() => void makeAdmin(groupId, m.person.user_id).then(refresh)}
                            className="min-h-11 rounded-pill border border-line bg-surface px-3 text-sm text-ink"
                          >
                            {t("groups.makeAdmin")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void removeMember(groupId, m.person.user_id).then(refresh)}
                          className="min-h-11 rounded-pill border border-line bg-surface px-3 text-sm text-ink"
                        >
                          {t("groups.remove")}
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Tabs>
      </div>

      <Sheet
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={t("groups.leave")}
        description={t("groups.leaveWhy")}
        action={
          <PrimaryButton
            onClick={() => void leaveGroup(groupId).then(() => navigate({ to: "/groups" }))}
          >
            {t("groups.leave")}
          </PrimaryButton>
        }
      />
    </div>
  );
}
