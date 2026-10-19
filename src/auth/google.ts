/**
 * Google sign-in (roadmap M1.6; spec 3.1 #2).
 *
 * Supabase does the whole dance; the app's part is two lines and one decision - where Google
 * sends the person back to. That is the site's front door, because the front door already knows
 * how to tell a finished account from a half-finished one (`whereDoIBelong`). Sending them
 * straight to a screen would mean guessing, and the guess would be wrong for anyone whose
 * sign-up was interrupted.
 *
 * The 18+ and Terms box is NOT enforced here, and that is deliberate rather than forgotten.
 * Google can hand us a brand-new person from either door, including the sign-in one, and an OAuth
 * account is created by Supabase before any of our code runs - so a gate on this button would
 * have a hole beside it. The gate that actually holds is on the username screen, which every new
 * account must pass through and which is where the 18+ record is written. Same lesson as the day
 * signing in could create an account without the box (L25): put the check where the account is
 * really made, not where it looks tidiest.
 */
import { supabase } from "@/integrations/supabase/client";

export async function continueWithGoogle(
  /** Where Google sends the person back to; the front door unless a screen has its own reason. */
  backTo: string = "/",
): Promise<{ ok: true } | { ok: false }> {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${backTo}`,
        // Ask for an account choice every time. Without it a shared phone signs the last person
        // back in silently, which on a phone people hand around is a privacy bug, not a feature.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
