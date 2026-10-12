/**
 * Where a signed-in person belongs (roadmap M1.5, M1.7).
 *
 * Two doors lead into the app and both end here. The designed one is the 6-digit code (S7). The
 * other is the sign-in link in the email, which Supabase sends and which we cannot turn off on
 * the free tier - it signs the person in and drops them on the site's front door with no idea
 * whether sign-up was ever finished.
 *
 * So the app never assumes. It asks two questions: are you signed in, and do you have a profile?
 *
 * The two questions fail in OPPOSITE directions on purpose:
 *  - "are you signed in" fails CLOSED. If we cannot read the session at all (private browsing,
 *    blocked cookies, storage switched off - the browser throws instead of answering), the honest
 *    answer is "we do not know who you are", and that must send the person to the front door.
 *    Treating a thrown error as "signed in" would let a stranger open the app shell.
 *  - "do you have a profile" fails OPEN. Sending someone who already has a username back to
 *    "pick a username" is worse than letting them through to a screen that works, and the screens
 *    behind it are protected by the database's own rules anyway.
 */
import { supabase } from "@/integrations/supabase/client";

export type Landing = "signed-out" | "needs-username" | "ready" | "suspended" | "deleting";

/** Same deadline idea as the launch check: never leave someone on a blank screen for ever. */
const LOOKUP_TIMEOUT_MS = 4_000;

/**
 * Fails closed: anything we cannot read counts as nobody signed in - with one exception written
 * for the phone with no signal (M8.5): a session that cannot be REFRESHED because the network is
 * away is still the same person, so the id remembered from the last good sign-in stands in. The
 * server refuses every write anyway until a real token is back, so this opens nothing.
 */
const LAST_SIGNED_IN = "kleit.lastSignedIn";

async function whoIsSignedIn(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    const id = data.session?.user?.id ?? null;
    if (!error && id) {
      try {
        localStorage.setItem(LAST_SIGNED_IN, id);
      } catch {
        // Storage refused: the offline stand-in is simply not available.
      }
      return id;
    }
    if (error && typeof navigator !== "undefined" && navigator.onLine === false) {
      try {
        return localStorage.getItem(LAST_SIGNED_IN);
      } catch {
        return null;
      }
    }
    if (error) return null;
    return id;
  } catch {
    return null;
  }
}

/** On sign-out the stand-in goes too. */
export function forgetSignedIn(): void {
  try {
    localStorage.removeItem(LAST_SIGNED_IN);
  } catch {
    // Nothing to forget.
  }
}

export async function whereDoIBelong(): Promise<Landing> {
  const me = await whoIsSignedIn();
  if (!me) return "signed-out";

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("user_id, deactivated_at, banned_at")
      .eq("user_id", me)
      .abortSignal(controller.signal)
      .maybeSingle();

    // If we cannot tell, assume the profile exists (see the note at the top of the file).
    if (error) return "ready";
    if (profile?.banned_at) return "suspended";
    if (profile?.deactivated_at) {
      // A break ends on sign-in (below); a pending deletion does not - it lands on Undo.
      const { data: d } = await supabase
        .from("account_deletions")
        .select("state")
        .abortSignal(controller.signal)
        .maybeSingle();
      if (d?.state === "pending") return "deleting";
    }
    return profile ? "ready" : "needs-username";
  } catch {
    return "ready";
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * Signing in is what ends a break (spec 3.6 #8) - but only a REAL sign-in.
 *
 * This used to live inside whereDoIBelong, which runs on every app load. That was wrong: taking a
 * break signs you out everywhere, yet an access token already handed to a second device stays
 * valid for up to an hour. That device's next app load would quietly clear the break and put the
 * account back on show without anyone asking for it.
 *
 * So we listen for the moment a session is actually created instead. "SIGNED_IN" fires when the
 * 6-digit code is accepted and when the link in the email is opened. It does not fire for a token
 * that was already in storage ("INITIAL_SESSION") or for one being renewed ("TOKEN_REFRESHED"),
 * which is exactly the distinction we need.
 *
 * Call once, as early as possible. Returns the unsubscribe function.
 */
export function endBreakOnRealSignIn(): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event !== "SIGNED_IN") return;
    const me = session?.user?.id;
    if (!me) return;
    void supabase
      .from("profiles")
      .update({ deactivated_at: null })
      .eq("user_id", me)
      .not("deactivated_at", "is", null);
  });
  return () => data.subscription.unsubscribe();
}
