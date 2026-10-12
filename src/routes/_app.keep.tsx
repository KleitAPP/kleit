import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { KleitMark } from "@/brand/KleitMark";
import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";
import { keepPieces, type KeepResult } from "@/sets/keep";

/**
 * /keep?pieces=<ids> — the landing for "Keep it" on a brand's site (roadmap M9.2; OW23 a).
 *
 * The brand page never writes anything; it sends the person here with the piece ids in the
 * link. Signed out, the app shell keeps the link and brings them back after sign-in; signed in,
 * this screen makes the draft and opens the editor on it. There is nothing to tap here on the
 * happy path: a mark while the draft is made, then the editor. Only a link that comes to nothing
 * shows a line and a way home.
 */
export const Route = createFileRoute("/_app/keep")({
  head: () => ({ meta: [{ title: "Kleit" }, { name: "robots", content: "noindex, nofollow" }] }),
  validateSearch: (search: Record<string, unknown>): { pieces: string } => ({
    pieces: typeof search["pieces"] === "string" ? search["pieces"].slice(0, 200) : "",
  }),
  component: Keep,
});

const PROBLEM_WORDS = {
  "bad-link": t("keep.badLink"),
  offline: t("keep.offline"),
  "none-available": t("keep.noneAvailable"),
  failed: t("keep.failed"),
} as const;

function Keep() {
  const { pieces } = Route.useSearch();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<Exclude<KeepResult, { setId: string }>["problem"] | null>(
    null,
  );
  // One draft per link, however many times this screen renders.
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (started.current === pieces) return;
    started.current = pieces;
    let cancelled = false;
    void keepPieces(pieces).then((result) => {
      if (cancelled) return;
      if ("setId" in result) {
        void navigate({ to: "/set/$setId/edit", params: { setId: result.setId }, replace: true });
      } else {
        setProblem(result.problem);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pieces, navigate]);

  if (problem) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-16">
        <EmptyState
          line={PROBLEM_WORDS[problem]}
          actionLabel={t("keep.home")}
          onAction={() => void navigate({ to: "/", replace: true })}
        />
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
