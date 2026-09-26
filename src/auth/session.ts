/**
 * Where a signed-in person belongs (roadmap M1.5, M1.7).
 *
 * Two doors lead into the app and both end here. The designed one is the 6-digit code (S7). The
 * other is the sign-in link in the email, which Supabase sends and which we cannot turn off on
 * the free tier - it signs the person in and drops them on the site's front door with no idea
 * whether sign-up was ever finished.
 *
 * So the app never assumes. It asks two questions: are you signed in, and do you have a profile?
 */
import { supabase } from "@/integrations/supabase/client";

export type Landing = "signed-out" | "needs-username" | "ready";

/** Same deadline idea as the launch check: never leave someone on a blank screen for ever. */
const LOOKUP_TIMEOUT_MS = 4_000;

export async function whereDoIBelong(): Promise<Landing> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const { data } = await supabase.auth.getSession();
    const me = data.session?.user?.id;
    if (!me) return "signed-out";

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("user_id, deactivated_at")
      .eq("user_id", me)
      .abortSignal(controller.signal)
      .maybeSingle();

    // Signing in is what ends a break (spec 3.6 #8). Clearing it here means it happens however
    // the person got back in - the code, or the link in the email.
    if (profile?.deactivated_at) {
      await supabase.from("profiles").update({ deactivated_at: null }).eq("user_id", me);
    }

    // If we cannot tell, assume the profile exists. Sending someone who already has a username
    // back to "pick a username" is worse than letting them through to a screen that works.
    if (error) return "ready";
    return profile ? "ready" : "needs-username";
  } catch {
    return "ready";
  } finally {
    clearTimeout(deadline);
  }
}
