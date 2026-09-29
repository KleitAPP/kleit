import { createFileRoute } from "@tanstack/react-router";

import { PollBuilder } from "@/polls/PollBuilder";

/** S52 — a new "which one?" poll (roadmap M3.7). */
export const Route = createFileRoute("/_app/poll/new")({
  head: () => ({
    meta: [{ title: "Which one?" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: () => <PollBuilder />,
});
