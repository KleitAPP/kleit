import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, ItemCard, PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import { imageUrlFor, priceLabel, type ItemSummary } from "@/items/items";
import {
  answer as sendAnswer,
  choose,
  closeAsk,
  myPublicSets,
  oneAsk,
  startSetWith,
  takeBackAnswer,
  type Answer,
  type Ask,
} from "@/social/ask";
import { me as whoAmI } from "@/social/follows";

/**
 * S83 — one question, its answers (each a set), the asker's favourite and Close (M5.3). A
 * build-around (spec 5.1 #12) shows its locked piece first, offers "Start a set with it" (a
 * Quick draft with the piece in slot 1), and lets you answer only with a public set that has
 * the piece on - the database refuses any other, so the screen offers only those.
 */
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
  const [piece, setPiece] = useState<(ItemSummary & { url: string | null }) | null>(null);
  const [starting, setStarting] = useState(false);
  const [startProblem, setStartProblem] = useState(false);
  const navigate = useNavigate();

  async function refresh() {
    const r = await oneAsk(askId);
    setAsk(r?.ask ?? null);
    setAnswers(r?.answers ?? []);
    setPiece(r?.item ? { ...r.item, url: await imageUrlFor(r.item) } : null);
    return r;
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const who = await whoAmI();
      if (cancelled) return;
      setMe(who);
      const r = await refresh();
      setSets(await myPublicSets(r?.ask.item_id ?? null));
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

  async function startWith() {
    const itemId = ask?.item_id;
    if (!itemId || starting) return;
    setStarting(true);
    setStartProblem(false);
    const setId = await startSetWith(itemId);
    setStarting(false);
    if (setId) void navigate({ to: "/set/$setId/edit", params: { setId } });
    else setStartProblem(true);
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{ask.question}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        @{ask.author?.username ?? "…"} · {open ? t("ask.open") : t("ask.closed")}
      </p>
      {piece ? (
        <section className="mt-4 flex items-start gap-4" aria-label={t("ask.lockedPiece")}>
          <div className="w-32 shrink-0">
            <Link to="/item/$itemId" params={{ itemId: piece.id }}>
              <ItemCard
                imageSrc={piece.url ?? ""}
                imageAlt={piece.title ?? ""}
                name={piece.title?.trim() || t("item.untitled")}
                {...(priceLabel(piece) ? { price: priceLabel(piece)! } : {})}
              />
            </Link>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink-soft">{t("ask.buildAroundWhy")}</p>
            {open ? (
              <button
                type="button"
                disabled={starting}
                onClick={() => void startWith()}
                className="mt-2 min-h-11 rounded-pill border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
              >
                {t("ask.startWith")}
              </button>
            ) : null}
            {startProblem ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {t("ask.startFailed")}
              </p>
            ) : null}
          </div>
        </section>
      ) : ask.item_id ? (
        // The locked piece is no longer one the reader may see (taken down, deleted).
        <p role="status" className="mt-4 text-sm text-ink-soft">
          {t("ask.pieceGone")}
        </p>
      ) : null}
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
          <p className="text-base text-ink">
            {ask.item_id ? t("ask.answerWithPiece") : t("ask.answerWith")}
          </p>
          {sets.length === 0 ? (
            <p className="text-sm text-ink-soft">
              {ask.item_id ? t("ask.noSetsWithPiece") : t("ask.noPublicSets")}
            </p>
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
