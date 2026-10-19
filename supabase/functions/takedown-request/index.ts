/**
 * takedown-request (roadmap M7.4; spec 13.3 #3–#4, 10.5 #2, #4): the TAKE IT DOWN, DMCA,
 * impersonation and trademark forms' one door. Anyone, with no account: the Worker's /takedown,
 * /copyright, /impersonation and /trademark pages POST here with a Turnstile token. The function
 * checks the token, the shape of the request and a daily limit per network, writes the row with
 * the service key (the table takes no inserts from anyone else) and hands back a reference the
 * sender can check at /takedown/status.
 *
 * An impersonation claim may carry up to two photos of an ID (data URLs, 5 MB each, JPEG/PNG/
 * WebP/HEIC). They go into the private `id-verification` bucket under the reference and are
 * purged thirty days after the claim by purge-files (migration 108); only a moderator can ever
 * see them, through id-photo.
 *
 * The DMCA counter-notice (spec 13.3 #4) comes through the same door as kind "counter": the
 * notice's reference, the sender's name, address, phone and email, the two statements, and a
 * signature; the database's file_counter_notice checks the notice is a copyright one that
 * removed a picture (migration 115) and hands back a C- reference.
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
const KINDS = ["intimate", "copyright", "impersonation", "trademark"] as const;
type Kind = (typeof KINDS)[number];
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};
const PHOTO_BYTES = 5 * 1024 * 1024;

/** A data URL from the form, checked and decoded; null when it is not a photo we take. */
function readPhoto(raw: unknown): { bytes: Uint8Array; type: string; ext: string } | null {
  if (typeof raw !== "string") return null;
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(raw);
  if (!m) return null;
  const type = m[1].toLowerCase();
  const ext = PHOTO_TYPES[type];
  if (!ext) return null;
  if (m[2].length > (PHOTO_BYTES * 4) / 3 + 4) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length === 0 || bytes.length > PHOTO_BYTES) return null;
    return { bytes, type, ext };
  } catch {
    return null;
  }
}

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
    photos?: unknown;
    token?: string;
    takedown_ref?: string;
    address?: string;
    phone?: string;
    consent?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "bad_json" });
  }
  if (body.kind === "counter") return counterNotice(request, body, url, serviceKey);
  const kind: Kind | null = (KINDS as readonly string[]).includes(String(body.kind))
    ? (body.kind as Kind)
    : null;
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
  if ((kind === "copyright" || kind === "trademark") && (!work || !signature || !statements))
    return reply(400, { error: "incomplete_dmca" });
  if (kind === "impersonation" && !details) return reply(400, { error: "incomplete" });
  const photos =
    kind === "impersonation" && Array.isArray(body.photos)
      ? body.photos.slice(0, 2).map(readPhoto)
      : [];
  if (photos.some((p) => p === null)) return reply(400, { error: "bad_photo" });

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
  const id_paths: string[] = [];
  for (const [n, photo] of photos.entries()) {
    if (!photo) continue;
    const path = `${request_ref}/${n + 1}.${photo.ext}`;
    const { error: upError } = await admin.storage
      .from("id-verification")
      .upload(path, photo.bytes, { contentType: photo.type, upsert: false });
    if (upError) return reply(500, { error: "photo_failed" });
    id_paths.push(path);
  }
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
    id_paths,
    ip_hash: ipHash,
  });
  if (error) {
    // No row, no photos: a file nothing points at would never come due for the purge.
    if (id_paths.length) await admin.storage.from("id-verification").remove(id_paths);
    return reply(500, { error: "failed" });
  }
  return reply(200, { ok: true, ref: request_ref, hours: kind === "intimate" ? 48 : 72 });
});

/** The counter-notice's door (migration 115): the same bot check and daily limit, then the database decides. */
async function counterNotice(
  request: Request,
  body: {
    takedown_ref?: string;
    name?: string;
    email?: string;
    address?: string;
    phone?: string;
    details?: string;
    statements?: boolean;
    consent?: boolean;
    signature?: string;
    token?: string;
  },
  url: string,
  serviceKey: string,
): Promise<Response> {
  const takedownRef = String(body.takedown_ref ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 20);
  const name = String(body.name ?? "")
    .trim()
    .slice(0, 120);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const address = String(body.address ?? "")
    .trim()
    .slice(0, 300);
  const phone = String(body.phone ?? "")
    .trim()
    .slice(0, 40);
  const details = String(body.details ?? "")
    .trim()
    .slice(0, 2000);
  const signature = String(body.signature ?? "")
    .trim()
    .slice(0, 120);
  if (
    !/^T-[A-Z2-9]{8}$/.test(takedownRef) ||
    !name ||
    !EMAIL.test(email) ||
    !address ||
    !signature ||
    body.statements !== true ||
    body.consent !== true
  )
    return reply(400, { error: "incomplete" });

  const secret = turnstileSecret();
  if (!secret) return reply(503, { error: "not_configured" });
  const clientIp = clientAddress(request);
  if (!(await turnstilePasses(secret, body.token, clientIp)))
    return reply(403, { error: "bot_check" });

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ipHash = await hmac(serviceKey, `takedown:${clientIp}`);
  {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin
      .from("counter_notices")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);
    if ((count ?? 0) >= 5) return reply(429, { error: "too_many" });
  }
  const { data, error } = await admin.rpc("file_counter_notice", {
    p_takedown_ref: takedownRef,
    p_name: name,
    p_email: email,
    p_address: address,
    p_phone: phone,
    p_details: details,
    p_statements: true,
    p_consent: true,
    p_signature: signature,
    p_ip_hash: ipHash,
  });
  if (error) {
    if (error.code === "P0002") return reply(404, { error: "not_found" });
    if (error.code === "P0001") return reply(409, { error: "already_open" });
    return reply(500, { error: "failed" });
  }
  return reply(200, { ok: true, ref: data as string });
}
