import { supabase } from "@/integrations/supabase/client";
import { forgetSignedIn } from "@/auth/session";
import { stopPush } from "@/native/push";

/**
 * Signing out, all of it: the session, the offline stand-in id (M8.5), and the push
 * registration on this phone (M8.4a) - so a shared or sold phone carries nothing of the person.
 */
export async function signOutEverywhereOnThisPhone(): Promise<void> {
  forgetSignedIn();
  await stopPush();
  await supabase.auth.signOut();
}
