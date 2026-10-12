/**
 * What the three no-account doors share (cast-vote, takedown-request, contact-form; spec 22.2,
 * security plan): the bot check and the caller's network address.
 *
 * Turnstile: the real secret from the environment; where that is missing, Cloudflare's
 * always-pass test secret ONLY when `KLEIT_TURNSTILE_TEST=1` says so (CI sets it for the test
 * project, where a machine votes on every deploy). Anywhere else a missing secret means the door
 * is shut (503), never open - a bot check that passes everyone is worse than no form.
 *
 * The address: the one the gateway saw. `cf-connecting-ip` is written by Cloudflare over
 * whatever the caller sent and is the only header a caller cannot forge; the first element of
 * `x-forwarded-for` is the caller's own to write, so it is the fallback and never the first
 * choice. No address at all is one shared bucket ("unknown"), so the daily limit still applies.
 */

const CLOUDFLARE_TEST_SECRET = "1x0000000000000000000000000000000AA";

/** The environment, reached through globalThis so this file also type-checks in the web build. */
function env(name: string): string | undefined {
  const deno = (globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno;
  return deno?.env.get(name);
}

/** The secret to verify with, or null when this function must answer "not configured". */
export function turnstileSecret(): string | null {
  const real = env("TURNSTILE_SECRET_KEY");
  if (real) return real;
  return env("KLEIT_TURNSTILE_TEST") === "1" ? CLOUDFLARE_TEST_SECRET : null;
}

/** Fails closed: no token, a network error, a non-JSON answer, a false - all "no". */
export async function turnstilePasses(
  secret: string,
  token: string | undefined,
  remoteip: string,
): Promise<boolean> {
  if (!token || typeof token !== "string" || token.length > 4096) return false;
  try {
    const form = new FormData();
    form.set("secret", secret);
    form.set("response", token);
    if (remoteip && remoteip !== "unknown") form.set("remoteip", remoteip);
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const body = (await response.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    return false;
  }
}

/** The caller's network address as the gateway saw it; "unknown" when there is none. */
export function clientAddress(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded.slice(0, 64);
  return "unknown";
}

/**
 * Two secrets compared byte by byte with no early exit, so how long a wrong guess takes says
 * nothing about how much of it was right.
 */
export function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}
