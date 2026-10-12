/**
 * contact-form (roadmap M7.5): the /contact page's one door. Anyone, with no account: the
 * Worker's page POSTs here with a Turnstile token. The function checks the token, the shape of
 * the message and a daily limit per network, writes the row with the service key (the table
 * takes no inserts from anyone else) and hands back a reference. If the sender was signed in,
 * their id goes on the row so a moderator can see which account wrote.
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
const TOPICS = ["question", "bug", "account", "safety", "other"];

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
  return "C-" + [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply(405, { error: "method" });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { error: "not_configured" });

  let body: {
    topic?: string;
    name?: string;
    email?: string;
    message?: string;
    client?: string;
    token?: string;
  };
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "bad_json" });
  }
  const topic = TOPICS.includes(String(body.topic)) ? String(body.topic) : null;
  const name = String(body.name ?? "")
    .trim()
    .slice(0, 120);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const message = String(body.message ?? "")
    .trim()
    .slice(0, 4000);
  const client = String(body.client ?? "")
    .trim()
    .slice(0, 300);
  if (!topic || !name || !EMAIL.test(email) || !message) return reply(400, { error: "incomplete" });

  const secret = turnstileSecret();
  if (!secret) return reply(503, { error: "not_configured" });
  const address = clientAddress(request);
  if (!(await turnstilePasses(secret, body.token, address)))
    return reply(403, { error: "bot_check" });

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // A signed-in sender: the page passes the session token; the row remembers who wrote.
  let userId: string | null = null;
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const { data } = await admin.auth.getUser(auth.slice(7));
    userId = data.user?.id ?? null;
  }

  const ipHash = await hmac(serviceKey, `contact:${address}`);
  {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin
      .from("contact_messages")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);
    if ((count ?? 0) >= 5) return reply(429, { error: "too_many" });
  }
  const request_ref = ref();
  const { error } = await admin
    .from("contact_messages")
    .insert({ request_ref, topic, name, email, message, client, user_id: userId, ip_hash: ipHash });
  if (error) return reply(500, { error: "failed" });
  return reply(200, { ok: true, ref: request_ref });
});
