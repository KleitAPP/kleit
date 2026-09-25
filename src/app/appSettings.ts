/**
 * The emergency switches (roadmap M1.14; spec 2.2 #22; design pack G8; technical pack section 6A row 002).
 *
 * Seven keys in one table, readable by anyone - the launch check runs before sign-in - and
 * writable only by an admin. Every switch is read through this file, never straight from the
 * table, so there is one place that decides what happens when a switch cannot be read.
 */
import { supabase } from "@/integrations/supabase/client";

export type AppSettings = {
  /** The oldest bundle allowed to run. Anything older is blocked behind S2. */
  min_app_version: string;
  /** Turns the whole app off and shows S3. */
  maintenance_mode: boolean;
  /** New accounts. */
  signups_open: boolean;
  /** Creating and publishing sets. */
  posting_open: boolean;
  /** Direct messages. */
  dms_open: boolean;
  /** Comments. */
  comments_open: boolean;
  /** Public share links. */
  public_links_open: boolean;
};

/**
 * What the app assumes when the switches cannot be read at all.
 *
 * It fails OPEN, on purpose: a database hiccup must not lock every person out of an app that is
 * working fine. The switches exist so we can close things deliberately, and closing something
 * deliberately means the row can be read. The one thing never assumed is a minimum version, so
 * a failed read can never force an update either.
 */
export const SETTINGS_WHEN_UNREADABLE: AppSettings = {
  min_app_version: "0.0.0",
  maintenance_mode: false,
  signups_open: true,
  posting_open: true,
  dms_open: true,
  comments_open: true,
  public_links_open: true,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asVersion(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

/**
 * How long the launch check waits for the switches before it decides they cannot be read.
 *
 * This deadline is not optional. On a phone with no signal, supabase-js keeps retrying a dead
 * connection and the request never finishes at all, so without a deadline the launch check would
 * sit on the splash for ever - which is worse than any switch being wrong.
 */
export const SETTINGS_TIMEOUT_MS = 4_000;

/** Reads all seven switches in one request. A key that is missing or the wrong shape keeps its open default. */
export async function fetchAppSettings(): Promise<AppSettings> {
  // A plain AbortController, not AbortSignal.timeout(), because the older Android we test on
  // does not have AbortSignal.timeout (Chrome 103+).
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), SETTINGS_TIMEOUT_MS);
  let data: { key: string; value: unknown }[] | null = null;
  try {
    const result = await supabase
      .from("app_settings")
      .select("key, value")
      .abortSignal(controller.signal);
    if (result.error) throw result.error;
    data = result.data;
  } finally {
    clearTimeout(deadline);
  }

  const rows = new Map<string, unknown>((data ?? []).map((row) => [row.key, row.value]));
  const base = SETTINGS_WHEN_UNREADABLE;
  return {
    min_app_version: asVersion(rows.get("min_app_version"), base.min_app_version),
    maintenance_mode: asBoolean(rows.get("maintenance_mode"), base.maintenance_mode),
    signups_open: asBoolean(rows.get("signups_open"), base.signups_open),
    posting_open: asBoolean(rows.get("posting_open"), base.posting_open),
    dms_open: asBoolean(rows.get("dms_open"), base.dms_open),
    comments_open: asBoolean(rows.get("comments_open"), base.comments_open),
    public_links_open: asBoolean(rows.get("public_links_open"), base.public_links_open),
  };
}

/** The shared query, so every screen that needs a switch reads the same cached answer. */
export const appSettingsQuery = {
  queryKey: ["app_settings"] as const,
  queryFn: fetchAppSettings,
  /** Re-read at most once a minute, and again whenever the app comes back to the front. */
  staleTime: 60_000,
  /** One retry. Each attempt has its own deadline, so a retry cannot stall the launch either. */
  retry: 1,
  retryDelay: 500,
};
