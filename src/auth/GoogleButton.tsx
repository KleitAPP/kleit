import { useState } from "react";

import { continueWithGoogle } from "@/auth/google";
import { t } from "@/i18n/en";

/**
 * "Continue with Google" (design pack §2.1, S4/S5).
 *
 * The mark is drawn here rather than loaded from Google's CDN: an artifact-shaped page has no
 * outside images, and one 500-byte path beats a network request people wait on. Google's brand
 * terms require their own four colours and no recolouring, so this is the one button in Kleit
 * whose icon deliberately ignores the theme (the same exception the sign-in email makes).
 */
export function GoogleButton({ disabled = false }: { disabled?: boolean }) {
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function go() {
    setStarting(true);
    setFailed(false);
    const result = await continueWithGoogle();
    // On success the browser is already leaving for Google, so there is nothing to undo.
    if (!result.ok) {
      setStarting(false);
      setFailed(true);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={disabled || starting}
        onClick={() => void go()}
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-50"
      >
        <GoogleMark />
        {starting ? t("loading") : t("join.withGoogle")}
      </button>
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-ink-soft">
          {t("join.googleFailed")}
        </p>
      ) : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.5 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.2-.4-4.6H24v9.1h12.4c-.5 2.9-2.2 5.3-4.6 7l7.6 5.9c4.4-4.1 6.7-10.1 6.7-17.4z" />
      <path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.3 0-11.7-4-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
