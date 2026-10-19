/**
 * id-photo (CL69; spec 10.5 #2): the one way a photo of an ID from an impersonation claim is ever
 * seen. The caller must be signed in AND a moderator (my_roles, as that person); the answer is a
 * signed address good for two minutes, as JSON for the moderation screen to open. The bucket
 * itself has no read policy, so nothing but this function and the purge can reach a photo, and
 * the purge removes it thirty days after the claim (migration 108). Every view is logged in
 * admin_audit_log first (spec 13.4 #9).
 *
 * GET ?path=<ref>/<n>.<ext> - the path as the claim row carries it; anything else is 404.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const PATH = /^T-[A-Z2-9]{8}\/[12]\.(jpg|png|webp|heic)$/;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "GET") return reply(405, { problem: "method" });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return reply(500, { problem: "not-configured" });

  const authorization = request.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(authorization)) return reply(401, { problem: "signed-out" });
  const me = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: roles, error }, { data: who }] = await Promise.all([me.rpc("my_roles"), me.auth.getUser()]);
  if (error || !who?.user) return reply(401, { problem: "signed-out" });
  const list = (roles ?? []) as string[];
  if (!list.includes("moderator") && !list.includes("admin")) return reply(403, { problem: "moderators-only" });

  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!PATH.test(path)) return reply(404, { problem: "not-found" });

  const server = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Every view of an ID photo is logged before it is shown (spec 13.4 #9): the moderator, the
  // claim, and the reason. No row, no photo.
  const ref = path.slice(0, path.indexOf("/"));
  const { data: claim } = await server.from("takedown_requests").select("id").eq("request_ref", ref).maybeSingle();
  const logged = await server
    .from("admin_audit_log")
    .insert({ admin_id: who.user.id, what: "private_view", target_id: claim?.id ?? null, reason: `ID photo of claim ${ref}` });
  if (logged.error) return reply(500, { problem: "not-logged" });
  const { data: signed } = await server.storage.from("id-verification").createSignedUrl(path, 120);
  if (!signed?.signedUrl) return reply(404, { problem: "not-found" });
  return reply(200, { url: signed.signedUrl, seconds: 120 });
});
