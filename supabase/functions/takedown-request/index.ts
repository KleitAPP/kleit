/**
 * takedown-request (roadmap M7.4; spec 13.3 #3–#4): the TAKE IT DOWN and DMCA forms' one door.
 * Anyone, with no account: the Worker's /takedown and /copyright pages POST here with a
 * Turnstile token. The function checks the token, the shape of the request and a daily limit
 * per network, writes the row with the service key (the table takes no inserts from anyone
 * else) and hands back a reference the sender can check at /takedown/status.
 *
 * No Turnstile keys of our own exist yet (OW15): the test secret passes everyone until then.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { clientAddress, turnstilePasses, turnstileSecret } from "../_shared/guest-door.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_OK = /^https?:\/\/[^\s]{4,500}$/;

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
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ref(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "T-" + [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply(405, { error: "method" });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { error: "not_configured" });

  let body: {
    kind?: string;
    name?: string;
    email?: string;
    urls?: unknown;
    details?: string;
    work?: string;
    statements?: boolean;
    signature?: string;
    token?: string;
  };
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "bad_json" });
  }
  const kind =
    body.kind === "copyright" ? "copyright" : body.kind === "intimate" ? "intimate" : null;
  const name = String(body.name ?? "")
    .trim()
    .slice(0, 120);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const urls = Array.isArray(body.urls)
    ? body.urls
        .map((u) => String(u).trim())
        .filter((u) => URL_OK.test(u))
        .slice(0, 20)
    : [];
  const details = String(body.details ?? "")
    .trim()
    .slice(0, 2000);
  const work = String(body.work ?? "")
    .trim()
    .slice(0, 1000);
  const signature = String(body.signature ?? "")
    .trim()
    .slice(0, 120);
  const statements = body.statements === true;
  if (!kind || !name || !EMAIL.test(email) || urls.length === 0)
    return reply(400, { error: "incomplete" });
  if (kind === "copyright" && (!work || !signature || !statements))
    return reply(400, { error: "incomplete_dmca" });

  const secret = turnstileSecret();
  if (!secret) return reply(503, { error: "not_configured" });
  const address = clientAddress(request);
  if (!(await turnstilePasses(secret, body.token, address)))
    return reply(403, { error: "bot_check" });

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ipHash = await hmac(serviceKey, `takedown:${address}`);
  {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin
      .from("takedown_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);
    if ((count ?? 0) >= 5) return reply(429, { error: "too_many" });
  }
  const request_ref = ref();
  const { error } = await admin.from("takedown_requests").insert({
    request_ref,
    kind,
    name,
    email,
    urls,
    details,
    work,
    statements,
    signature,
    ip_hash: ipHash,
  });
  if (error) return reply(500, { error: "failed" });
  return reply(200, { ok: true, ref: request_ref, hours: kind === "intimate" ? 48 : 72 });
});
