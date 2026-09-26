import { createFileRoute } from "@tanstack/react-router";

import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * Inbox, present from day one and honest about it (design pack gap G7).
 * Notifications only until M5, when messages arrive.
 */
export const Route = createFileRoute("/_app/inbox")({
  head: () => ({ meta: [{ title: "Inbox" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: InboxTab,
});

function InboxTab() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("tabs.inbox")}</h1>
      <EmptyState line={t("inbox.empty")} />
    </div>
  );
}
