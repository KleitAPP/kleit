import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import {
  answer as sendAnswer,
  choose,
  closeAsk,
  myPublicSets,
  oneAsk,
  takeBackAnswer,
  type Answer,
  type Ask,
} from "@/social/ask";
import { me as whoAmI } from "@/social/follows";

/** S83 — one question, its answers (each a set), the asker's favourite and Close (M5.3). */
export const Route = createFileRoute("/_app/asks_/$askId")({
  head: () => ({ meta: [{ title: "Ask" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: AskPage,
});

function AskPage() {
  const { askId } = Route.useParams();
  const [me, setMe] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null | undefined>(undefined);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [sets, setSets] = useState<{ id: string; title: string }[]>([]);
  const [setId, setSetId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [problem, setProblem] = useState(false);

  async function refresh() {
    const r = await oneAsk(askId);
    setAsk(r?.ask ?? null);
    setAnswers(r?.answers ?? []);
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const who = await whoAmI();
      if (cancelled) return;
      setMe(who);
      await refresh();
      setSets(await myPublicSets());
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askId]);

  if (ask === undefined) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!ask) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("ask.notFound")} />
      </div>
    );
  }
  const mine = ask.author_id === me;
  const open = !ask.closed_at;

  async function submit() {
    if (!setId) return;
    setProblem(false);
    const ok = await sendAnswer(askId, setId, body);
    if (!ok) {
      setProblem(true);
      return;
    }
    setBody("");
    setSetId(null);
    await refresh();
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{ask.question}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        @{ask.author?.username ?? "…"} · {open ? t("ask.open") : t("ask.closed")}
      </p>
      {mine && open ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void closeAsk(askId).then(refresh)}
            className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
          >
            {t("ask.close")}
          </button>
        </div>
      ) : null}

      {!mine && open ? (
        <form
          className="mt-4 flex flex-col gap-2 rounded-md border border-line bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-base text-ink">{t("ask.answerWith")}</p>
          {sets.length === 0 ? (
            <p className="text-sm text-ink-soft">{t("ask.noPublicSets")}</p>
          ) : (
            <div
              className="flex gap-2 overflow-x-auto pb-1"
              role="group"
              aria-label={t("ask.answerWith")}
            >
              {sets.map((s) => (
                <Chip
                  key={s.id}
                  label={s.title || "…"}
                  selected={setId === s.id}
                  onToggle={() => setSetId(setId === s.id ? null : s.id)}
                />
              ))}
            </div>
          )}
          <input
            type="text"
            value={body}
            maxLength={300}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("ask.answerNote")}
            aria-label={t("ask.answerNote")}
            className="min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
          <PrimaryButton onClick={() => void submit()} disabled={!setId}>
            {t("ask.answer")}
          </PrimaryButton>
          {problem ? (
            <p role="alert" className="text-sm text-danger">
              {t("dm.failed")}
            </p>
          ) : null}
        </form>
      ) : null}

      <ul className="mt-4 flex flex-col gap-2">
        {answers.length === 0 ? (
          <li className="text-sm text-ink-soft">{t("ask.noAnswers")}</li>
        ) : null}
        {answers.map((a) => (
          <li
            key={a.id}
            className={`rounded-md border p-3 ${a.chosen ? "border-ink bg-surface-2" : "border-line bg-surface"}`}
          >
            <p className="text-sm text-ink-soft">
              @{a.author?.username ?? "…"}
              {a.chosen ? ` · ${t("ask.chosen")}` : ""}
            </p>
            <Link
              to="/set/$setId"
              params={{ setId: a.set_id }}
              className="mt-1 block text-base text-ink underline underline-offset-2"
            >
              {a.set_title}
            </Link>
            {a.body ? <p className="mt-1 text-base text-ink">{a.body}</p> : null}
            <div className="mt-2 flex gap-3 text-sm">
              {mine && !a.chosen ? (
                <button
                  type="button"
                  onClick={() => void choose(a.id).then(refresh)}
                  className="text-ink underline underline-offset-2"
                >
                  {t("ask.choose")}
                </button>
              ) : null}
              {a.author_id === me ? (
                <button
                  type="button"
                  onClick={() => void takeBackAnswer(a.id).then(refresh)}
                  className="text-ink underline underline-offset-2"
                >
                  {t("ask.takeBack")}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
