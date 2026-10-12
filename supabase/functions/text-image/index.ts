/**
 * text-image — a text layer of a shared set, as a picture (roadmap M4.3; spec 6.2 #1).
 *
 * The shared page draws text in a curated font itself, with the font served from the site. A
 * private font must never leave the account, so for those layers the page asks here and gets
 * the words already drawn: the server reads the owner's font from the private bucket and
 * returns pixels. Answers only for a set the world may see (published, public or link), and
 * only with a font from the set owner's own folder; anything else is the same 404.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

import { drawText, fontBytes, type TextStyle } from "../_shared/text-draw.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

type TextLayer = { kind: "text"; text: TextStyle; w: number; hidden?: boolean };

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return new Response("Not configured", { status: 500 });

  const params = new URL(request.url).searchParams;
  const setId = params.get("set") ?? "";
  const layerId = params.get("layer") ?? "";
  if (!UUID.test(setId) || !/^[A-Za-z0-9_-]{1,80}$/.test(layerId)) return notFound();

  const server = createClient(url, serviceKey);
  const { data: set } = await server
    .from("sets")
    .select("owner_id, status, visibility, deleted_at, takedown_state, layout")
    .eq("id", setId)
    .maybeSingle();
  if (
    !set ||
    set.status !== "published" ||
    !["public", "link"].includes(set.visibility) ||
    set.deleted_at ||
    set.takedown_state !== "none"
  )
    return notFound();

  // The same door the share page's own reader keeps (hidden_share_links, 055): a banned, on-a-break
  // or deleting owner's set is dark everywhere, its words included.
  const { data: owner } = await server
    .from("profiles")
    .select("deactivated_at, banned_at")
    .eq("user_id", set.owner_id)
    .maybeSingle();
  if (!owner || owner.deactivated_at || owner.banned_at) return notFound();

  const layout = set.layout as { version?: number; texts?: Record<string, TextLayer> } | null;
  const layer = layout?.version === 2 ? layout.texts?.[layerId] : undefined;
  if (!layer || layer.kind !== "text" || !layer.text || layer.hidden) return notFound();

  const font = await fontBytes(layer.text.font, set.owner_id, async (path) => {
    const { data } = await server.storage.from("private-fonts").download(path);
    return data ? new Uint8Array(await data.arrayBuffer()) : null;
  });
  if (!font) return notFound();

  try {
    const picture = await drawText(layer.text, layer.w, font);
    const png = await picture.encode();
    return new Response(new Blob([png as BlobPart]), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return notFound();
  }
});
