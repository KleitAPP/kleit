/**
 * Auth storage that cannot throw (found by testing, 2026-09-26).
 *
 * A browser does not always let a page keep anything. In private browsing, with cookies blocked,
 * or with site data switched off, merely *reading* `window.localStorage` throws a SecurityError -
 * it does not return an empty box, it refuses to hand over the box at all. Supabase's storage
 * (Lovable's `brokeredPreviewStorage`, which ends in `return localStorage`) is built while the
 * client is being created, so that throw took down the whole app: every screen, signed in or out,
 * showed "This page didn't load".
 *
 * So this wraps it twice over:
 *  - the box is fetched inside a try, and if the browser refuses, we use a plain object in memory
 *    instead. The person stays signed in for as long as the tab is open and no longer, which is
 *    what private browsing is for anyway.
 *  - every read and write is wrapped too, because a browser can also hand over the box and then
 *    refuse to write to it (a full quota reads exactly like this).
 *
 * The result is that no storage failure can ever be worse than "you have to sign in again". It is
 * never mistaken for being signed in - `whereDoIBelong` fails closed on top of this.
 *
 * Note: this file is ours. `client.ts` and `previewAuthStorage.ts` next to it are Lovable's and
 * say so at the top, so the one-line change in `client.ts` that uses this may be overwritten by
 * Lovable at some point. If it is, the symptom is private browsing breaking again, not a hole.
 */
type Store = {
  getItem: (key: string) => string | Promise<string | null> | null;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

export function neverThrowingStorage(build: () => Store | undefined): Store {
  const memory = new Map<string, string>();
  const inMemory: Store = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: (key) => void memory.delete(key),
  };

  let real: Store;
  try {
    const built = build();
    // On the server there is no storage at all, and that is not a failure either.
    if (!built) return inMemory;
    real = built;
    // Prove it actually works before trusting it: some browsers hand over the box and then refuse.
    const probe = "kleit.storage.probe";
    void real.setItem(probe, "1");
    void real.removeItem(probe);
  } catch {
    return inMemory;
  }

  return {
    getItem: (key) => {
      try {
        return real.getItem(key);
      } catch {
        return inMemory.getItem(key);
      }
    },
    setItem: (key, value) => {
      try {
        return real.setItem(key, value);
      } catch {
        return inMemory.setItem(key, value);
      }
    },
    removeItem: (key) => {
      try {
        return real.removeItem(key);
      } catch {
        return inMemory.removeItem(key);
      }
    },
  };
}
