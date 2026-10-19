import { supabase } from "@/integrations/supabase/client";

/**
 * Where you're signed in (spec 3.6 #6; migration 105).
 *
 * Every start tells the server "this session is still here, on this kind of device" and the
 * server keeps one row per session. The label is read off the browser - never typed - and is the
 * only thing the list has to tell two phones apart, so it is the kind of thing a person would
 * say: "iPhone · Safari", "Android · Chrome", "Mac · Firefox", "Kleit app" inside the shell.
 */
export type Device = {
  id: string;
  device_label: string;
  last_seen_at: string;
  created_at: string;
  this_one: boolean;
};

export function deviceLabel(ua: string = navigator.userAgent): string {
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "Device";
  const browser = /Kleit\//.test(ua)
    ? "Kleit app"
    : /EdgA?\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /SamsungBrowser/.test(ua)
          ? "Samsung browser"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Chrome\/|CriOS\//.test(ua)
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : "browser";
  return `${device} · ${browser}`;
}

/** Once per start. Quiet about failure: a device list that is late is better than a splash that waits. */
export async function touchDevice(): Promise<void> {
  try {
    await supabase.rpc("touch_device", { p_label: deviceLabel() });
  } catch {
    /* offline: the next start will say hello */
  }
}

export async function myDevices(): Promise<Device[] | null> {
  const { data, error } = await supabase.rpc("my_devices");
  if (error) return null;
  return (data ?? []) as Device[];
}

/** Ends that device's session on the server; the device is out within the hour. Never this one. */
export async function signOutDevice(deviceId: string): Promise<boolean> {
  const { error } = await supabase.rpc("sign_out_device", { p_device: deviceId });
  return !error;
}
