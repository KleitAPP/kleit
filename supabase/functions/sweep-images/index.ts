/**
 * sweep-images — the safety net under `ingest-image` (open problem CL25; spec 13.1).
 *
 * Why it exists. When a photo is added, the app asks `ingest-image` to screen it and waits for
 * the answer. A cold start plus a full decode plus an AWS round trip can outlast that wait, and
 * when it did, the screen truthfully said "still checking" - and then nothing ever checked. The
 * item sat unscanned, which is invisible (safe), for ever (useless).
 *
 * What it does. Every couple of minutes the database calls this function (migration 014:
 * pg_cron -> pg_net -> here). It asks the database to hand it a batch of items that have a
 * picture, are old enough that the app's own call has had its chance, and are still not
 * screened - and it runs the same shared pipeline over each one. The batch is *claimed* in the
 * database in one statement (`claim_scans`), which is what stops two sweeps that overlap from
 * scanning the same photo twice.
 *
 * What it never does. It never marks anything clean on its own - only the pipeline does that,
 * and only from a real AWS answer. It never scans a photo more than a handful of times: after
 * `MAX_ATTEMPTS` the item stays pending and invisible, and the count in `item_flags.attempts` is
 * how a person finds it. And it cannot be pointed at an item: it takes no arguments at all.
 *
 * Who may call it. Only something holding the sweep secret, which lives in two places - this
 * function's environment and the database's vault - and nowhere else. CI generates a fresh one
 * on every deploy. The database's request is the only thing that carries it.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

import { screenItem, ScreenFailure, awsKeysFromEnv } from "../_shared/screen.ts";

const BATCH = 10;

function sameSecret(given: string, expected: string): boolean {
  // Compared byte by byte with no early exit, so how long a wrong guess takes says nothing
  // about how much of it was right.
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

Deno.serve(async (request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("SWEEP_SECRET");
  if (!url || !serviceKey) return Response.json({ problem: "not-configured" }, { status: 500 });
  // No secret configured means nobody may call this, not that anybody may.
  if (!secret) return Response.json({ problem: "not-configured" }, { status: 503 });

  const given = request.headers.get("x-sweep-key") ?? "";
  if (!sameSecret(given, secret)) return Response.json({ problem: "not-allowed" }, { status: 401 });

  const server = createClient(url, serviceKey);

  const { data: batch, error: claimError } = await server.rpc("claim_scans", { p_limit: BATCH });
  if (claimError) {
    console.error("[sweep-images] could not claim a batch:", claimError.message);
    return Response.json({ problem: "claim-failed" }, { status: 502 });
  }

  const aws = awsKeysFromEnv();
  const outcome: Record<string, string> = {};
  for (const item of (batch ?? []) as Array<{ id: string; image_id: string; image_bucket: string | null }>) {
    try {
      const verdict = await screenItem(server, item, aws);
      outcome[item.id] = verdict.state;
    } catch (problem) {
      // Logged and moved past. The item stays pending - invisible - and its attempt is already
      // counted, so a photo that fails every time runs out of tries rather than running for ever.
      outcome[item.id] = problem instanceof ScreenFailure ? `failed:${problem.stage}` : "failed";
    }
  }

  console.log("[sweep-images]", Object.keys(outcome).length, "item(s)", JSON.stringify(outcome));
  return Response.json({ swept: Object.keys(outcome).length, outcome });
});
