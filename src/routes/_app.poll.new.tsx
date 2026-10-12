import { createFileRoute } from "@tanstack/react-router";

import { PollBuilder } from "@/polls/PollBuilder";

/** S52 — a new "which one?" poll (roadmap M3.7). `?set=` pre-picks the set it was opened from (S47). */
export const Route = createFileRoute("/_app/poll/new")({
  validateSearch: (raw: Record<string, unknown>): { set?: string } =>
    typeof raw["set"] === "string" && /^[0-9a-f-]{36}$/i.test(raw["set"])
      ? { set: raw["set"] }
      : {},
  head: () => ({
    meta: [{ title: "Which one?" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: NewPoll,
});

function NewPoll() {
  const { set } = Route.useSearch();
  return <PollBuilder {...(set ? { startWith: set } : {})} />;
}
