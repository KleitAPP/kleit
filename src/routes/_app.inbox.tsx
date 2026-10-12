import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, Tabs, type TabItem } from "@/components/kleit";
import { t } from "@/i18n/en";
import { Avatar } from "@/social/Avatar";
import { myConversations, type Conversation } from "@/social/messages";
import { markAllRead, myNotifications, type Notification } from "@/social/notifications";

/**
 * S70 — Inbox: Notifications (still honestly empty until M5.6) · Messages (M5.2), with
 * Message requests as their own section at the top of Messages (S72): first messages from
 * people you don't follow back, text only, no read receipts - said on the screen (gap G9).
 */
export const Route = createFileRoute("/_app/inbox")({
  head: () => ({ meta: [{ title: "Inbox" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: InboxTab,
});

type Tab = "notifications" | "messages";
const TABS: readonly TabItem<Tab>[] = [
  { id: "notifications", label: t("inbox.notifications") },
  { id: "messages", label: t("inbox.messages") },
];

function InboxTab() {
  const [tab, setTab] = useState<Tab>("notifications");
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [notes, setNotes] = useState<Notification[] | null>(null);

  useEffect(() => {
    if (tab !== "notifications") return;
    let cancelled = false;
    void myNotifications().then((n) => {
      if (cancelled) return;
      setNotes(n);
      // Seen is read: the list is the acknowledgement.
      if (n.some((x) => !x.read_at)) void markAllRead();
    });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "messages") return;
    let cancelled = false;
    void myConversations().then((c) => !cancelled && setConvs(c));
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const requests = (convs ?? []).filter((c) => c.waitingOnMe);
  const normal = (convs ?? []).filter((c) => !c.waitingOnMe);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("tabs.inbox")}</h1>
      <div className="mt-4">
        <Tabs items={TABS} current={tab} onChange={setTab} label={t("tabs.inbox")}>
          {tab === "notifications" ? (
            !notes ? (
              <div className="kl-skeleton mt-3 h-24 w-full rounded-md bg-surface-2" />
            ) : notes.length === 0 ? (
              <div className="mt-3">
                <EmptyState line={t("inbox.empty")} />
              </div>
            ) : (
              <ul className="mt-3 overflow-hidden rounded-md border border-line bg-surface">
                {notes.map((n) => (
                  <NoteRow key={n.id} n={n} />
                ))}
              </ul>
            )
          ) : !convs ? (
            <div className="kl-skeleton mt-3 h-24 w-full rounded-md bg-surface-2" />
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {requests.length ? (
                <section>
                  <h2 className="text-base font-medium text-ink">{t("inbox.requests")}</h2>
                  <p className="text-sm text-ink-soft">{t("inbox.requestsWhy")}</p>
                  <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
                    {requests.map((c) => (
                      <Row key={c.id} c={c} />
                    ))}
                  </ul>
                </section>
              ) : null}
              {normal.length === 0 ? (
                <EmptyState line={t("inbox.noMessages")} />
              ) : (
                <ul className="overflow-hidden rounded-md border border-line bg-surface">
                  {normal.map((c) => (
                    <Row key={c.id} c={c} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </Tabs>
      </div>
    </div>
  );
}

function noteWords(n: Notification): string {
  const name = n.actor?.username ?? t("notify.someone");
  switch (n.kind) {
    case "vote":
      return n.bundled_count > 1
        ? t("notify.vote", { count: n.bundled_count })
        : t("notify.voteOne");
    case "like":
      return n.bundled_count > 1
        ? t("notify.likeMore", { name, count: n.bundled_count - 1 })
        : t("notify.like", { name });
    case "ask_answer":
      return n.bundled_count > 1
        ? t("notify.ask_answerMore", { count: n.bundled_count })
        : t("notify.ask_answer", { name });
    case "message":
      return n.bundled_count > 1
        ? t("notify.messageMore", { name, count: n.bundled_count })
        : t("notify.message", { name });
    default:
      return t(`notify.${n.kind}`, { name });
  }
}

function NoteRow({ n }: { n: Notification }) {
  const when = new Date(n.updated_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const cls = "block min-h-12 px-4 py-3";
  const inner = (
    <>
      <p className={`text-base ${n.read_at ? "text-ink-soft" : "text-ink"}`}>{noteWords(n)}</p>
      <p className="text-sm text-ink-soft">{when}</p>
    </>
  );
  let link: React.ReactNode;
  if (n.ref_type === "set" && n.ref_id)
    link = (
      <Link to="/set/$setId" params={{ setId: n.ref_id }} className={cls}>
        {inner}
      </Link>
    );
  else if (n.ref_type === "poll" && n.ref_id)
    link = (
      <Link to="/poll/$pollId" params={{ pollId: n.ref_id }} className={cls}>
        {inner}
      </Link>
    );
  else if (n.ref_type === "conversation" && n.ref_id)
    link = (
      <Link to="/inbox/$conversationId" params={{ conversationId: n.ref_id }} className={cls}>
        {inner}
      </Link>
    );
  else if (n.ref_type === "ask" && n.ref_id)
    link = (
      <Link to="/asks/$askId" params={{ askId: n.ref_id }} className={cls}>
        {inner}
      </Link>
    );
  else if (n.ref_type === "contest" && n.ref_id)
    link = (
      <Link to="/contests/$contestId" params={{ contestId: n.ref_id }} className={cls}>
        {inner}
      </Link>
    );
  else if (n.ref_type === "group" && n.ref_id)
    link = (
      <Link to="/groups/$groupId" params={{ groupId: n.ref_id }} className={cls}>
        {inner}
      </Link>
    );
  else if (n.ref_type === "item" && n.ref_id)
    link = (
      <Link to="/item/$itemId" params={{ itemId: n.ref_id }} className={cls}>
        {inner}
      </Link>
    );
  else if (n.kind === "follow_request")
    link = (
      <Link to="/you/people" className={cls}>
        {inner}
      </Link>
    );
  else if (n.ref_type === "report")
    link = (
      <Link to="/settings/reports" className={cls}>
        {inner}
      </Link>
    );
  else if (n.ref_type === "strike")
    link = (
      <Link to="/settings/strikes" className={cls}>
        {inner}
      </Link>
    );
  else if (n.ref_type === "profile" && n.actor)
    link = (
      <Link to="/u/$username" params={{ username: n.actor.username }} className={cls}>
        {inner}
      </Link>
    );
  else link = <div className={cls}>{inner}</div>;
  return <li className="border-b border-line last:border-b-0">{link}</li>;
}

function Row({ c }: { c: Conversation }) {
  const name = c.other.display_name?.trim() ? c.other.display_name : c.other.username;
  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        to="/inbox/$conversationId"
        params={{ conversationId: c.id }}
        className="flex min-h-12 items-center gap-3 px-4 py-3"
      >
        <Avatar itemId={c.other.avatar_item_id} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base text-ink">
            {name}
            {c.state === "request" ? (
              <span className="ml-2 rounded-pill border border-line px-2 py-0.5 text-xs text-ink-soft">
                {t("inbox.request")}
              </span>
            ) : null}
          </p>
          <p className="truncate text-sm text-ink-soft">
            {c.last === "" ? t("inbox.unavailable") : (c.last ?? `@${c.other.username}`)}
          </p>
        </div>
      </Link>
    </li>
  );
}
