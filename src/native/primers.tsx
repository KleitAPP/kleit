import { useState, type ReactNode } from "react";

import { PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import { isNativeApp } from "@/lib/site";

/**
 * Permission primers (design pack S105; roadmap M8.6a).
 *
 * The phone shows its own permission prompt only once, and a "no" there is hard to undo, so
 * before the first system prompt for each thing we ask for, a sheet of our own says in plain
 * words why we are asking. "Not now" is a real choice: the sheet closes and nothing else
 * happens, and the app stays usable. Each primer appears once per install (a flag in storage);
 * the system prompt itself is the phone's.
 *
 * On the web there is no primer: a file picker needs no permission, and the sheet would only be
 * in the way.
 */
export type PermissionKind = "photos" | "camera" | "notifications";

const KEY = (kind: PermissionKind) => `kleit.primer.${kind}`;

/** True when the primer for this permission has already been shown on this install. */
export function primerShown(kind: PermissionKind): boolean {
  try {
    return localStorage.getItem(KEY(kind)) === "1";
  } catch {
    // Storage refused (private mode): ask once per session rather than for ever.
    return shownThisSession.has(kind);
  }
}
const shownThisSession = new Set<PermissionKind>();

export function markPrimerShown(kind: PermissionKind): void {
  shownThisSession.add(kind);
  try {
    localStorage.setItem(KEY(kind), "1");
  } catch {
    // Fine: the set above covers this session.
  }
}

/** Whether a primer should come first for this action. False on the web. */
export function needsPrimer(kind: PermissionKind): boolean {
  return isNativeApp() && !primerShown(kind);
}

/**
 * Wraps an action that leads to a system permission prompt. Call `ask()` where you would have
 * run the action; the first time in the app it opens the primer and runs the action only on
 * "Continue". Render `<primer.sheet />` once in the screen.
 */
export function usePermissionPrimer(kind: PermissionKind, action: () => void) {
  const [open, setOpen] = useState(false);
  function ask() {
    if (!needsPrimer(kind)) {
      action();
      return;
    }
    setOpen(true);
  }
  function go() {
    markPrimerShown(kind);
    setOpen(false);
    action();
  }
  function notNow() {
    markPrimerShown(kind);
    setOpen(false);
  }
  const sheet: ReactNode = (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) notNow();
      }}
      title={t(`primer.${kind}.title`)}
      description={t(`primer.${kind}.why`)}
      action={<PrimaryButton onClick={go}>{t("primer.continue")}</PrimaryButton>}
    >
      <p className="text-sm text-ink-soft">{t(`primer.${kind}.more`)}</p>
      <button
        type="button"
        onClick={notNow}
        className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
      >
        {t("primer.notNow")}
      </button>
    </Sheet>
  );
  return { ask, sheet };
}
