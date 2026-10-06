import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Toast } from "@/components/kleit";
import { Feed } from "@/feed/Feed";
import { t } from "@/i18n/en";

/**
 * S11 — Home (design pack W4; spec 3.4 #1; decision 84).
 *
 * On day one the start cards sit ABOVE the featured feed, not instead of it: a new person needs
 * somewhere to begin, and an empty feed is not a beginning. Each card shrinks to a one-line tick
 * once it is done, and when all four are done they disappear for good and the feed takes over.
 *
 * Three of the four need machinery that arrives in M2 and M3, so they say so when tapped rather
 * than doing nothing. Style vibes is real today.
 */
export const Route = createFileRoute("/_app/")({
  head: () => ({ meta: [{ title: "Kleit" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Home,
});

type Card = { key: string; title: string; why: string; done: boolean; go?: () => void };

function Home() {
  const navigate = useNavigate();
  const [vibesPicked, setVibesPicked] = useState<boolean | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.id;
      if (!me) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("style_vibes")
        .eq("user_id", me)
        .maybeSingle();
      if (cancelled) return;
      setVibesPicked((profile?.style_vibes?.length ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards: Card[] = [
    { key: "stylist", title: t("start.stylist"), why: t("start.stylistWhy"), done: false },
    { key: "clip", title: t("start.clip"), why: t("start.clipWhy"), done: false },
    { key: "snap", title: t("start.snap"), why: t("start.snapWhy"), done: false },
    {
      key: "vibes",
      title: t("start.vibes"),
      why: t("start.vibesWhy"),
      done: vibesPicked === true,
      go: () => void navigate({ to: "/vibes" }),
    },
  ];

  const done = cards.filter((c) => c.done).length;
  const allDone = done === cards.length;

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
              {t("start.progress", { done, total: cards.length })}
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
                    onClick={() => (card.go ? card.go() : setNudge(t("start.notYet")))}
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

      <section aria-label={t("feed.label")} className="mt-8">
        <Feed />
      </section>

      {nudge ? <Toast message={nudge} onDismiss={() => setNudge(null)} /> : null}
    </div>
  );
}
