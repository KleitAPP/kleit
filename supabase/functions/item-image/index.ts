/**
 * item-image — the picture of a catalogue item, for anyone allowed to see the item
 * (roadmap M2.7/M2.8; technical pack §3.1; spec 4.7).
 *
 * `item-images` is a private bucket on purpose: a bucket cannot ask whether a picture has passed
 * screening, so a public one would serve an unscanned photo to anyone who guessed the path.
 * This function is the gate the bucket cannot be. It answers only for an item that is
 *
 *   - a product (a person's own piece is theirs alone until a shared set says otherwise, M3.1),
 *   - not deleted and not taken down,
 *   - and cleared by screening - the same question the `items` read policy asks,
 *
 * and then sends the browser to a signed address that dies after ten minutes. It is the stand-in
 * for Cloudflare Images (decision 103's delivery), which takes over at the domain stage; nothing
 * about the stored original changes then.
 *
 * No token is asked for. The id is an unguessable uuid, and the answer for an item the caller
 * may not see is the same 404 as for one that does not exist.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return new Response("Not configured", { status: 500 });

  const itemId = new URL(request.url).searchParams.get("item") ?? "";
  if (!UUID.test(itemId)) return notFound();

  const server = createClient(url, serviceKey);
  const { data: item } = await server
    .from("items")
    .select("id, kind, deleted_at, takedown_state, image_id, image_bucket")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || item.kind !== "product" || item.deleted_at || item.takedown_state !== "none" || !item.image_id) return notFound();

  const { data: flag } = await server.from("item_flags").select("scan_state").eq("item_id", itemId).maybeSingle();
  if (flag?.scan_state !== "clean") return notFound();

  const bucket = item.image_bucket === "closet-photos" ? "closet-photos" : "item-images";
  const { data: signed } = await server.storage.from(bucket).createSignedUrl(item.image_id, 600);
  if (!signed?.signedUrl) return notFound();

  return new Response(null, {
    status: 302,
    headers: {
      Location: signed.signedUrl,
      // Private: a shared cache must not hand one person's answer to the next. Five minutes is
      // well inside the signed address's ten.
      "Cache-Control": "private, max-age=300",
    },
  });
});
