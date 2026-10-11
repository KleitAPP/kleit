import { supabase } from "@/integrations/supabase/client";

/**
 * The invite-only beta (S111; spec 23.2 #1; migration 087). While `app_settings.beta_only` is
 * on, finishing sign-up needs a live invite code. The database is the gate (`claim_profile`
 * refuses without one); these screens are the courtesy. A code arriving in an invite link
 * (`/welcome?invite=CODE`) is kept in this tab's session storage across the join screens, like
 * the "next" path, so nobody has to type it.
 */
const KEY = "kleit.invite";

/** The shape of a code as the database mints them: eight unambiguous letters and digits. */
export function tidyInvite(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

export async function betaOnly(): Promise<boolean> {
  const { data } = await supabase.rpc("beta_only");
  return data === true;
}

/** Would this code be accepted right now? Nothing is spent by asking. */
export async function checkInvite(code: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("check_beta_invite", { p_code: code });
  if (error) return null;
  return data === true;
}

export function rememberInvite(code: string | undefined): void {
  const tidy = code ? tidyInvite(code) : "";
  if (tidy.length !== 8) return;
  try {
    sessionStorage.setItem(KEY, tidy);
  } catch {
    /* no storage: the person types it on the invite screen */
  }
}

export function peekInvite(): string | null {
  try {
    const code = sessionStorage.getItem(KEY);
    return code && code.length === 8 ? code : null;
  } catch {
    return null;
  }
}

export function forgetInvite(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
