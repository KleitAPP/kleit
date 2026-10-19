import { supabase } from "@/integrations/supabase/client";
import { looksLikeAnEmail } from "@/auth/codes";

/**
 * Sign-in methods and changing your email (spec 3.6 #1, #2, #4; CL66).
 *
 * Supabase keeps one "identity" per way in: the email address, a Google account, later Apple.
 * Linking a second one is the recovery path the spec asks for (3.6 #2) - lose the inbox, keep
 * the account - and it is Supabase's own identity linking, so a Google account already used for
 * a DIFFERENT Kleit account is refused by the server, not merged.
 *
 * Changing the email: Supabase emails the NEW address a code (or a link, while the email
 * template is Supabase's own - CL21) and, with secure email change on (the default), the OLD
 * address too - and the address moves only once BOTH have answered, which is what keeps a
 * stolen session from walking off with the account (3.6 #4; the "Wasn't you? Lock my account"
 * line in that email is CL43). The screen asks for the two codes one after the other; a link in
 * either email counts as that side's answer.
 */
export type Method = {
  provider: "email" | "google" | "apple" | string;
  id: string;
  email: string | null;
};

export async function signInMethods(): Promise<Method[] | null> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error || !data) return null;
  return data.identities.map((i) => ({
    provider: i.provider,
    id: i.identity_id,
    email: (i.identity_data?.["email"] as string | undefined) ?? null,
  }));
}

export type LinkResult = { ok: true } | { ok: false; problem: "off" | "taken" | "unknown" };

/** Sends the person to Google and back to the Account screen with the account linked. */
export async function linkGoogle(): Promise<LinkResult> {
  const { error } = await supabase.auth.linkIdentity({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/settings/account`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (!error) return { ok: true };
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("manual linking")) return { ok: false, problem: "off" };
  if (message.includes("already")) return { ok: false, problem: "taken" };
  return { ok: false, problem: "unknown" };
}

/** Refused by the server when it is the last way in; the screen hides the button then too. */
export async function unlinkMethod(method: Method): Promise<boolean> {
  const { data } = await supabase.auth.getUserIdentities();
  const identity = data?.identities.find((i) => i.identity_id === method.id);
  if (!identity) return false;
  const { error } = await supabase.auth.unlinkIdentity(identity);
  return !error;
}

export type EmailChangeResult =
  { ok: true } | { ok: false; problem: "bad-address" | "same" | "taken" | "too-many" | "unknown" };

export async function startEmailChange(
  current: string | null,
  next: string,
): Promise<EmailChangeResult> {
  const email = next.trim().toLowerCase();
  if (!looksLikeAnEmail(email)) return { ok: false, problem: "bad-address" };
  if (current && email === current.toLowerCase()) return { ok: false, problem: "same" };
  const { error } = await supabase.auth.updateUser({ email });
  if (!error) return { ok: true };
  const message = (error.message ?? "").toLowerCase();
  if (error.status === 429 || message.includes("rate") || message.includes("too many"))
    return { ok: false, problem: "too-many" };
  if (message.includes("already") || message.includes("registered"))
    return { ok: false, problem: "taken" };
  if (message.includes("invalid")) return { ok: false, problem: "bad-address" };
  return { ok: false, problem: "unknown" };
}

/** The code from the email to the new address. The link in that email works on its own. */
export async function confirmEmailChange(
  newEmail: string,
  code: string,
): Promise<
  { ok: true; email: string | null } | { ok: false; problem: "wrong-code" | "expired" | "unknown" }
> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: newEmail.trim().toLowerCase(),
    token: code,
    type: "email_change",
  });
  if (!error) return { ok: true, email: data.user?.email ?? null };
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("expired")) return { ok: false, problem: "expired" };
  if (message.includes("invalid") || message.includes("token"))
    return { ok: false, problem: "wrong-code" };
  return { ok: false, problem: "unknown" };
}
