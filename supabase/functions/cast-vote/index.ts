/**
 * cast-vote — a guest's (or a signed-in person's) vote on a "which one?" poll (roadmap M3.7;
 * spec 7.3 #2, #4, #5; technical pack §4.1).
 *
 * Guests have no database access, so this is the one door. It takes the poll's share code, the
 * option, a random device id the browser made up and keeps, and a Turnstile token; it checks the
 * token with Cloudflare, turns the device id and the network address into hashes the database
 * never sees the originals of, and hands the vote to `record_vote` (migration 022), which applies
 * the rules that belong to the data: one vote per device, blocked people refused, a network
 * burst refused and down-weighted, the options locked at the first vote.
 *
 *   POST { code, option_id, device_id, token }           → vote (or change a vote)
 *   POST { code, device_id, action: "status" }           → has this device voted, and the bars
 *
 * With a Kleit session in the Authorization header the vote is also the person's (`voter_id`),
 * so "3 friends voted" can be counted, and no Turnstile token is asked for - the session is
 * the proof. Wrong or missing tokens, closed polls and refusals all come back as a short code the
 * page turns into the friendly wording (design pack S57).
 *
 * No Turnstile keys of our own exist yet (lessons-learned: account 6). Until the owner makes
 * them, this checks against Cloudflare's published always-passes TEST secret, which matches the
 * test site key the app already uses. Switching is one secret, TURNSTILE_SECRET_KEY, no code.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CLOUDFLARE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const CODE = /^[A-Za-z0-9]{8,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function hmac(key: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function clientAddress(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    ""
  );
}

async function turnstilePasses(token: string, remoteip: string): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? CLOUDFLARE_TEST_SECRET;
  try {
    const form = new FormData();
    form.set("secret", secret);
    form.set("response", token);
    if (remoteip) form.set("remoteip", remoteip);
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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply(405, { error: "method" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { error: "not_configured" });

  let body: {
    code?: string;
    option_id?: string;
    device_id?: string;
    token?: string;
    action?: string;
  };
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "bad_request" });
  }
  const code = body.code ?? "";
  const deviceId = body.device_id ?? "";
  if (!CODE.test(code) || !DEVICE.test(deviceId)) return reply(400, { error: "bad_request" });

  const server = createClient(url, serviceKey);
  const { data: poll } = await server
    .from("polls")
    .select("id, closes_at, closed_at")
    .eq("share_code", code)
    .is("deleted_at", null)
    .eq("takedown_state", "none")
    .maybeSingle();
  if (!poll) return reply(404, { error: "not_found" });

  // Who is voting, if anyone. A session makes the vote theirs; without one it is the device's.
  let voterId: string | null = null;
  const authorization = request.headers.get("Authorization") ?? "";
  if (authorization.startsWith("Bearer ") && authorization.length > 40) {
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authorization } },
    });
    const { data: who } = await asCaller.auth.getUser();
    voterId = who.user?.id ?? null;
  }

  // The hashes. Keyed with the service key, so nobody outside this function can rebuild them
  // from a device id or an address; the database only ever sees these.
  const deviceHash = await hmac(serviceKey, voterId ? `user:${voterId}` : `device:${deviceId}`);
  const address = clientAddress(request);
  const ipHash = address ? await hmac(serviceKey, `ip:${address}`) : null;

  if (body.action === "status") {
    const { data } = await server.rpc("vote_status", {
      p_poll_id: poll.id,
      p_device_hash: deviceHash,
    });
    return reply(200, { voted: data ?? null });
  }

  const optionId = body.option_id ?? "";
  if (!UUID.test(optionId)) return reply(400, { error: "bad_request" });
  if (poll.closed_at || new Date(poll.closes_at).getTime() <= Date.now())
    return reply(409, { error: "closed" });

  // Guests prove they are a person, once per tap (spec 7.3 #4). A session is proof enough.
  if (!voterId) {
    const token = body.token ?? "";
    if (!token || !(await turnstilePasses(token, address)))
      return reply(403, { error: "bot_check" });
  }

  const { data, error } = await server.rpc("record_vote", {
    p_poll_id: poll.id,
    p_option_id: optionId,
    p_voter_id: voterId,
    p_device_hash: deviceHash,
    p_ip_hash: ipHash,
  });
  if (error) {
    const known = [
      "already_voted",
      "too_many_network",
      "blocked",
      "closed",
      "not_found",
      "not_ready",
      "bad_device",
    ];
    const reason = known.find((k) => error.message.includes(k)) ?? "failed";
    const status =
      reason === "already_voted"
        ? 409
        : reason === "too_many_network"
          ? 429
          : reason === "blocked"
            ? 403
            : reason === "not_found"
              ? 404
              : reason === "failed"
                ? 500
                : 409;
    if (reason === "failed") console.error("record_vote", error.message);
    return reply(status, { error: reason, closes_at: poll.closes_at });
  }
  return reply(200, { ok: true, ...(data as Record<string, unknown>) });
});
