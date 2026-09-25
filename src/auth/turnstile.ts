/**
 * The invisible bot check (spec 3.1 #5: Turnstile only, never a puzzle).
 *
 * Kleit has no Turnstile keys of its own yet - making them is a change to the owner's Cloudflare
 * account. Until then this uses Cloudflare's published always-passes TEST key, so the whole path
 * is real and proven: the widget loads, a token is produced, and the token is handed to Supabase.
 * Switching to the real key is one environment variable and no code change.
 *
 * The site key is public by design (technical pack section 4.2 #3). The matching SECRET key is
 * pasted into Supabase by the owner and never appears here.
 */
const CLOUDFLARE_TEST_SITE_KEY = "1x00000000000000000000AA";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const turnstileSiteKey: string =
  (import.meta.env["VITE_TURNSTILE_SITE_KEY"] as string | undefined) ?? CLOUDFLARE_TEST_SITE_KEY;

/** True while we are still on the test key - the sign-up screens say so, quietly, so nobody forgets. */
export const usingTestBotCheck = turnstileSiteKey === CLOUDFLARE_TEST_SITE_KEY;

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

let loading: Promise<Turnstile> | null = null;

function load(): Promise<Turnstile> {
  if (loading) return loading;
  loading = new Promise<Turnstile>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("no browser"));
      return;
    }
    const existing = (window as unknown as { turnstile?: Turnstile }).turnstile;
    if (existing) {
      resolve(existing);
      return;
    }
    const tag = document.createElement("script");
    tag.src = SCRIPT;
    tag.async = true;
    tag.onload = () => {
      const t = (window as unknown as { turnstile?: Turnstile }).turnstile;
      if (t) resolve(t);
      else reject(new Error("Turnstile did not load"));
    };
    tag.onerror = () => reject(new Error("Turnstile did not load"));
    document.head.appendChild(tag);
  });
  return loading;
}

/**
 * Runs the check and returns a token for Supabase.
 *
 * It fails OPEN: if Cloudflare cannot be reached, sign-up still works without a token rather than
 * stranding a real person behind a bot check that is itself broken. Supabase is the thing that
 * decides whether a token is required, and it is the server, so this is a convenience, not the lock.
 */
export async function botCheckToken(host: HTMLElement): Promise<string | undefined> {
  try {
    const turnstile = await load();
    return await new Promise<string | undefined>((resolve) => {
      const giveUp = setTimeout(() => resolve(undefined), 8_000);
      turnstile.render(host, {
        sitekey: turnstileSiteKey,
        appearance: "interaction-only",
        callback: (token: string) => {
          clearTimeout(giveUp);
          resolve(token);
        },
        "error-callback": () => {
          clearTimeout(giveUp);
          resolve(undefined);
        },
      });
    });
  } catch {
    return undefined;
  }
}
