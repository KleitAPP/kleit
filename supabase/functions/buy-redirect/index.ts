/**
 * buy-redirect — a Buy tap goes to the store, and we remember that a tap happened
 * (spec 8.2 #13 and #14; roadmap M2.7; technical pack §1.9 `clicks`).
 *
 * What it knows: which item, which set (if any), which network. What it never knows: who. The
 * request carries no user token and the function does not ask for one - a Buy link has to work
 * for a signed-out visitor on a shared page (M3.9) exactly as it does for a member, and a row that
 * cannot hold a person cannot leak one.
 *
 * Where it sends you: ONLY to the address stored on the item. The store address in the query
 * would be an open redirect - a link that looks like ours and lands anywhere - so it is not
 * accepted. An item that is deleted, taken down, or has no source is a 404, the same as an item
 * that does not exist.
 *
 * The link opens in the phone's own browser, never inside the app (Amazon's rule, spec 8.2 #14),
 * and the app's link carries `rel="noreferrer"` so the store does not learn which Kleit page the
 * tap came from. Both are the app's job; this function does not care who opened it.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NETWORK = /^[a-z0-9_-]{1,32}$/;

function plain(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD")
    return plain(405, "Method not allowed");

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return plain(500, "Not configured");

  const asked = new URL(request.url).searchParams;
  const itemId = asked.get("item") ?? "";
  const setId = asked.get("set") ?? "";
  const network = asked.get("network") ?? "direct";
  if (!UUID.test(itemId)) return plain(404, "Not found");
  if (setId && !UUID.test(setId)) return plain(404, "Not found");
  if (!NETWORK.test(network)) return plain(404, "Not found");

  const server = createClient(url, serviceKey);
  const { data: item } = await server
    .from("items")
    .select("id, kind, source_url, deleted_at, takedown_state, dead_link_at")
    .eq("id", itemId)
    .maybeSingle();

  // Only a store piece the catalogue shows: cleared by the scan, not deleted, not taken down,
  // its page not gone. Anything else is the same "not found" as an id that never existed.
  if (
    !item ||
    item.kind !== "product" ||
    item.deleted_at ||
    item.takedown_state !== "none" ||
    item.dead_link_at ||
    !item.source_url
  ) {
    return plain(404, "Not found");
  }
  const { data: flag } = await server
    .from("item_flags")
    .select("scan_state")
    .eq("item_id", item.id)
    .maybeSingle();
  if (flag?.scan_state !== "clean") return plain(404, "Not found");

  // A click counts against a set only when the piece is on it (the stats are the set's).
  let onSet: string | null = null;
  if (setId) {
    const { data: placed } = await server
      .from("set_items")
      .select("id")
      .eq("set_id", setId)
      .eq("item_id", item.id)
      .limit(1)
      .maybeSingle();
    onSet = placed ? setId : null;
  }

  // The stored address, and only if it is a web address. A `javascript:` or `data:` value in
  // that column would be a bug elsewhere; this is the last place it could do harm.
  let destination: URL;
  try {
    destination = new URL(item.source_url);
  } catch {
    return plain(404, "Not found");
  }
  if (destination.protocol !== "https:" && destination.protocol !== "http:")
    return plain(404, "Not found");

  // The store's affiliate network, if the admin has set one (migration 116; spec 16.1 #9): the
  // stored address goes into the network's template and the click is recorded under its name.
  // No row, or a template that does not read as a web address: straight to the store, as before.
  let location = destination.toString();
  let recordedNetwork = network;
  // The store's host, then each parent domain down to two labels (shop.zara.com → zara.com).
  const labels = destination.hostname.toLowerCase().split(".");
  const candidates = labels.map((_, i) => labels.slice(i).join(".")).filter((d) => d.split(".").length >= 2);
  let row: { network: string; link_template: string } | undefined;
  for (const domain of candidates) {
    const { data: affiliate } = await server.rpc("affiliate_for", { p_domain: domain });
    row = (affiliate ?? [])[0] as { network: string; link_template: string } | undefined;
    if (row) break;
  }
  if (row) {
    const rewritten = row.link_template
      .replaceAll("{url}", encodeURIComponent(destination.toString()))
      .replaceAll("{raw}", destination.toString());
    try {
      const parsed = new URL(rewritten);
      if (parsed.protocol === "https:") {
        location = parsed.toString();
        recordedNetwork = row.network;
      }
    } catch {
      /* a broken template sends the person to the store, not nowhere */
    }
  }

  // Recorded before the redirect, and if the record fails the person still gets to the store:
  // a click we could not count is our loss, not theirs.
  const { error } = await server.from("clicks").insert({
    item_id: item.id,
    set_id: onSet,
    network: recordedNetwork,
  });
  if (error) console.error("[buy-redirect] could not record the click:", error.message);

  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
    },
  });
});
