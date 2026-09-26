/**
 * Sending and checking the 6-digit sign-in code (roadmap M1.5; spec 3.1 #3).
 *
 * There is no password anywhere in Kleit and no magic link. A code can be read out over the phone,
 * pasted, or autofilled by iPhone from the email - and unlike a link it cannot open in the wrong
 * browser, which is why links were dropped.
 *
 * Wrong codes are limited per device rather than per email address (owner's decision 2026-09-25):
 * Supabase refuses more than ten verifications in five minutes from one internet connection, and a
 * code dies after ten minutes. Limiting per email would let anyone who knows your address lock you
 * out of your own account, which trades one attack for a worse one.
 */
import { supabase } from "@/integrations/supabase/client";

/** What went wrong, in terms the screens can turn into the design pack's wording. */
export type CodeProblem = "wrong-code" | "expired" | "too-many" | "no-account" | "offline" | "unknown";

export type CodeResult = { ok: true } | { ok: false; problem: CodeProblem };

function readProblem(error: {
  message?: string | undefined;
  status?: number | undefined;
  code?: string | undefined;
}): CodeProblem {
  const message = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();
  if (error.status === 429 || message.includes("rate limit") || message.includes("too many")) {
    return "too-many";
  }
  // Supabase says this when shouldCreateUser is false and the address has no account.
  if (code === "otp_disabled" || message.includes("signups not allowed") || message.includes("not found")) {
    return "no-account";
  }
  if (code === "otp_expired" || message.includes("expired")) return "expired";
  if (message.includes("invalid") || message.includes("token")) return "wrong-code";
  if (message.includes("fetch") || message.includes("network")) return "offline";
  return "unknown";
}

/**
 * Sends a fresh code.
 *
 * `makeAccount` is the whole 18+ gate, in one boolean. Signing UP may create an account, because
 * that path is behind the checkbox. Signing IN must never create one: otherwise "Sign in" is a
 * way to make an account without ever agreeing to the Terms or saying you are 18, which is
 * exactly what an independent test of the live site found on 2026-09-26 (lesson L25).
 */
export async function sendCode(
  email: string,
  captchaToken?: string,
  makeAccount = true,
): Promise<CodeResult> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: makeAccount,
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
    if (error) return { ok: false, problem: readProblem(error) };
    return { ok: true };
  } catch {
    return { ok: false, problem: "offline" };
  }
}

/** Checks the code the person typed. On success the session is stored and they are signed in. */
export async function checkCode(email: string, code: string): Promise<CodeResult> {
  try {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) return { ok: false, problem: readProblem(error) };
    return { ok: true };
  } catch {
    return { ok: false, problem: "offline" };
  }
}

/** An address we are willing to send to. Deliberately loose - the real test is whether a code arrives. */
export function looksLikeAnEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 6 && trimmed.length <= 320 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed);
}

/** Six digits, ignoring spaces, so "418 293" pasted from the email works. */
export function tidyCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}
