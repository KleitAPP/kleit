import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/site";

/**
 * S107 — the review prompt (roadmap M8). Asked once per phone, after the third set has been
 * sent, through the phone's own rating sheet (Apple's SKStoreReviewController, Google Play's
 * in-app review). We only ask: the store decides whether the sheet actually appears (Apple shows
 * it at most three times a year, and never on a phone where the person already reviewed).
 *
 * Rules, all on purpose:
 *   - Never on the web, where there is no store sheet to show.
 *   - Never tied to a reward or a nudge (spec 11 #11: never reward ratings or reviews).
 *   - Never a second time from the same phone, whatever the store decided the first time.
 *   - Only after a real send - the share sheet closed or the link was copied - and only once
 *     the person has three published sets, so the ask lands on someone who has got something
 *     out of Kleit. The count comes from the server, not from this phone: a person who built
 *     their sets on the web is asked on their first send from the phone.
 */
const ASKED = "kleit.review.asked";
export const ASK_AFTER = 3;

async function publishedSets(): Promise<number> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return 0;
  const { count } = await supabase
    .from("sets")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", me)
    .eq("status", "published")
    .is("deleted_at", null);
  return count ?? 0;
}

/** Call after a set has been sent. Safe to call anywhere; it does nothing almost every time. */
export async function noteSetSent(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    if (localStorage.getItem(ASKED)) return;
  } catch {
    return;
  }
  if ((await publishedSets()) < ASK_AFTER) return;
  try {
    localStorage.setItem(ASKED, new Date().toISOString());
  } catch {
    return;
  }
  // A beat after the share sheet closes, so the rating sheet is not fighting it.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  try {
    const { InAppReview } = await import("@capacitor-community/in-app-review");
    await InAppReview.requestReview();
  } catch {
    /* the store declined to show it, or the plugin is not in this build; nothing to do */
  }
}
