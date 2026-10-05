import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, Tabs, type TabItem } from "@/components/kleit";
import { t } from "@/i18n/en";
import { myConversations, type Conversation } from "@/social/messages";

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
  const [tab, setTab] = useState<Tab>("messages");
  const [convs, setConvs] = useState<Conversation[] | null>(null);

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
            <div className="mt-3">
              <EmptyState line={t("inbox.empty")} />
            </div>
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

function Row({ c }: { c: Conversation }) {
  const name = c.other.display_name?.trim() ? c.other.display_name : c.other.username;
  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        to="/inbox/$conversationId"
        params={{ conversationId: c.id }}
        className="flex min-h-12 items-center gap-3 px-4 py-3"
      >
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
