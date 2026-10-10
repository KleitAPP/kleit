import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";
import { appeal as sendAppeal, myStrikes, type Strike } from "@/safety/moderation";
import { signOutEverywhereOnThisPhone } from "@/auth/signOut";

/**
 * The suspended account's one screen (M7.2; spec 13.4 #3). Plain words, the strikes that led
 * here, one appeal each, and Sign out. Nothing else in the app opens for a banned account.
 */
export const Route = createFileRoute("/suspended")({
  head: () => ({
    meta: [{ title: "Account suspended" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Suspended,
});

function Suspended() {
  const navigate = useNavigate();
  const [strikes, setStrikes] = useState<Strike[]>([]);
  const [body, setBody] = useState("");
  async function refresh() {
    setStrikes(await myStrikes());
  }
  useEffect(() => {
    void refresh();
  }, []);
  const appealable = strikes.find((s) => !s.appeal_state && Date.parse(s.expires_at) > Date.now());
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pt-12 pb-8">
      <h1 className="font-display text-3xl text-ink">{t("suspended.title")}</h1>
      <p className="mt-3 text-base text-ink">{t("suspended.why")}</p>
      <p className="mt-2 text-sm text-ink-soft">{t("suspended.rules")}</p>
      {strikes.length ? (
        <ul className="mt-4 flex flex-col gap-2">
          {strikes.map((s) => (
            <li
              key={s.id}
              className="rounded-md border border-line bg-surface p-3 text-sm text-ink"
            >
              {s.reason || t("strikes.community")}
              {s.appeal_state ? (
                <span className="text-ink-soft"> · {t(`strikes.appeal.${s.appeal_state}`)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {appealable ? (
        <form
          className="mt-4 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void sendAppeal(appealable.id, body).then(() => {
              setBody("");
              void refresh();
            });
          }}
        >
          <input
            type="text"
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("strikes.appealHint")}
            aria-label={t("strikes.appealHint")}
            className="min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
          <button
            type="submit"
            disabled={!body.trim()}
            className="min-h-12 rounded-pill bg-brand px-5 text-base font-medium text-brand-ink disabled:opacity-60"
          >
            {t("strikes.appeal")}
          </button>
        </form>
      ) : null}
      <button
        type="button"
        onClick={() => void signOutEverywhereOnThisPhone().then(() => navigate({ to: "/welcome" }))}
        className="mt-8 min-h-12 rounded-pill border border-line bg-surface px-5 text-base text-ink"
      >
        {t("you.signOut")}
      </button>
    </main>
  );
}
