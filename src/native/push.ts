import { Capacitor } from "@capacitor/core";

import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/site";

/**
 * Push notifications, the app half (roadmap M8.4a; spec 10.3; CL36). OneSignal carries the
 * push; the words and the timing are ours (the `send-push` function and migration 073).
 *
 * Three rules, all on purpose:
 *   - Nothing starts unless the server's `push_open` switch is on AND this is the phone app.
 *     On the web this file does nothing at all, and the OneSignal code is never even loaded.
 *   - OneSignal learns one thing about a person: our own user id (`login`), so a push can be
 *     addressed. Never an email, a name, or anything else.
 *   - The phone's own permission prompt is asked for once, from the Notifications setting, after
 *     our primer (S105) - never on launch, never unasked.
 */
export const ONESIGNAL_APP_ID = "f1b32cbc-556d-4030-8955-d498ab14efd0";

type OneSignalModule = typeof import("onesignal-cordova-plugin").default;

let loaded: OneSignalModule | null = null;
let started = false;

async function plugin(): Promise<OneSignalModule | null> {
  if (!isNativeApp()) return null;
  if (loaded) return loaded;
  try {
    const mod = await import("onesignal-cordova-plugin");
    loaded = mod.default;
    return loaded;
  } catch {
    return null;
  }
}

/**
 * Start the SDK and tell it who this is. Safe to call on every launch and after every sign-in;
 * it does not ask the phone for anything. `onOpen` gets the in-app path a tapped push carries.
 */
export async function startPush(
  userId: string,
  pushOpen: boolean,
  onOpen: (path: string) => void,
): Promise<void> {
  if (!pushOpen) return;
  const os = await plugin();
  if (!os) return;
  if (!started) {
    os.initialize(ONESIGNAL_APP_ID);
    os.Notifications.addEventListener("click", (event) => {
      const data = (event.notification.additionalData ?? {}) as { path?: unknown };
      if (typeof data.path === "string" && data.path.startsWith("/")) onOpen(data.path);
    });
    started = true;
  }
  os.login(userId);
}

/** On sign-out: the device no longer belongs to that person. */
export async function stopPush(): Promise<void> {
  const os = await plugin();
  if (!os || !started) return;
  os.logout();
}

export type PushState = { enabled: boolean; platform: "android" | "ios" | "web" };

/** What the phone says right now: has this person allowed notifications for Kleit? */
export async function pushPermissionGranted(): Promise<boolean> {
  const os = await plugin();
  if (!os) return false;
  try {
    return await os.Notifications.getPermissionAsync();
  } catch {
    return false;
  }
}

/**
 * Ask the phone (after the primer, which the caller shows first). True when the person said yes.
 * `fallbackToSettings` sends a person who once said no to the phone's own settings page, which
 * is the only place that no can be undone.
 */
export async function askPhoneForPush(): Promise<boolean> {
  const os = await plugin();
  if (!os) return false;
  try {
    const yes = await os.Notifications.requestPermission(true);
    if (yes) os.User.pushSubscription.optIn();
    return yes;
  } catch {
    return false;
  }
}

function platform(): PushState["platform"] {
  const p = Capacitor.getPlatform();
  return p === "android" || p === "ios" ? p : "web";
}

/** Remember the answer, and the time zone for the quiet hours, in the person's own row. */
export async function savePushSetting(enabled: boolean): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  const me = data.user?.id;
  if (!me) return false;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const { error } = await supabase
    .from("push_settings")
    .upsert({ user_id: me, enabled, timezone, platform: platform() }, { onConflict: "user_id" });
  if (!enabled) {
    const os = await plugin();
    os?.User.pushSubscription.optOut();
  }
  return !error;
}

export async function readPushSetting(): Promise<boolean> {
  const { data } = await supabase.from("push_settings").select("enabled").maybeSingle();
  return data?.enabled === true;
}
