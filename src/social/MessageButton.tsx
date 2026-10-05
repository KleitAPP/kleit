import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import type { Person } from "@/social/follows";
import { conversationWith, send, type SendProblem } from "@/social/messages";

/**
 * "Message" on someone's profile (M5.2): opens the conversation you already have, or asks for
 * the first line in a sheet and sends it - the database decides whether it lands as a request.
 */
export function MessageButton({ them, me }: { them: Person; me: string | null }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SendProblem | null>(null);

  if (!me || me === them.user_id) return null;

  async function tap() {
    setBusy(true);
    const existing = await conversationWith(them.user_id);
    setBusy(false);
    if (existing)
      void navigate({ to: "/inbox/$conversationId", params: { conversationId: existing } });
    else setOpen(true);
  }

  async function first() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await send(them.user_id, draft);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    const id = await conversationWith(them.user_id);
    setOpen(false);
    if (id) void navigate({ to: "/inbox/$conversationId", params: { conversationId: id } });
  }

  const words: Record<SendProblem, string> = {
    refused: t("dm.refused", { name: them.username }),
    no_links_yet: t("dm.noLinksYet"),
    too_many: t("dm.tooMany"),
    failed: t("dm.failed"),
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void tap()}
        disabled={busy}
        className="min-h-12 rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink"
      >
        {t("dm.message")}
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t("dm.newTo", { name: them.username })}
        description={t("inbox.requestsWhy")}
        action={
          <PrimaryButton onClick={() => void first()} disabled={busy || !draft.trim()}>
            {t("dm.send")}
          </PrimaryButton>
        }
      >
        <input
          type="text"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("dm.placeholder")}
          aria-label={t("dm.placeholder")}
          className="min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
        />
        {problem ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {words[problem]}
          </p>
        ) : null}
      </Sheet>
    </>
  );
}
