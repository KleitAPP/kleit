/**
 * The version of Kleit this bundle is (roadmap M1.14; spec 2.2 #22).
 * Bumped by hand when a release goes out. The launch check (S1) compares it against
 * `min_app_version` in `app_settings`; if this number is lower, the app is blocked
 * behind the update screen (S2) until the person gets a newer bundle.
 */
export const APP_VERSION = "0.1.0";

/** "1.2.0" -> [1, 2, 0]. Anything that isn't a number counts as 0, so a typo can't unlock the app. */
function parts(version: string): number[] {
  return version
    .trim()
    .split(".")
    .map((piece) => {
      const n = Number.parseInt(piece, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
}

/** True when `running` is older than `minimum` - the one test that decides whether S2 shows. */
export function isVersionBelow(running: string, minimum: string): boolean {
  const a = parts(running);
  const b = parts(minimum);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right;
  }
  return false;
}
