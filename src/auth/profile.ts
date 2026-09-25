/**
 * Taking a username and filling in a profile (roadmap M1.7; spec 3.6).
 *
 * Every rule here is also a rule in the database (migration 003). What the app does is make the
 * answer arrive while you are still typing; what the database does is decide. If those two ever
 * disagree, the database wins and the person sees the refusal on Next.
 */
import { supabase } from "@/integrations/supabase/client";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/** The same shape rule as the database: lower case, digits, dot and underscore, no doubles or edges. */
export function usernameShapeProblem(candidate: string): "too-short" | "too-long" | "characters" | null {
  if (candidate.length < USERNAME_MIN) return "too-short";
  if (candidate.length > USERNAME_MAX) return "too-long";
  if (!/^[a-z0-9._]+$/.test(candidate)) return "characters";
  if (/^[._]/.test(candidate) || /[._]$/.test(candidate) || /[._]{2}/.test(candidate)) return "characters";
  return null;
}

/** Lower-cases and strips what a phone keyboard adds, so "Jay Wears " becomes "jaywears". */
export function tidyUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "").slice(0, USERNAME_MAX);
}

/** Asks the database whether this name is free. Used while typing; never the final word. */
export async function isUsernameFree(candidate: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("username_available", { candidate });
  if (error) return null;
  return data === true;
}

/** Two suggestions in Kleit's own voice, from what the person already typed (design pack 6.3 #4). */
export function suggestUsernames(taken: string): string[] {
  const base = taken.replace(/[._]+$/, "");
  return [`${base}.wears`, `${base}fits`]
    .map((s) => s.slice(0, USERNAME_MAX))
    .filter((s) => usernameShapeProblem(s) === null);
}

export type ClaimProblem = "taken" | "shape" | "already-have-one" | "signed-out" | "offline" | "unknown";

/**
 * Finishes sign-up: writes the profile and files the 18+ record, both inside the database.
 * The app never sends a user id — the database uses whoever is signed in.
 */
export async function claimProfile(
  username: string,
  displayName: string,
  termsVersion = "v0.1",
): Promise<{ ok: true } | { ok: false; problem: ClaimProblem }> {
  try {
    const { error } = await supabase.rpc("claim_profile", {
      p_username: username,
      p_display_name: displayName,
      p_terms_version: termsVersion,
    });
    if (!error) return { ok: true };
    const code = error.code ?? "";
    if (code === "23505") return { ok: false, problem: "already-have-one" };
    if (code === "23514") return { ok: false, problem: "taken" };
    if (code === "42501") return { ok: false, problem: "signed-out" };
    return { ok: false, problem: "unknown" };
  } catch {
    return { ok: false, problem: "offline" };
  }
}

/** Sets the display name after the profile exists. Empty means they tapped Skip, which is fine. */
export async function setDisplayName(displayName: string): Promise<boolean> {
  const { data: session } = await supabase.auth.getUser();
  const me = session.user?.id;
  if (!me) return false;
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName.slice(0, 50) })
    .eq("user_id", me);
  return !error;
}
