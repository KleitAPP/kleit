/**
 * price-watch (spec 11 #4; migration 088): reads the store page of a few saved pieces and
 * records what it found. Called hourly by the database through pg_net with the sweep secret,
 * never by a person. The database decides what a reading means (a drop tells the people who
 * saved the piece; a page gone twice marks it); this only fetches and reads, through the same
 * door every typed address goes through (`safeFetch`: public hosts only, a deadline, a byte
 * cap) and the same reader as Clip a link. A store that refuses is a reading of "blocked" and
 * nothing more; after five in a row the piece is left alone.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

import { looksLikeAShell, readProductPage } from "../_shared/product-page.ts";
import { SafeFetchError, safeFetch } from "../_shared/safe-fetch.ts";

const BATCH = 8;
const PAGE_DEADLINE_MS = 6_000;
const PAGE_MAX_BYTES = 1_500_000;

function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

type Due = {
  id: string;
  source_url: string;
  price_cents: number | null;
  price_currency: string | null;
};
type Reading = {
  status: "ok" | "no-price" | "blocked" | "gone";
  cents?: number;
  currency?: string;
  /** Sold out or back in stock (spec 4.8 #1), when the page said; absent when it did not. */
  soldOut?: boolean;
};

async function read(url: string): Promise<Reading> {
  try {
    const page = await safeFetch(url, {
      deadlineMs: PAGE_DEADLINE_MS,
      maxBytes: PAGE_MAX_BYTES,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    });
    if (page.status === 404 || page.status === 410) return { status: "gone" };
    if (page.status >= 400) return { status: "blocked" };
    if (!page.contentType.includes("html")) return { status: "blocked" };
    const html = new TextDecoder("utf-8", { fatal: false }).decode(page.bytes);
    if (looksLikeAShell(html)) return { status: "blocked" };
    const product = readProductPage(html, page.url);
    const stock = product.available === null ? {} : { soldOut: !product.available };
    if (product.priceCents == null) return { status: "no-price", ...stock };
    return {
      status: "ok",
      cents: product.priceCents,
      ...(product.currency ? { currency: product.currency } : {}),
      ...stock,
    };
  } catch (problem) {
    // A refused, slow or non-public address is a store that did not answer, not a dead page.
    if (problem instanceof SafeFetchError) return { status: "blocked" };
    console.error("[price-watch] read", problem instanceof Error ? problem.message : problem);
    return { status: "blocked" };
  }
}

Deno.serve(async (request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("SWEEP_SECRET");
  if (!url || !serviceKey) return Response.json({ problem: "not-configured" }, { status: 500 });
  if (!secret) return Response.json({ problem: "not-configured" }, { status: 503 });
  const given = request.headers.get("x-sweep-key") ?? "";
  if (!sameSecret(given, secret)) return Response.json({ problem: "not-allowed" }, { status: 401 });

  const server = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: due, error } = await server.rpc("claim_price_checks", { p_limit: BATCH });
  if (error) {
    console.error("[price-watch] could not list what is due:", error.message);
    return Response.json({ problem: "list-failed" }, { status: 502 });
  }

  let told = 0;
  const outcome: Record<string, string> = {};
  for (const item of (due ?? []) as Due[]) {
    const reading = await read(item.source_url);
    const { data: n, error: recordError } = await server.rpc("record_price_check", {
      p_item: item.id,
      p_status: reading.status,
      p_cents: reading.cents ?? null,
      p_currency: reading.currency ?? null,
      p_sold_out: reading.soldOut ?? null,
    });
    if (recordError) {
      console.error(`[price-watch] ${item.id}: record: ${recordError.message}`);
      outcome[item.id] = "record-failed";
      continue;
    }
    told += typeof n === "number" ? n : 0;
    const stock = reading.soldOut === undefined ? "" : reading.soldOut ? " sold-out" : " in-stock";
    outcome[item.id] =
      (reading.status === "ok"
        ? item.price_cents != null && reading.cents != null && reading.cents < item.price_cents
          ? `drop ${item.price_cents}→${reading.cents}`
          : `ok ${reading.cents}`
        : reading.status) + stock;
  }
  return Response.json({ checked: (due ?? []).length, told, outcome });
});
