/**
 * The soft caps (spec 4.6 #5; migration 102): 5,000 sets and 3,000 closet pieces per account.
 * The database refuses the one past the cap with its own code - `P0012` for a set, `P0013` for
 * a closet piece - and these are the words the screens say for them, since "that didn't work"
 * would send the person off to try again for ever. The numbers here are for the sentence and
 * for the closet's pre-check only; the rule lives in the database.
 */
import { t } from "@/i18n/en";

export const SETS_CAP = 5000;
export const CLOSET_CAP = 3000;

export type CapKind = "sets" | "closet";

/** The cap a PostgREST error names, or null when it is some other failure. */
export function capHit(error: { code?: string } | null | undefined): CapKind | null {
  if (error?.code === "P0012") return "sets";
  if (error?.code === "P0013") return "closet";
  return null;
}

export function capWords(kind: CapKind): string {
  return kind === "sets"
    ? t("caps.sets", { count: SETS_CAP.toLocaleString() })
    : t("caps.closet", { count: CLOSET_CAP.toLocaleString() });
}

/**
 * Why the last attempt to make a set failed, for a screen whose only answer was "nothing
 * happened": the two draft makers record it here, and the sheet that called them reads it.
 */
let lastSetProblem: "cap" | "failed" | null = null;
export function recordSetProblem(error: { code?: string } | null | undefined): void {
  lastSetProblem = capHit(error) === "sets" ? "cap" : "failed";
}
export function takeSetProblem(): "cap" | "failed" | null {
  const was = lastSetProblem;
  lastSetProblem = null;
  return was;
}
