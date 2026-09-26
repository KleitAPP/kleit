import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { checkCode, sendCode, tidyCode, type CodeProblem } from "@/auth/codes";
import { whereDoIBelong } from "@/auth/session";
import { t } from "@/i18n/en";

/**
 * S7 - Code entry (design pack W2, state table row "S7 Code").
 *
 * Six boxes that advance on their own, accept a pasted "418 293" straight from the email, and
 * accept iPhone's autofill (that is what `autocomplete="one-time-code"` on the first box buys).
 * The code is checked as soon as the sixth digit lands - asking someone to type six digits and
 * then press a button is a tap we do not need.
 *
 * Wrong codes are limited per device by Supabase (ten tries per five minutes from one internet
 * connection), not per email address, so nobody can lock you out of your own account.
 */
const RESEND_AFTER_SECONDS = 60;

export const Route = createFileRoute("/join/code")({
  validateSearch: (search: Record<string, unknown>): { email: string } => ({
    email: typeof search["email"] === "string" ? search["email"] : "",
  }),
  head: () => ({ meta: [{ title: "Check your email" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: CodeEntry,
});

const PROBLEM_TEXT: Record<CodeProblem, string> = {
  "wrong-code": t("code.wrong"),
  expired: t("code.expired"),
  "too-many": t("code.tooMany"),
  "no-account": t("email.noAccount"),
  offline: t("code.offline"),
  unknown: t("code.unknown"),
};

function CodeEntry() {
  const { email } = Route.useSearch();
  const navigate = useNavigate();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<CodeProblem | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_AFTER_SECONDS);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const tick = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(tick);
  }, [secondsLeft]);

  async function submit(code: string) {
    setChecking(true);
    setProblem(null);
    const result = await checkCode(email, code);
    setChecking(false);
    if (result.ok) {
      // A first sign-up has no profile yet and continues at the username screen; someone coming
      // back has one and goes to Home. The front door asks the same question for the people who
      // arrive by clicking the link in the email instead.
      const where = await whereDoIBelong();
      void navigate({ to: where === "needs-username" ? "/join/username" : "/" });
      return;
    }
    setProblem(result.problem);
    setDigits(["", "", "", "", "", ""]);
    boxes.current[0]?.focus();
  }

  /** Writes `value` into the boxes from `start` onwards, so one pasted code fills all six. */
  function place(start: number, value: string) {
    const clean = tidyCode(value);
    if (clean === "") return;
    const next = [...digits];
    for (let i = 0; i < clean.length && start + i < 6; i++) next[start + i] = clean[i] ?? "";
    setDigits(next);
    const filled = Math.min(start + clean.length, 5);
    boxes.current[filled]?.focus();
    // Every box holds exactly one digit, or we are not finished. The previous version joined the
    // digits first and then asked `!whole.includes("")` - and "418293".includes("") is ALWAYS true
    // in JavaScript, so the check could never pass and the code was never sent. Sign-up was dead
    // at this screen for everyone (lesson L25).
    if (next.every((d) => d.length === 1)) void submit(next.join(""));
  }

  async function resend() {
    setSecondsLeft(RESEND_AFTER_SECONDS);
    setProblem(null);
    setDigits(["", "", "", "", "", ""]);
    const result = await sendCode(email);
    if (!result.ok) setProblem(result.problem);
    boxes.current[0]?.focus();
  }

  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-6 pt-12">
      <div className="mx-auto w-full max-w-sm flex-1">
        <h1 className="font-display text-2xl text-ink">{t("code.title")}</h1>
        <p className="mt-2 text-base text-ink-soft">
          {t("code.sentTo", { email })}{" "}
          <Link to="/join/email" className="underline underline-offset-2 text-ink">
            {t("code.change")}
          </Link>
        </p>

        <div className="mt-8 flex justify-between gap-2">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                boxes.current[i] = el;
              }}
              value={digit}
              disabled={checking}
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              aria-label={t("code.label", { n: i + 1 })}
              maxLength={6}
              onChange={(e) => place(i, e.target.value)}
              onPaste={(e) => {
                e.preventDefault();
                place(0, e.clipboardData.getData("text"));
              }}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && digit === "" && i > 0) boxes.current[i - 1]?.focus();
              }}
              className="min-h-14 w-full rounded-sm border border-line bg-surface text-center text-2xl text-ink disabled:opacity-50"
            />
          ))}
        </div>

        {problem ? <p className="mt-4 text-sm text-danger">{PROBLEM_TEXT[problem]}</p> : null}

        <button
          type="button"
          disabled={secondsLeft > 0}
          onClick={() => void resend()}
          className="mt-6 min-h-12 text-base text-ink underline underline-offset-2 disabled:text-ink-soft disabled:no-underline"
        >
          {secondsLeft > 0 ? t("code.resendIn", { seconds: secondsLeft }) : t("code.resend")}
        </button>
      </div>
    </main>
  );
}
