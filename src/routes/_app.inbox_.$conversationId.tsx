import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import { ReportButton } from "@/safety/ReportButton";
import { me } from "@/social/follows";
import {
  acceptRequest,
  conversation,
  leave,
  listen,
  messagesOf,
  send,
  takeBack,
  type Conversation,
  type Message,
  type SendProblem,
} from "@/social/messages";

/**
 * S71 — one conversation (M5.2). Text only. A request shows Accept / Decline to the person who
 * received it; the sender sees that it is waiting. New rows arrive live; a message taken back
 * shows "Message unavailable" rather than vanishing (spec 10.2; technical pack row 30).
 */
export const Route = createFileRoute("/_app/inbox_/$conversationId")({
  head: () => ({ meta: [{ title: "Message" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: ConversationScreen,
});

function ConversationScreen() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const [my, setMy] = useState<string | null>(null);
  const [conv, setConv] = useState<Conversation | null | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SendProblem | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const bottom = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [who, c, list] = await Promise.all([
        me(),
        conversation(conversationId),
        messagesOf(conversationId),
      ]);
      if (cancelled) return;
      setMy(who);
      setConv(c);
      setMessages(list);
    })();
    const stop = listen(conversationId, (m) =>
      setMessages((list) => {
        const i = list.findIndex((x) => x.id === m.id);
        if (i === -1) return [...list, m];
        const next = [...list];
        next[i] = m;
        return next;
      }),
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, [conversationId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (conv === undefined) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!conv) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("profile.notFound")} />
      </div>
    );
  }
  const name = conv.other.display_name?.trim() ? conv.other.display_name : conv.other.username;

  async function submit() {
    if (!conv || !draft.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await send(conv.other.user_id, draft);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setDraft("");
    // The live channel brings the row; refresh once in case it was slower than we are.
    setMessages(await messagesOf(conversationId));
    if (conv.state === "request" && conv.waitingOnMe)
      setConv({ ...conv, state: "normal", waitingOnMe: false });
  }

  const words: Record<SendProblem, string> = {
    refused: t("dm.refused", { name: conv.other.username }),
    no_links_yet: t("dm.noLinksYet"),
    too_many: t("dm.tooMany"),
    failed: t("dm.failed"),
  };

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-xl flex-col px-4 pt-6 pb-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="truncate font-display text-xl text-ink">
          {name} <span className="text-base text-ink-soft">@{conv.other.username}</span>
        </h1>
        <div className="flex shrink-0 gap-2">
          <ReportButton
            type="conversation"
            id={conversationId}
            className="min-h-11 rounded-pill border border-line bg-surface px-3 text-sm text-ink"
          />
          <button
            type="button"
            onClick={() => setConfirmLeave(true)}
            className="min-h-11 shrink-0 rounded-pill border border-line bg-surface px-3 text-sm text-ink"
          >
            {t("dm.leave")}
          </button>
        </div>
      </div>

      {conv.state === "request" ? (
        <div className="mt-3 rounded-md border border-line bg-surface p-3 text-sm text-ink">
          {conv.waitingOnMe ? (
            <>
              <p>{t("dm.requestBanner", { name: conv.other.username })}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void acceptRequest(conv.id).then(
                      (ok) => ok && setConv({ ...conv, state: "normal", waitingOnMe: false }),
                    )
                  }
                  className="min-h-11 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
                >
                  {t("dm.accept")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void leave(conv.id).then((ok) => {
                      if (ok) void navigate({ to: "/inbox" });
                    })
                  }
                  className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
                >
                  {t("dm.decline")}
                </button>
              </div>
            </>
          ) : (
            <p>{t("dm.youAsked", { name: conv.other.username })}</p>
          )}
        </div>
      ) : null}

      <ul className="mt-3 flex flex-1 flex-col gap-2" aria-live="polite">
        {messages.map((m) => {
          const mine = m.sender_id === my;
          return (
            <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-md px-3 py-2 text-base ${
                  mine ? "bg-brand text-brand-ink" : "border border-line bg-surface text-ink"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">
                  {m.deleted_at ? <em>{t("inbox.unavailable")}</em> : m.body}
                </p>
                {mine && !m.deleted_at ? (
                  <button
                    type="button"
                    onClick={() => void takeBack(m.id)}
                    className="mt-1 text-xs underline underline-offset-2 opacity-80"
                  >
                    {t("dm.takeBack")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
        <li ref={bottom} aria-hidden="true" />
      </ul>

      {problem ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {words[problem]}
        </p>
      ) : null}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          type="text"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("dm.placeholder")}
          aria-label={t("dm.placeholder")}
          className="min-h-12 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="min-h-12 rounded-pill bg-brand px-5 text-base font-medium text-brand-ink disabled:opacity-40"
        >
          {t("dm.send")}
        </button>
      </form>

      <Sheet
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={t("dm.leave")}
        description={t("dm.leaveWarn")}
        action={
          <PrimaryButton
            onClick={() =>
              void leave(conv.id).then((ok) => {
                if (ok) void navigate({ to: "/inbox" });
              })
            }
          >
            {t("dm.leave")}
          </PrimaryButton>
        }
      />
    </div>
  );
}
