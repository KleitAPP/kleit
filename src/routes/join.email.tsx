import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { sendCode, looksLikeAnEmail } from "@/auth/codes";
import { botCheckToken } from "@/auth/turnstile";
import { PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * S6 - Email entry (design pack section 2.1, flow 4.1).
 * One field, one button. The bot check runs invisibly while the person is still reading, so it
 * costs them nothing (spec 3.1 #5: Turnstile, never a puzzle).
 */
export const Route = createFileRoute("/join/email")({
  validateSearch: (search: Record<string, unknown>): { mode?: "signin" } =>
    search["mode"] === "signin" ? { mode: "signin" } : {},
  head: () => ({ meta: [{ title: "Your email" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: EmailEntry,
});

function EmailEntry() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const botCheckHost = useRef<HTMLDivElement>(null);

  const address = email.trim().toLowerCase();
  const ready = looksLikeAnEmail(address) && !sending;

  async function send() {
    setSending(true);
    setProblem(null);
    const token = botCheckHost.current ? await botCheckToken(botCheckHost.current) : undefined;
    const result = await sendCode(address, token);
    setSending(false);
    if (result.ok) {
      void navigate({ to: "/join/code", search: { email: address } });
      return;
    }
    setProblem(result.problem === "offline" ? t("join.offline") : t("join.failed"));
  }

  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-6 pt-12">
      <div className="mx-auto w-full max-w-sm flex-1">
        <h1 className="font-display text-2xl text-ink">{t("email.title")}</h1>
        <p className="mt-2 text-base text-ink-soft">{t("email.hint")}</p>

        <label htmlFor="email" className="mt-8 block text-sm text-ink-soft">
          {t("email.label")}
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) void send();
          }}
          className="mt-2 min-h-12 w-full rounded-sm border border-line bg-surface px-4 text-base text-ink"
        />
        {problem ? <p className="mt-3 text-sm text-danger">{problem}</p> : null}

        <div className="mt-6">
          <PrimaryButton disabled={!ready} onClick={() => void send()}>
            {sending ? t("loading") : t("email.send")}
          </PrimaryButton>
        </div>

        {/* The invisible bot check renders here. It only ever becomes visible if Cloudflare
            decides this visitor needs a moment of interaction. */}
        <div ref={botCheckHost} className="mt-4" />
      </div>
    </main>
  );
}
