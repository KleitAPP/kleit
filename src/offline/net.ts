import { useEffect, useState } from "react";

/**
 * Is the network there? (roadmap M8.5; design pack S106)
 *
 * `navigator.onLine` is the phone's own word, and it is honest in one direction: false means
 * there is truly no connection (aeroplane mode, no signal). True only means "maybe" - a phone
 * can be on Wi-Fi with no internet behind it - so the app never trusts true on its own: it
 * tries the call, and treats a network failure as offline for that call (`isNetworkError`).
 */
export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** The shape supabase-js and fetch give a request that never reached the server. */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { message?: unknown; name?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  const name = typeof e.name === "string" ? e.name : "";
  return (
    name === "AuthRetryableFetchError" ||
    name === "TypeError" ||
    /failed to fetch|network|load failed|fetch failed|timed? ?out|aborted/i.test(message)
  );
}

/** Rerenders when the phone's word changes. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline());
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

/** Calls `fn` once each time the network comes back (and never while it is away). */
export function onBackOnline(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener("online", handler);
  return () => window.removeEventListener("online", handler);
}
