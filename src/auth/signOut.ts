import { supabase } from "@/integrations/supabase/client";
import { forgetSignedIn } from "@/auth/session";
import { stopPush } from "@/native/push";
import { clearOffline } from "@/offline/store";

/**
 * Signing out, all of it: the session (this phone's, or everywhere with `scope: "global"`), the
 * offline stand-in id (M8.5), the offline store - the closet, the sets and their pictures kept
 * for no-signal use (the app-code review, 2026-10-12) - and the push registration on this phone
 * (M8.4a), so a shared or sold phone carries nothing of the person.
 */
export async function signOutEverywhereOnThisPhone(
  options: { scope?: "local" | "global" } = {},
): Promise<void> {
  await stopPush();
  await clearOffline();
  forgetSignedIn();
  await supabase.auth.signOut(options.scope ? { scope: options.scope } : undefined);
}
