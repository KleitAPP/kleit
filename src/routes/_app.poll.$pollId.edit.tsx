import { createFileRoute } from "@tanstack/react-router";

import { PollBuilder } from "@/polls/PollBuilder";

/** S52 again, for a poll with no vote yet (or one just reopened after the warning). */
export const Route = createFileRoute("/_app/poll/$pollId/edit")({
  head: () => ({
    meta: [{ title: "Edit poll" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: EditPoll,
});

function EditPoll() {
  const { pollId } = Route.useParams();
  return <PollBuilder pollId={pollId} />;
}
