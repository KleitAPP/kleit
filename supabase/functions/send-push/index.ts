/**
 * send-push (roadmap M8.4a; spec 10.3; migration 073): the one place a push leaves the project.
 * Called every minute by pg_cron through pg_net with the sweep secret, never by a person. Takes
 * the due rows from `claim_pushes` (quiet hours already applied by the database), writes the
 * words, and hands each to OneSignal addressed by our own user id (the app calls
 * `OneSignal.login(userId)`, so OneSignal never sees an email or a name - only the id and the
 * words of the push). Twelve or more waiting for one person arrive as a single push.
 *
 * Behind the switch: with `push_open` off, or with no REST key in the environment, it claims
 * nothing and says so.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const BATCH = 200;
const BUNDLE_AT = 12;
/** OneSignal's app id is public - it ships inside the app - so it lives here, not in a secret. */
const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID") ?? "f1b32cbc-556d-4030-8955-d498ab14efd0";

function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

type Due = {
  id: number;
  user_id: string;
  kind: string;
  ref_type: string | null;
  ref_id: string | null;
  bundled_count: number;
  actor_username: string | null;
};

/** The words, in the app's own voice; the path the tap opens inside the app. */
function words(row: Due): { text: string; path: string } {
  const who = row.actor_username ? `@${row.actor_username}` : "Someone";
  const n = row.bundled_count;
  const set = row.ref_type === "set" && row.ref_id ? `/set/${row.ref_id}` : null;
  switch (row.kind) {
    case "vote":
      return { text: n > 1 ? `${n} new votes on your poll` : "A new vote on your poll", path: row.ref_id ? `/poll/${row.ref_id}` : "/you" };
    case "comment":
      return { text: `${who} commented on your set`, path: set ?? "/inbox" };
    case "like":
      return { text: n > 1 ? `${who} and ${n - 1} other${n - 1 === 1 ? "" : "s"} liked your set` : `${who} liked your set`, path: set ?? "/inbox" };
    case "follow":
      return { text: `${who} started following you`, path: row.ref_id ? `/u/${row.actor_username ?? ""}` : "/you/people" };
    case "follow_request":
      return { text: `${who} asked to follow you`, path: "/you/people" };
    case "message":
      return { text: `${who} sent you a message`, path: row.ref_id ? `/inbox/${row.ref_id}` : "/inbox" };
    case "message_request":
      return { text: `${who} wants to message you`, path: "/inbox" };
    case "group_invite":
      return { text: `${who} invited you to a group`, path: "/groups" };
    case "contest_results":
      return { text: "This week's challenge has closed - see the board", path: row.ref_id ? `/contests/${row.ref_id}` : "/contests" };
    default:
      return { text: "Something new on Kleit", path: "/inbox" };
  }
}

type Send = { ok: boolean; dropped: boolean; detail?: string };

async function send(key: string, userId: string, text: string, path: string, collapse: string): Promise<Send> {
  const response = await fetch("https://api.onesignal.com/notifications?c=push", {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      target_channel: "push",
      include_aliases: { external_id: [userId] },
      headings: { en: "Kleit" },
      contents: { en: text },
      data: { path },
      collapse_id: collapse,
      android_group: "kleit",
      ios_badgeType: "Increase",
      ios_badgeCount: 1,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; errors?: unknown };
  if (response.ok && body.id) return { ok: true, dropped: false };
  // "no subscribed devices" is not a failure to retry: the person has no phone registered.
  const detail = JSON.stringify(body.errors ?? body).slice(0, 300);
  const dropped = /not subscribed|no subscribed|invalid_aliases|external_id/i.test(detail);
  return { ok: false, dropped, detail: `${response.status} ${detail}` };
}

Deno.serve(async (request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("SWEEP_SECRET");
  if (!url || !serviceKey) return Response.json({ problem: "not-configured" }, { status: 500 });
  if (!secret) return Response.json({ problem: "not-configured" }, { status: 503 });
  const given = request.headers.get("x-sweep-key") ?? "";
  if (!sameSecret(given, secret)) return Response.json({ problem: "not-allowed" }, { status: 401 });

  const server = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sw } = await server.from("app_settings").select("value").eq("key", "push_open").maybeSingle();
  if (sw?.value !== true) return Response.json({ skipped: "switch-off" });
  const key = Deno.env.get("ONESIGNAL_REST_API_KEY");
  if (!key) return Response.json({ skipped: "no-key" });

  const { data: due, error } = await server.rpc("claim_pushes", { p_limit: BATCH });
  if (error) return Response.json({ problem: "claim-failed" }, { status: 502 });
  const rows = (due ?? []) as Due[];

  const byUser = new Map<string, Due[]>();
  for (const row of rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);

  const sent: number[] = [];
  const failed: number[] = [];
  const dropped: number[] = [];
  for (const [userId, list] of byUser) {
    const jobs: { ids: number[]; text: string; path: string; collapse: string }[] =
      list.length >= BUNDLE_AT
        ? [{ ids: list.map((r) => r.id), text: `${list.length} new things on Kleit`, path: "/inbox", collapse: "bundle" }]
        : list.map((r) => ({ ids: [r.id], ...words(r), collapse: `${r.kind}:${r.ref_id ?? ""}` }));
    for (const job of jobs) {
      try {
        const result = await send(key, userId, job.text, job.path, job.collapse);
        if (result.ok) sent.push(...job.ids);
        else if (result.dropped) dropped.push(...job.ids);
        else {
          console.error(`[send-push] ${userId}: ${result.detail}`);
          failed.push(...job.ids);
        }
      } catch (problem) {
        console.error(`[send-push] ${userId}:`, problem instanceof Error ? problem.message : String(problem));
        failed.push(...job.ids);
      }
    }
  }
  if (sent.length) await server.rpc("mark_pushes", { p_ids: sent, p_state: "sent" });
  if (dropped.length) await server.rpc("mark_pushes", { p_ids: dropped, p_state: "dropped" });
  if (failed.length) await server.rpc("mark_pushes", { p_ids: failed, p_state: "failed" });
  return Response.json({ claimed: rows.length, sent: sent.length, dropped: dropped.length, failed: failed.length });
});
