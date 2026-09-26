import { createFileRoute } from "@tanstack/react-router";

import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * Search, present from day one and honest about it (design pack gap G7).
 * The tab ships at M1 with a plain line rather than appearing halfway through the build and
 * shoving every other tab sideways. It fills up at M6.
 */
export const Route = createFileRoute("/_app/search")({
  head: () => ({ meta: [{ title: "Search" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: SearchTab,
});

function SearchTab() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("tabs.search")}</h1>
      <EmptyState line={t("search.empty")} />
    </div>
  );
}
