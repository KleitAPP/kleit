/**
 * Where to go once signed in (spec 8.2 #2: "after sign-up, return to the same set and finish
 * the action"). A shared page's Sign up link carries `?next=/s/<code>` into /welcome; the path
 * is kept in this tab's session storage across the join screens and the email-code round trip,
 * and the app shell takes it once the person is in. Only a path on our own site is ever kept.
 */
const KEY = "kleit.next";

export function rememberNext(path: string | undefined): void {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return;
  try {
    sessionStorage.setItem(KEY, path.slice(0, 500));
  } catch {
    /* no storage: the person lands on Home, as before */
  }
}

export function takeNext(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    if (path) sessionStorage.removeItem(KEY);
    return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}
