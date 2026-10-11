import { Capacitor } from "@capacitor/core";

/**
 * Where Kleit's public web pages live (M8.1a prep).
 *
 * On the web the app and the pages share one address, so `window.location.origin` is right.
 * Inside the phone apps the app is served from `https://localhost`, so a share link built from
 * it would point at the phone itself, and the Worker's pages (/s/…, /p/…, /takedown, /copyright,
 * /contact, /delete-account) are not in the app bundle at all. Those always go to the real site.
 *
 * The test site until the domain stage; kleit.app after (one line, or VITE_PUBLIC_SITE_URL).
 */
const PUBLIC_SITE: string =
  (import.meta.env["VITE_PUBLIC_SITE_URL"] as string | undefined) ??
  "https://kleit-test.kleitapp-team.workers.dev";

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** The address of a public page, e.g. siteUrl("/s/abc"), right on the web and in the apps. */
export function siteUrl(path = ""): string {
  const base = isNativeApp() ? PUBLIC_SITE : window.location.origin;
  return `${base}${path}`;
}

/** The live site's hosts (M10). The debug routes under /dev answer everywhere but here (WA7). */
const LIVE_HOSTS = ["kleit.app", "www.kleit.app"];

export function isLiveSite(): boolean {
  return typeof window !== "undefined" && LIVE_HOSTS.includes(window.location.hostname);
}
