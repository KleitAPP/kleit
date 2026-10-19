import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";

/**
 * Moderation (M7.2; spec 13.4): the queue a moderator works, the one door `moderate()`, and
 * the strike notice with its one appeal. Everything here is refused by the database for anyone
 * who is not a moderator - the screens only ask.
 */
export type QueueItem = {
  id: string;
  request_ref: string;
  target_type: "set" | "item" | "comment" | "profile" | "conversation" | "group";
  target_id: string;
  target_owner: string | null;
  target_username: string | null;
  reason: string;
  note: string;
  priority: "urgent" | "normal";
  state: string;
  created_at: string;
  reports_on_target: number;
  title: string | null;
  body: string | null;
  preview_image_id: string | null;
  evidence: { sender: string; body: string; at: string }[] | null;
  /** When the review is due (spec 13.4 #1): a day after an urgent report, three after the rest. */
  due_at: string;
  /** The piece whose picture the moderator may open (a reported piece, or a reported profile's photo). */
  picture_item_id: string | null;
};
/** A photo the scanner sent to a person (spec 13.1 #3), waiting in the scan review (migration 113). */
export type ScanReview = {
  item_id: string;
  owner_id: string | null;
  owner_username: string | null;
  title: string | null;
  kind: "product" | "non_product" | "own";
  because: string[] | null;
  created_at: string;
  scanned_at: string | null;
};
export type Strike = {
  id: string;
  kind: "community" | "copyright";
  reason: string;
  created_at: string;
  expires_at: string;
  appeal_state: "open" | "upheld" | "overturned" | null;
  appeal_note: string | null;
};
export type Action = "dismiss" | "remove" | "strike" | "ban";

export async function myRoles(): Promise<string[]> {
  const { data } = await supabase.rpc("my_roles");
  return (data ?? []) as string[];
}

export async function queue(): Promise<QueueItem[]> {
  const { data } = await supabase.rpc("moderation_queue");
  return (data ?? []) as QueueItem[];
}

/**
 * Why a moderator action failed, in plain words for the screen - never silence (2026-10-09:
 * the owner could not tell whether his taps had done anything).
 */
export function whyItFailed(error: { message?: string } | null): string | null {
  if (!error) return null;
  const m = error.message ?? "";
  if (/already resolved|resolved report|no open|not_found/i.test(m)) return t("mod.err.done");
  if (/staff are not/i.test(m)) return t("mod.err.staff");
  if (/moderators only/i.test(m)) return t("mod.err.role");
  if (/reason is required/i.test(m)) return t("mod.err.reason");
  if (/different person/i.test(m)) return t("mod.err.second");
  if (/kept out of featured/i.test(m)) return t("mod.err.pg13");
  if (/removed before/i.test(m)) return t("mod.err.listed");
  if (/not before (\d{4}-\d{2}-\d{2})/i.test(m))
    return t("mod.err.notYet", { date: /not before (\d{4}-\d{2}-\d{2})/i.exec(m)?.[1] ?? "" });
  if (/already purged/i.test(m)) return t("mod.err.purged");
  if (/another ground/i.test(m)) return t("mod.err.otherGround");
  return t("mod.err.other");
}

export async function scanReviewQueue(): Promise<ScanReview[]> {
  const { data } = await supabase.rpc("scan_review_queue");
  return (data ?? []) as ScanReview[];
}

/** Clear or block a photo the scanner sent for review. Null when it worked; otherwise the sentence to show. */
export async function scanDecide(
  itemId: string,
  outcome: "clean" | "blocked",
  note: string,
): Promise<string | null> {
  const { error } = await supabase.rpc("scan_decide", {
    p_item: itemId,
    p_outcome: outcome,
    p_note: note,
  });
  return whyItFailed(error);
}

/**
 * A signed, two-minute address for a picture the world may not see, for a moderator only; the
 * function logs the view before it answers (spec 13.4 #9). Null when refused.
 */
export async function modImageUrl(
  itemId: string,
  why: "queue" | "scan-review" | "appeal",
): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke<{ url?: string }>(
    `mod-image?item=${encodeURIComponent(itemId)}&why=${why}`,
    { method: "GET" },
  );
  return error || !data?.url ? null : data.url;
}

/** Null when it worked; otherwise the sentence to show. */
export async function moderate(
  reportId: string,
  action: Action,
  note: string,
): Promise<string | null> {
  const { error } = await supabase.rpc("moderate", {
    p_report: reportId,
    p_action: action,
    p_note: note,
  });
  return whyItFailed(error);
}

export async function myStrikes(): Promise<Strike[]> {
  const { data } = await supabase.rpc("my_strikes");
  return (data ?? []) as Strike[];
}

export async function appeal(strikeId: string, body: string): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  const me = data.user?.id;
  if (!me) return false;
  const { error } = await supabase
    .from("appeals")
    .insert({ strike_id: strikeId, user_id: me, body: body.trim() });
  return !error;
}

/** An appeal on a blocked photo of your own (spec 13.4 #4, 4.7 #3): one per photo, while it is blocked. */
export async function appealPhoto(itemId: string, body: string): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  const me = data.user?.id;
  if (!me) return false;
  const { error } = await supabase
    .from("appeals")
    .insert({ item_id: itemId, user_id: me, body: body.trim() });
  return !error;
}

/** The state of your appeal on a photo, or null when there is none. */
export async function myPhotoAppeal(
  itemId: string,
): Promise<{ state: "open" | "upheld" | "overturned"; note: string } | null> {
  const { data } = await supabase
    .from("appeals")
    .select("state, note")
    .eq("item_id", itemId)
    .maybeSingle();
  return data ? { state: data.state as "open" | "upheld" | "overturned", note: data.note } : null;
}

export type OpenAppeal = {
  id: string;
  strike_id: string | null;
  item_id: string | null;
  user_id: string;
  body: string;
  created_at: string;
  username: string | null;
  /** For a photo appeal: why the scanner (or a moderator) blocked it, for the second person to read. */
  reason: string | null;
  because: string[] | null;
};
export async function openAppeals(): Promise<OpenAppeal[]> {
  const { data } = await supabase
    .from("appeals")
    .select("id, strike_id, item_id, user_id, body, created_at")
    .eq("state", "open")
    .order("created_at");
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const items = rows.map((r) => r.item_id).filter((x): x is string => !!x);
  const [{ data: people }, { data: reasons }] = await Promise.all([
    ids.length
      ? supabase.from("profiles").select("user_id, username").in("user_id", ids)
      : Promise.resolve({ data: [] as { user_id: string; username: string }[] }),
    items.length
      ? supabase.rpc("appeal_photo_reasons", { p_items: items })
      : Promise.resolve({
          data: [] as { item_id: string; reason: string | null; because: unknown }[],
        }),
  ]);
  const names = new Map((people ?? []).map((p) => [p.user_id, p.username]));
  const why = new Map(
    (reasons ?? []).map((r) => [
      r.item_id,
      {
        reason: r.reason ?? null,
        because: Array.isArray(r.because) ? (r.because as string[]) : null,
      },
    ]),
  );
  return rows.map((r) => ({
    ...r,
    username: names.get(r.user_id) ?? null,
    reason: r.item_id ? (why.get(r.item_id)?.reason ?? null) : null,
    because: r.item_id ? (why.get(r.item_id)?.because ?? null) : null,
  }));
}

/** Whether the person may appeal this blocked photo of theirs (the policy's own answer, migration 117). */
export async function photoAppealAllowed(itemId: string): Promise<boolean> {
  const { data } = await supabase.rpc("photo_appeal_allowed", { p_item: itemId });
  return data === true;
}

/** Null when it worked; otherwise the sentence to show (a second person must decide, for one). */
export async function decideAppeal(
  appealId: string,
  outcome: "upheld" | "overturned",
  note: string,
): Promise<string | null> {
  const { error } = await supabase.rpc("decide_appeal", {
    p_appeal: appealId,
    p_outcome: outcome,
    p_note: note,
  });
  return whyItFailed(error);
}
