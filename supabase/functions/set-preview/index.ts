/**
 * set-preview — the picture a group chat shows next to a shared link (roadmap M3.3/M3.5;
 * technical pack §3.1 `set-previews`; open problem CL30).
 *
 * Called by the app after a publish and after a layout save on a published set. It draws the
 * set the way the shared page shows it - the background colour, the pieces in their slots -
 * onto a 1200×1200 JPEG, writes it to the public `set-previews` bucket under a VERSIONED name
 * (a preview already sitting in someone's chat must expire, not silently change), points
 * `sets.preview_image_id` at it, and removes the one before.
 *
 * It draws only what the shared page would show: the pieces `shared_set` (migration 021) says
 * may be pictured - cleared products, and a person's own piece only if their closet marks it
 * shareable. A set that is not published public or link gets no preview, and any old one is
 * taken down, because the picture is public from the moment it is written.
 *
 * Only the set's owner may ask (the caller's own token is used to read the row, so the row
 * policy decides); the writing is the server's.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decode, GIF, Image, type Frame } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SIDE = 1200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Slot = { x: number; y: number; w: number; h: number };
type Piece = { id: string; slot: number | null; pictured: boolean };
type Shared = {
  id: string;
  layout: { background?: string; template?: string } | null;
  pieces: Piece[];
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function colour(hex: string | undefined): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  const n = m ? parseInt(m[1]!, 16) : 0xf4efe6;
  return Image.rgbToColor((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

function still(decoded: Image | GIF): Image {
  if (decoded instanceof GIF) {
    const frame: Frame | undefined = decoded[0];
    if (!frame) throw new Error("no frame");
    // A Frame is an Image with timing on it; copy the pixels into a plain Image to draw with.
    return new Image(frame.width, frame.height).composite(frame as unknown as Image, 0, 0);
  }
  return decoded;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply(405, { problem: "method" });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { problem: "not-configured" });

  let body: { set_id?: string };
  try {
    body = await request.json();
  } catch {
    return reply(400, { problem: "bad-request" });
  }
  const setId = body.set_id ?? "";
  if (!UUID.test(setId)) return reply(400, { problem: "bad-request" });

  // The caller must be the owner. Their own token reads the row; the policy answers.
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: request.headers.get("Authorization") ?? "" } },
  });
  const { data: who } = await asCaller.auth.getUser();
  if (!who.user) return reply(401, { problem: "signed-out" });
  const { data: mine } = await asCaller
    .from("sets")
    .select("id, owner_id, status, visibility, share_code, preview_image_id")
    .eq("id", setId)
    .maybeSingle();
  if (!mine || mine.owner_id !== who.user.id) return reply(404, { problem: "not-found" });

  const server = createClient(url, serviceKey);
  const previous = mine.preview_image_id as string | null;

  // Not something the world may see: no picture, and any old one goes.
  const shareable =
    mine.status === "published" && (mine.visibility === "public" || mine.visibility === "link");
  if (!shareable) {
    if (previous) {
      await server.from("sets").update({ preview_image_id: null }).eq("id", setId);
      await server.storage.from("set-previews").remove([previous]);
    }
    return reply(200, { ok: true, preview: null });
  }

  // What the shared page shows - the same function, so the two can never disagree.
  const { data: shared } = await server.rpc("shared_set", { p_code: mine.share_code });
  const set = shared as Shared | null;
  if (!set?.id) return reply(409, { problem: "not-shareable" });

  const { data: template } = set.layout?.template
    ? await server.from("templates").select("layout").eq("id", set.layout.template).maybeSingle()
    : { data: null };
  const tpl =
    (template?.layout as { canvas?: { w: number; h: number }; slots?: Slot[] } | null) ?? null;
  const canvasW = tpl?.canvas?.w ?? 1080;
  const canvasH = tpl?.canvas?.h ?? 1350;
  const slots = tpl?.slots ?? [];

  // The set's canvas fitted inside a square, on the set's own background.
  const scale = Math.min(SIDE / canvasW, SIDE / canvasH);
  const drawnW = Math.round(canvasW * scale);
  const drawnH = Math.round(canvasH * scale);
  const offX = Math.round((SIDE - drawnW) / 2);
  const offY = Math.round((SIDE - drawnH) / 2);
  const picture = new Image(SIDE, SIDE).fill(colour(set.layout?.background));

  for (const piece of set.pieces) {
    if (!piece.pictured || piece.slot === null) continue;
    const slot = slots[piece.slot];
    if (!slot) continue;
    const { data: item } = await server
      .from("items")
      .select("image_id, image_bucket")
      .eq("id", piece.id)
      .maybeSingle();
    if (!item?.image_id) continue;
    const bucket = item.image_bucket === "closet-photos" ? "closet-photos" : "item-images";
    const { data: file } = await server.storage.from(bucket).download(item.image_id);
    if (!file) continue;
    let art: Image;
    try {
      art = still(await decode(new Uint8Array(await file.arrayBuffer())));
    } catch {
      continue;
    }
    // Contain inside the slot, centred - the same as object-contain on the page.
    const boxW = Math.max(1, Math.round(slot.w * drawnW));
    const boxH = Math.max(1, Math.round(slot.h * drawnH));
    const fit = Math.min(boxW / art.width, boxH / art.height);
    const w = Math.max(1, Math.round(art.width * fit));
    const h = Math.max(1, Math.round(art.height * fit));
    art.resize(w, h);
    const x = offX + Math.round(slot.x * drawnW + (boxW - w) / 2);
    const y = offY + Math.round(slot.y * drawnH + (boxH - h) / 2);
    picture.composite(art, x, y);
  }

  const jpeg = await picture.encodeJPEG(85);
  const path = `${setId}/${Date.now()}.jpg`;
  const { error: upErr } = await server.storage
    .from("set-previews")
    .upload(path, jpeg, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (upErr) return reply(500, { problem: "write-failed" });
  const { error: rowErr } = await server
    .from("sets")
    .update({ preview_image_id: path })
    .eq("id", setId);
  if (rowErr) {
    await server.storage.from("set-previews").remove([path]);
    return reply(500, { problem: "write-failed" });
  }
  if (previous && previous !== path) await server.storage.from("set-previews").remove([previous]);

  return reply(200, { ok: true, preview: path });
});
