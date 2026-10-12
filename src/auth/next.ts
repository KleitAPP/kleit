/**
 * Where to go once signed in (spec 8.2 #2: "after sign-up, return to the same set and finish
 * the action"). A shared page's Sign up link carries `?next=/s/<code>` into /welcome; the path
 * is kept in this tab's session storage across the join screens and the email-code round trip,
 * and the app shell takes it once the person is in. Only a path on our own site is ever kept.
 */
const KEY = "kleit.next";

/**
 * Only the two paths a shared page sends: the set and the poll. A path is not a safe thing to
 * keep just because it starts with a slash - `/\\evil.com` is a host to a URL parser, and any
 * other screen of ours is not one a stranger's link should choose for the person.
 */
export function safeNext(path: string | undefined): string | null {
  if (!path) return null;
  return /^\/[sp]\/[A-Za-z0-9]{8,32}\/?$/.test(path) ? path : null;
}

export function rememberNext(path: string | undefined): void {
  const safe = safeNext(path);
  if (!safe) return;
  try {
    sessionStorage.setItem(KEY, safe);
  } catch {
    /* no storage: the person lands on Home, as before */
  }
}

export function takeNext(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    if (path) sessionStorage.removeItem(KEY);
    return safeNext(path ?? undefined);
  } catch {
    return null;
  }
}
