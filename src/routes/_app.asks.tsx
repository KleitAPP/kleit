import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import { ask as postAsk, openAsks, type Ask } from "@/social/ask";

/** S82 — Ask list: style questions people asked, newest first; ask one (M5.3). */
export const Route = createFileRoute("/_app/asks")({
  head: () => ({ meta: [{ title: "Ask" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Asks,
});

function Asks() {
  const navigate = useNavigate();
  const [asks, setAsks] = useState<Ask[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void openAsks().then((a) => !cancelled && setAsks(a));
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    if (question.trim().length < 3 || busy) return;
    setBusy(true);
    const id = await postAsk(question);
    setBusy(false);
    if (id) void navigate({ to: "/asks/$askId", params: { askId: id } });
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("ask.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("ask.newWhy")}</p>
      <div className="mt-4">
        <PrimaryButton onClick={() => setAsking(true)}>{t("ask.new")}</PrimaryButton>
      </div>
      {!asks ? (
        <div className="kl-skeleton mt-4 h-24 w-full rounded-md bg-surface-2" />
      ) : asks.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("ask.none")} />
        </div>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
          {asks.map((a) => (
            <li key={a.id} className="border-b border-line last:border-b-0">
              <Link to="/asks/$askId" params={{ askId: a.id }} className="block min-h-12 px-4 py-3">
                <p className="text-base text-ink">{a.question}</p>
                <p className="text-sm text-ink-soft">
                  @{a.author?.username ?? "…"} · {t("ask.answers", { count: a.answers })} ·{" "}
                  {a.closed_at ? t("ask.closed") : t("ask.open")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Sheet
        open={asking}
        onOpenChange={setAsking}
        title={t("ask.new")}
        description={t("ask.newWhy")}
        action={
          <PrimaryButton
            onClick={() => void submit()}
            disabled={busy || question.trim().length < 3}
          >
            {t("ask.post")}
          </PrimaryButton>
        }
      >
        <input
          type="text"
          value={question}
          maxLength={200}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("ask.question")}
          aria-label={t("ask.question")}
          className="min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
        />
      </Sheet>
    </div>
  );
}
