import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  claimProfile,
  isUsernameFree,
  suggestUsernames,
  tidyUsername,
  usernameShapeProblem,
} from "@/auth/profile";
import { PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * S8 - Pick a username (design pack W3, flow 4.1 step 5).
 *
 * The answer arrives while you type, so nobody fills in a name, presses Next and only then finds
 * out it is gone. The database decides in the end (migration 003) - this screen is the courtesy.
 * A refusal always comes with two names that would work, because "taken" on its own is a dead end.
 */
export const Route = createFileRoute("/join/username")({
  head: () => ({ meta: [{ title: "Pick your username" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: PickUsername,
});

type Availability = "idle" | "checking" | "free" | "taken" | "offline";

function PickUsername() {
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<Availability>("idle");
  const [claiming, setClaiming] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const name = tidyUsername(typed);
  const shape = name === "" ? null : usernameShapeProblem(name);

  // Ask the database a third of a second after typing stops, not on every keystroke.
  useEffect(() => {
    if (name === "" || shape !== null) {
      setState("idle");
      return;
    }
    setState("checking");
    let cancelled = false;
    const wait = setTimeout(async () => {
      const free = await isUsernameFree(name);
      if (cancelled) return;
      setState(free === null ? "offline" : free ? "free" : "taken");
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(wait);
    };
  }, [name, shape]);

  const ready = state === "free" && !claiming;

  async function take() {
    setClaiming(true);
    setRefusal(null);
    const result = await claimProfile(name, "");
    setClaiming(false);
    if (result.ok) {
      void navigate({ to: "/join/name" });
      return;
    }
    if (result.problem === "taken") {
      setState("taken");
      return;
    }
    if (result.problem === "already-have-one") {
      void navigate({ to: "/" });
      return;
    }
    setRefusal(result.problem === "offline" ? t("username.offline") : t("join.failed"));
  }

  const suggestions = suggestUsernames(name);

  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-6 pt-12">
      <div className="mx-auto w-full max-w-sm flex-1">
        <h1 className="font-display text-2xl text-ink">{t("username.title")}</h1>
        <p className="mt-2 text-base text-ink-soft">
          {t("username.hint", { name: name === "" ? "yourname" : name })}
        </p>

        <label htmlFor="username" className="mt-8 block text-sm text-ink-soft">
          {t("username.label")}
        </label>
        <div className="mt-2 flex items-center gap-2 rounded-sm border border-line bg-surface px-4">
          <span aria-hidden="true" className="text-base text-ink-soft">
            @
          </span>
          <input
            id="username"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready) void take();
            }}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-12 w-full bg-surface text-base text-ink outline-none"
          />
        </div>

        <p aria-live="polite" className="mt-3 min-h-10 text-sm">
          {shape === "too-short" ? <span className="text-ink-soft">{t("username.tooShort")}</span> : null}
          {shape === "too-long" ? <span className="text-ink-soft">{t("username.tooLong")}</span> : null}
          {shape === "characters" ? <span className="text-ink-soft">{t("username.characters")}</span> : null}
          {shape === null && state === "checking" ? (
            <span className="text-ink-soft">{t("username.checking")}</span>
          ) : null}
          {shape === null && state === "free" ? (
            <span className="text-positive">{t("username.free", { name })}</span>
          ) : null}
          {shape === null && state === "taken" ? (
            <span className="text-danger">
              {suggestions.length === 2
                ? t("username.taken", { name, first: suggestions[0] ?? "", second: suggestions[1] ?? "" })
                : t("username.takenPlain", { name })}
            </span>
          ) : null}
          {shape === null && state === "offline" ? (
            <span className="text-warning">{t("username.offline")}</span>
          ) : null}
          {refusal ? <span className="text-danger">{refusal}</span> : null}
        </p>

        <div className="mt-4">
          <PrimaryButton disabled={!ready} onClick={() => void take()}>
            {claiming ? t("loading") : t("username.next")}
          </PrimaryButton>
        </div>
      </div>
    </main>
  );
}
