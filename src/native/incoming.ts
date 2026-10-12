import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import { supabase } from "@/integrations/supabase/client";
import { safeKeep } from "@/sets/keepLink";

/**
 * What the phone handed the app when it opened it (roadmap M8.2, M8.7): a share from a store
 * app or a browser (the page's address as text), or one of our own links tapped in a chat.
 * The native side (android/…/IncomingPlugin.java; iOS at M8.2's second half) keeps the last one
 * until it is read; this file reads it on start and on every return to the foreground, and
 * hears the ones that arrive while the app is open.
 *
 * Where each goes:
 *   - any web address that is not ours → Clip a link, with the address filled in and read at
 *     once. The address travels in memory (`takeSharedAddress`), never in the screen's own
 *     `?url=`: a web link can carry `?url=` too, and that one waits for a tap - a link in a chat
 *     must not be able to make the signed-in app fetch an address on its own;
 *   - /s/<code> → the set, through the same `shared_set` question the share page asks (so a
 *     private or reset link lands on "not available" here too); /p/<code> → the poll;
 *   - /welcome?invite=<code> → the invite screen (S111);
 *   - /keep?pieces=<ids> → the look built on a brand's site, as a draft of theirs (M9.2);
 *   - anything else on our own hosts is dropped: the app links the phone registers are /s/ and
 *     /p/, and an explicit intent from another app must not open any screen it names.
 * Nothing happens on the web, where the browser already does all of this.
 */
type IncomingPlugin = {
  pending(): Promise<{ text?: string; url?: string }>;
  addListener(
    event: "incoming",
    fn: (data: { text?: string; url?: string }) => void,
  ): Promise<PluginListenerHandle>;
};

const Incoming = registerPlugin<IncomingPlugin>("Incoming");

const OUR_HOSTS = ["kleit.app", "www.kleit.app", "kleit-test.kleitapp-team.workers.dev"];

/** The first http(s) address in a shared text, if any ("Look at this https://…" is common). */
export function firstUrl(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  return match ? match[0].replace(/[.,;:!?)]+$/, "") : null;
}

/** Where an incoming address should take the app. Exported for the checks. */
export async function destinationFor(
  raw: string,
  lookup: {
    set: (code: string) => Promise<string | null>;
    poll: (code: string) => Promise<string | null>;
  },
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!OUR_HOSTS.includes(url.hostname)) {
    sharedAddress = url.toString();
    return "/add/link";
  }
  const set = /^\/s\/([A-Za-z0-9]{8,32})\/?$/.exec(url.pathname);
  if (set) {
    const id = await lookup.set(set[1]!);
    return id ? `/set/${id}` : "/not-available";
  }
  const poll = /^\/p\/([A-Za-z0-9]{8,32})\/?$/.exec(url.pathname);
  if (poll) {
    const id = await lookup.poll(poll[1]!);
    return id ? `/poll/${id}` : "/not-available";
  }
  const invite = url.pathname === "/welcome" ? url.searchParams.get("invite") : null;
  if (invite && /^[A-Z0-9]{4,16}$/i.test(invite)) return `/welcome?invite=${invite.toUpperCase()}`;
  // Keep it from a brand's site (M9.2): the piece ids, checked to the letter; the screen reads
  // them as the signed-in person, so a foreign id comes to nothing.
  const kept = url.pathname === "/keep" ? safeKeep(url.searchParams.get("pieces")) : null;
  if (kept) return `/keep?pieces=${kept.join(",")}`;
  return null;
}

/** A store address the phone just shared; read once by Clip a link, then gone. */
let sharedAddress: string | null = null;
export function takeSharedAddress(): string | null {
  const address = sharedAddress;
  sharedAddress = null;
  return address;
}

/**
 * Clip a link, while it is already open, hears a second share this way (a navigation to the
 * screen it is on does not mount it again). Whoever listens takes the address; with nobody
 * listening it waits for the next mount.
 */
const sharedListeners = new Set<(address: string) => void>();
export function onSharedAddress(fn: (address: string) => void): () => void {
  sharedListeners.add(fn);
  return () => sharedListeners.delete(fn);
}
function announceShared(): void {
  if (sharedListeners.size === 0) return;
  const address = takeSharedAddress();
  if (address) for (const fn of sharedListeners) fn(address);
}

export async function setIdFor(code: string): Promise<string | null> {
  const { data } = await supabase.rpc("shared_set", { p_code: code });
  const id = (data as { id?: string } | null)?.id;
  return typeof id === "string" ? id : null;
}

export async function pollIdFor(code: string): Promise<string | null> {
  const { data } = await supabase.rpc("shared_poll", { p_code: code });
  const id = (data as { id?: string } | null)?.id;
  return typeof id === "string" ? id : null;
}

let watching = false;

/** Once per app, on the phone: route whatever arrives. `go` is the router's navigate. */
export function watchIncoming(go: (path: string) => void): void {
  if (watching || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Incoming")) return;
  watching = true;

  const handle = async (data: { text?: string; url?: string }) => {
    const raw = data.url ?? (data.text ? firstUrl(data.text) : null);
    if (!raw) return;
    const path = await destinationFor(raw, { set: setIdFor, poll: pollIdFor });
    if (path) go(path);
    if (path === "/add/link") announceShared();
  };
  const check = () => {
    void Incoming.pending()
      .then(handle)
      .catch(() => undefined);
  };

  check();
  void Incoming.addListener("incoming", (data) => void handle(data)).catch(() => undefined);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
}
