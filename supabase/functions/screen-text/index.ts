/**
 * screen-text (spec 13.2 #1; migration 071): the outside second opinion on comments, captions
 * and bios. Called by pg_cron through pg_net with the sweep secret, never by a person. Takes a
 * batch from `claim_text_checks`, asks OpenAI's moderation endpoint (free; the key is the
 * owner's, in the function's environment as OPENAI_API_KEY), and records each answer through
 * `record_text_check`, which holds and reports what was flagged. With no key it claims nothing
 * and says so, so the queue simply waits.
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

type Due = { id: number; kind: string; target_id: string; body: string };
type Moderation = { results?: { flagged?: boolean; categories?: Record<string, boolean> }[] };

async function moderate(key: string, text: string): Promise<{ flagged: boolean; labels: string[] }> {
  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
  });
  if (!response.ok) throw new Error(`moderation ${response.status}`);
  const body = (await response.json()) as Moderation;
  const first = body.results?.[0];
  if (!first) throw new Error("moderation: no result");
  const labels = Object.entries(first.categories ?? {})
    .filter(([, on]) => on === true)
    .map(([name]) => name);
  return { flagged: first.flagged === true, labels };
}

Deno.serve(async (request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("SWEEP_SECRET");
  if (!url || !serviceKey) return Response.json({ problem: "not-configured" }, { status: 500 });
  if (!secret) return Response.json({ problem: "not-configured" }, { status: 503 });
  const given = request.headers.get("x-sweep-key") ?? "";
  if (!sameSecret(given, secret)) return Response.json({ problem: "not-allowed" }, { status: 401 });
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (!openai) return Response.json({ skipped: "no-key" });

  const server = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: due, error } = await server.rpc("claim_text_checks", { p_limit: BATCH });
  if (error) return Response.json({ problem: "claim-failed" }, { status: 502 });

  const outcome: Record<string, string> = {};
  for (const row of (due ?? []) as Due[]) {
    try {
      const verdict = await moderate(openai, row.body);
      const labels: Record<string, boolean> = {};
      for (const l of verdict.labels) labels[l] = true;
      const { error: recordError } = await server.rpc("record_text_check", {
        p_id: row.id,
        p_state: verdict.flagged ? "flagged" : "ok",
        p_labels: labels,
      });
      if (recordError) throw new Error(`record: ${recordError.message}`);
      outcome[String(row.id)] = verdict.flagged ? `flagged:${verdict.labels.join(",")}` : "ok";
    } catch (problem) {
      console.error(`[screen-text] ${row.id}:`, problem instanceof Error ? problem.message : String(problem));
      await server.rpc("record_text_check", { p_id: row.id, p_state: "failed" });
      outcome[String(row.id)] = "failed";
    }
  }
  return Response.json({ checked: (due ?? []).length, outcome });
});
