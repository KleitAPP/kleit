/**
 * purge-files (CL42; spec 13.3 #3, 14.2): deletes the stored picture of an item that has been
 * taken down, or deleted more than 30 days ago. Called by the nightly cleanup through pg_net with
 * the sweep secret (migration 057), never by a person. A taken-down picture is copied into the
 * private `evidence` bucket first - evidence is preserved, never shown - then removed from its
 * bucket; the row is marked purged by `mark_purged`. One failure is logged and skipped;
 * the row stays due and is tried again tomorrow.
 *
 * The same night, the ID photos of impersonation claims past thirty days (migration 108) go from
 * the private `id-verification` bucket, and the claim forgets their paths.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const BATCH = 20;

function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

type Due = { id: string; image_bucket: string; image_id: string; keep_evidence: boolean };

Deno.serve(async (request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("SWEEP_SECRET");
  if (!url || !serviceKey) return Response.json({ problem: "not-configured" }, { status: 500 });
  if (!secret) return Response.json({ problem: "not-configured" }, { status: 503 });
  const given = request.headers.get("x-sweep-key") ?? "";
  if (!sameSecret(given, secret)) return Response.json({ problem: "not-allowed" }, { status: 401 });

  const server = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: due, error } = await server.rpc("claim_purges", { p_limit: BATCH });
  if (error) {
    console.error("[purge-files] could not list what is due:", error.message);
    return Response.json({ problem: "list-failed" }, { status: 502 });
  }

  const outcome: Record<string, string> = {};
  for (const item of (due ?? []) as Due[]) {
    try {
      if (item.keep_evidence) {
        const { data: file, error: readError } = await server.storage.from(item.image_bucket).download(item.image_id);
        if (readError) throw new Error(`read: ${readError.message}`);
        const { error: keepError } = await server.storage
          .from("evidence")
          .upload(`takedowns/${item.id}`, file, { contentType: file.type || "application/octet-stream", upsert: true });
        if (keepError) throw new Error(`evidence: ${keepError.message}`);
      }
      const { error: removeError } = await server.storage.from(item.image_bucket).remove([item.image_id]);
      if (removeError) throw new Error(`remove: ${removeError.message}`);
      const { error: markError } = await server.rpc("mark_purged", { p_item: item.id });
      if (markError) throw new Error(`mark: ${markError.message}`);
      outcome[item.id] = item.keep_evidence ? "purged+evidence" : "purged";
    } catch (problem) {
      console.error(`[purge-files] ${item.id}:`, problem instanceof Error ? problem.message : String(problem));
      outcome[item.id] = "failed";
    }
  }
  // The ID photos (CL69): thirty days after the claim, whatever its outcome.
  const ids: Record<string, string> = {};
  const { data: idDue } = await server.rpc("claim_id_purges", { p_limit: BATCH });
  for (const claim of (idDue ?? []) as { id: string; paths: string[] }[]) {
    try {
      if (claim.paths.length > 0) {
        const { error: removeError } = await server.storage.from("id-verification").remove(claim.paths);
        if (removeError) throw new Error(`remove: ${removeError.message}`);
      }
      const { error: markError } = await server.rpc("mark_id_purged", { p_id: claim.id });
      if (markError) throw new Error(`mark: ${markError.message}`);
      ids[claim.id] = "purged";
    } catch (problem) {
      console.error(`[purge-files] id ${claim.id}:`, problem instanceof Error ? problem.message : String(problem));
      ids[claim.id] = "failed";
    }
  }
  return Response.json({ due: (due ?? []).length, outcome, ids });
});
