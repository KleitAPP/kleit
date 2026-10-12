import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { ContestCard } from "@/contests/ContestCard";
import { RecapCard } from "@/contests/RecapCard";
import { Feed } from "@/feed/Feed";
import { t } from "@/i18n/en";

/**
 * S11 — Home (design pack W4; spec 3.4 #1; decision 84).
 *
 * On day one the start cards sit ABOVE the featured feed, not instead of it: a new person needs
 * somewhere to begin, and an empty feed is not a beginning. Each card shrinks to a one-line tick
 * once it is done, and when all three are done they disappear for good and the feed takes over.
 *
 * Clip a link, Snap and the style vibes are real; "Start from a stylist set" returns with the
 * starter sets at M10 (decision 82), because a card that only says "not yet" is a dead button.
 */
export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Kleit" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Home,
});

type Card = { key: string; title: string; why: string; done: boolean; go: () => void };
type Starts = { vibes: boolean; clipped: boolean; snapped: boolean };

/** What the person has done so far: a vibe picked, a piece clipped, three of their own snapped. */
async function starts(): Promise<Starts | null> {
  const { data } = await supabase.auth.getUser();
  const me = data.user?.id;
  if (!me) return null;
  const [profile, clipped, own] = await Promise.all([
    supabase.from("profiles").select("style_vibes").eq("user_id", me).maybeSingle(),
    supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", me)
      .eq("kind", "product"),
    supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", me)
      .eq("kind", "own"),
  ]);
  return {
    vibes: (profile.data?.style_vibes?.length ?? 0) > 0,
    clipped: (clipped.count ?? 0) > 0,
    snapped: (own.count ?? 0) >= 3,
  };
}

function Home() {
  const navigate = useNavigate();
  const [done, setDone] = useState<Starts | null>(null);

  useEffect(() => {
    let cancelled = false;
    void starts().then((s) => !cancelled && setDone(s));
    return () => {
      cancelled = true;
    };
  }, []);

  const cards: Card[] = [
    {
      key: "clip",
      title: t("start.clip"),
      why: t("start.clipWhy"),
      done: done?.clipped === true,
      go: () => void navigate({ to: "/add/link" }),
    },
    {
      key: "snap",
      title: t("start.snap"),
      why: t("start.snapWhy"),
      done: done?.snapped === true,
      go: () => void navigate({ to: "/add/photo" }),
    },
    {
      key: "vibes",
      title: t("start.vibes"),
      why: t("start.vibesWhy"),
      done: done?.vibes === true,
      go: () => void navigate({ to: "/vibes" }),
    },
  ];

  const doneCount = cards.filter((c) => c.done).length;
  // Nothing is drawn until the answer is in: a card that ticks itself a moment after it
  // appeared looks like a glitch, and a finished section must never flash on.
  const allDone = done === null || doneCount === cards.length;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-6 pt-8">
      <h1 className="font-display text-3xl text-ink">Kleit</h1>

      {allDone ? null : (
        <section aria-labelledby="starts" className="mt-6">
          <div className="flex items-baseline justify-between">
            <h2 id="starts" className="font-display text-xl text-ink">
              {t("start.heading")}
            </h2>
            <p className="text-sm text-ink-soft">
              {t("start.progress", { done: doneCount, total: cards.length })}
            </p>
          </div>

          <ul className="mt-3 flex flex-col gap-3">
            {cards.map((card) =>
              card.done ? (
                // Done shrinks to one line with a tick — the card has served its purpose and
                // should stop taking up the screen.
                <li key={card.key} className="flex items-center gap-2 text-sm text-ink-soft">
                  <Check className="size-4 text-positive" aria-hidden="true" />
                  <span>
                    {card.title} · {t("start.done")}
                  </span>
                </li>
              ) : (
                <li key={card.key}>
                  <button
                    type="button"
                    onClick={card.go}
                    className="w-full rounded-md border border-line bg-surface p-4 text-left shadow-card transition-colors duration-fast hover:bg-surface-2"
                  >
                    <p className="text-base font-medium text-ink">{card.title}</p>
                    <p className="mt-1 text-sm text-ink-soft">{card.why}</p>
                  </button>
                </li>
              ),
            )}
          </ul>
        </section>
      )}

      {/* Friday to Monday: the results are in (S94). Then this week's theme. */}
      <RecapCard />
      <ContestCard />

      <section aria-label={t("feed.label")} className="mt-8">
        <Feed />
      </section>
    </div>
  );
}
