import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { KleitMark } from "@/brand/KleitMark";
import { EmptyState, ItemCard, PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import { imageUrlFor, priceLabel, type ItemSummary } from "@/items/items";
import { keepPieces, previewKeep, type KeepProblem } from "@/sets/keep";

/**
 * /keep?pieces=<ids> — the landing for "Keep it" on a brand's site (roadmap M9.2; OW23 a).
 *
 * The brand page never writes anything; it sends the person here with the piece ids in the
 * link. Signed out, the app shell keeps the link and brings them back after sign-in. Here they
 * see what the link carries - the pieces, as they may see them - and the draft is made on ONE
 * tap of theirs, never on arrival: a link in a chat does not get to write a set for whoever
 * opens it. Then the editor opens on the draft.
 */
export const Route = createFileRoute("/_app/keep")({
  head: () => ({ meta: [{ title: "Kleit" }, { name: "robots", content: "noindex, nofollow" }] }),
  validateSearch: (search: Record<string, unknown>): { pieces: string } => ({
    pieces: typeof search["pieces"] === "string" ? search["pieces"].slice(0, 200) : "",
  }),
  component: Keep,
});

const PROBLEM_WORDS: Record<KeepProblem, string> = {
  "bad-link": t("keep.badLink"),
  offline: t("keep.offline"),
  "none-available": t("keep.noneAvailable"),
  failed: t("keep.failed"),
};

type Stage =
  | { at: "reading" }
  | { at: "ready"; pieces: Array<ItemSummary & { url: string | null }>; asked: number }
  | { at: "making" }
  | { at: "problem"; problem: KeepProblem };

function Keep() {
  const { pieces } = Route.useSearch();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>({ at: "reading" });

  useEffect(() => {
    let cancelled = false;
    setStage({ at: "reading" });
    void previewKeep(pieces).then(async (preview) => {
      if ("problem" in preview) {
        if (!cancelled) setStage({ at: "problem", problem: preview.problem });
        return;
      }
      const withUrls = await Promise.all(
        preview.pieces.map(async (p) => ({ ...p, url: await imageUrlFor(p) })),
      );
      if (!cancelled) setStage({ at: "ready", pieces: withUrls, asked: preview.asked });
    });
    return () => {
      cancelled = true;
    };
  }, [pieces]);

  // The one tap. The write is not cancelled by a re-render or a navigation: a draft that was
  // made is shown, never left behind unseen.
  const make = (ready: Extract<Stage, { at: "ready" }>) => {
    setStage({ at: "making" });
    void keepPieces(ready.pieces).then((result) => {
      if ("setId" in result) {
        void navigate({ to: "/set/$setId/edit", params: { setId: result.setId }, replace: true });
      } else {
        setStage({ at: "problem", problem: result.problem });
      }
    });
  };

  if (stage.at === "problem") {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-16">
        <EmptyState
          line={PROBLEM_WORDS[stage.problem]}
          actionLabel={t("keep.home")}
          onAction={() => void navigate({ to: "/", replace: true })}
        />
      </div>
    );
  }
  if (stage.at === "ready") {
    const dropped = stage.asked - stage.pieces.length;
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
        <h1 className="font-display text-2xl text-ink">{t("keep.title")}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {t("keep.line", { count: stage.pieces.length })}
        </p>
        {dropped > 0 ? (
          <p className="mt-1 text-sm text-ink-soft">{t("keep.dropped", { count: dropped })}</p>
        ) : null}
        <ul className="mt-4 grid grid-cols-2 gap-3">
          {stage.pieces.map((p) => (
            <li key={p.id} className="min-w-0">
              <ItemCard
                imageSrc={p.url ?? ""}
                imageAlt={p.title ?? ""}
                name={p.title?.trim() || t("item.untitled")}
                {...(priceLabel(p) ? { price: priceLabel(p)! } : {})}
              />
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <PrimaryButton onClick={() => make(stage)}>{t("keep.make")}</PrimaryButton>
        </div>
        <button
          type="button"
          onClick={() => void navigate({ to: "/", replace: true })}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("keep.notNow")}
        </button>
      </div>
    );
  }
  return (
    <div
      className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 bg-canvas"
      role="status"
      aria-busy="true"
    >
      <KleitMark size={48} className="text-ink" />
      <p className="text-base text-ink-soft">{t("keep.bringing")}</p>
    </div>
  );
}
