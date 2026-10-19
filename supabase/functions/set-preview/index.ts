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
import { decodable } from "../_shared/image-size.ts";

// deno-lint-ignore-file no-explicit-any
import decodeWebp from "npm:@jsquash/webp@1.5.0/decode.js";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";

import { drawText, fontBytes, SITE_URL, type TextStyle } from "../_shared/text-draw.ts";
import {
  backingBox,
  backingRgba,
  backingTone,
  boxBlur,
  textBackOf,
  type TextBack,
} from "../_shared/text-back.ts";
// Catalogue id → [file, title] for the decoration library (written by scripts/build-library.mjs).
import LIBRARY from "../_shared/library-files.json" with { type: "json" };

const LIB = LIBRARY as unknown as {
  assets: Record<string, [string, string]>;
  backgrounds: Record<string, [string, string]>;
};

// resvg's wasm, fetched once per isolate from a pinned CDN copy; a miss only costs the
// structural pieces in the picture, never the picture.
let resvgReady: Promise<boolean> | null = null;
function resvg(): Promise<boolean> {
  resvgReady ??= initWasm(
    fetch("https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm"),
  ).then(
    () => true,
    () => false,
  );
  return resvgReady;
}

/**
 * A library picture from the site's own /library/ folder, decoded: WebP through @jsquash (imagescript
 * cannot read it); a structural SVG rendered by resvg in the colour the owner chose.
 */
async function libraryImage(file: string, colour?: string): Promise<Image | null> {
  try {
    const r = await fetch(`${SITE_URL}/library/${file}`);
    if (!r.ok) return null;
    if (file.endsWith(".svg")) {
      if (!(await resvg())) return null;
      const hex = /^#[0-9a-fA-F]{6}$/.test(colour ?? "") ? colour! : "#161513";
      const svg = (await r.text()).replace(/currentColor/g, hex);
      const png = new Resvg(svg, { fitTo: { mode: "width", value: 900 } }).render().asPng();
      return still(await decode(png));
    }
    const raw = (await decodeWebp(await r.arrayBuffer())) as {
      width: number;
      height: number;
      data: Uint8ClampedArray;
    };
    const img = new Image(raw.width, raw.height);
    img.bitmap.set(raw.data);
    return img;
  } catch {
    return null;
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SIDE = 1200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Slot = { x: number; y: number; w: number; h: number };
type Position = {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  opacity?: number;
  hidden?: boolean;
  crop?: { x: number; y: number; w: number; h: number } | null;
};
type Piece = {
  id: string;
  row?: string;
  slot: number | null;
  position?: Position | null;
  pictured: boolean;
};
type Shared = {
  id: string;
  layout: {
    background?: string;
    template?: string;
    version?: number;
    canvas?: { w: number; h: number };
    order?: string[];
    texts?: Record<string, Position & { kind: "text"; text: TextStyle }>;
    decor?: Record<string, Position & { kind: "asset"; asset: string; colour?: string }>;
    backgroundAsset?: string | null;
  } | null;
  /** Catalogue ids of decorations pulled since the files shipped (migration 118): never drawn. */
  pulled?: unknown;
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

/**
 * What sits behind a text layer's words (spec 21 #6; text-back.ts): a scrim, a solid strip or
 * a blur of the picture so far, in the words' tone, padded and rounded like the canvas draws
 * it, rotated with the words. Drawn onto `picture` before the words go on; `w` and `h` are the
 * words' drawn, unrotated size and `cx`/`cy` their centre.
 */
function drawBacking(
  picture: Image,
  back: TextBack,
  style: { colour: string; size: number; back?: unknown },
  w: number,
  h: number,
  cx: number,
  cy: number,
  rotation: number,
  opacity: number,
  k: number,
): void {
  const tone = backingTone(style.colour);
  const rgba = backingRgba(back, tone);
  if (!rgba) return;
  const box = backingBox(style.size * k);
  const bw = Math.max(1, Math.round(w + 2 * box.padX));
  const bh = Math.max(1, Math.round(h + 2 * box.padY));
  const radius = Math.max(0, Math.min(Math.round(box.radius), Math.floor(Math.min(bw, bh) / 2)));
  const shape = (color: number) => {
    const img = new Image(bw, bh).fill(color);
    if (radius > 0) img.roundCorners(radius);
    if (rotation) img.rotate(rotation, true);
    return img;
  };
  if (back === "blur") {
    // The picture under the box, blurred, cut to the box's shape, put back.
    const mask = shape(0xffffffff);
    const x0 = Math.round(cx - mask.width / 2);
    const y0 = Math.round(cy - mask.height / 2);
    const sx = Math.max(0, x0);
    const sy = Math.max(0, y0);
    const ex = Math.min(picture.width, x0 + mask.width);
    const ey = Math.min(picture.height, y0 + mask.height);
    if (ex > sx && ey > sy) {
      const region = picture.clone().crop(sx, sy, ex - sx, ey - sy);
      const cut = mask.clone().crop(sx - x0, sy - y0, ex - sx, ey - sy);
      boxBlur(region.bitmap, region.width, region.height, box.blur);
      for (let i = 3; i < region.bitmap.length; i += 4)
        region.bitmap[i] = Math.round((cut.bitmap[i]! / 255) * region.bitmap[i]! * opacity);
      picture.composite(region, sx, sy);
    }
  }
  const tint = shape(
    Image.rgbaToColor(rgba[0], rgba[1], rgba[2], Math.round(rgba[3] * 255 * opacity)),
  );
  picture.composite(tint, Math.round(cx - tint.width / 2), Math.round(cy - tint.height / 2));
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
    .select("id, owner_id, status, visibility, share_code, preview_image_id, deleted_at")
    .eq("id", setId)
    .maybeSingle();
  if (!mine || mine.owner_id !== who.user.id) return reply(404, { problem: "not-found" });

  const server = createClient(url, serviceKey);
  // The old file is removed only when it is this set's own (`<set id>/<time>.jpg`): the column
  // is the server's (migration 097), and a path that is not ours is cleared, never deleted.
  const previous =
    typeof mine.preview_image_id === "string" && mine.preview_image_id.startsWith(`${setId}/`)
      ? mine.preview_image_id
      : null;

  // Not something the world may see: no picture, and any old one goes. A set in Recently
  // deleted counts (spec 7.1 #8: the cached preview is cleared); Restore draws it again.
  const shareable =
    mine.status === "published" &&
    !mine.deleted_at &&
    (mine.visibility === "public" || mine.visibility === "link");
  if (!shareable) {
    if (mine.preview_image_id) {
      await server.from("sets").update({ preview_image_id: null }).eq("id", setId);
      if (previous) await server.storage.from("set-previews").remove([previous]);
    }
    return reply(200, { ok: true, preview: null });
  }

  // What the shared page shows - the same function, so the two can never disagree.
  const { data: shared } = await server.rpc("shared_set", { p_code: mine.share_code });
  const set = shared as Shared | null;
  if (!set?.id) return reply(409, { problem: "not-shareable" });

  const creative = set.layout?.version === 2 && !!set.layout.canvas;
  // The template is read as the caller, so the row policies decide (their own, or a published
  // one) - never somebody else's private template by its id.
  const { data: template } =
    !creative && typeof set.layout?.template === "string" && UUID.test(set.layout.template)
      ? await asCaller
          .from("templates")
          .select("layout")
          .eq("id", set.layout.template)
          .maybeSingle()
      : { data: null };
  type TplLayout = {
    canvas?: { w: number; h: number };
    slots?: Slot[];
    backgroundAsset?: string | null;
    order?: string[];
    texts?: Record<string, Position & { kind: "text"; text: TextStyle }>;
    decor?: Record<string, Position & { kind: "asset"; asset: string; colour?: string }>;
  };
  const tpl = (template?.layout as TplLayout | null) ?? null;
  const canvasW = creative ? set.layout!.canvas!.w : (tpl?.canvas?.w ?? 1080);
  const canvasH = creative ? set.layout!.canvas!.h : (tpl?.canvas?.h ?? 1350);
  const slots = tpl?.slots ?? [];

  // The set's canvas fitted inside a square, on the set's own background.
  const scale = Math.min(SIDE / canvasW, SIDE / canvasH);
  const drawnW = Math.round(canvasW * scale);
  const drawnH = Math.round(canvasH * scale);
  const offX = Math.round((SIDE - drawnW) / 2);
  const offY = Math.round((SIDE - drawnH) / 2);
  const picture = new Image(SIDE, SIDE).fill(colour(set.layout?.background));
  // A library background picture over the colour, covering the canvas the way the page does.
  // A Creative set's own background picture, or the one its template carries (M4.5).
  const pulled = new Set(
    Array.isArray(set.pulled)
      ? set.pulled.filter((id): id is string => typeof id === "string")
      : [],
  );
  const bgId = creative ? set.layout?.backgroundAsset : tpl?.backgroundAsset;
  const bgEntry = bgId && !pulled.has(bgId) ? LIB.backgrounds[bgId] : null;
  if (bgEntry) {
    const bg = await libraryImage(bgEntry[0]);
    if (bg) {
      const k = Math.max(drawnW / bg.width, drawnH / bg.height);
      bg.resize(Math.max(1, Math.round(bg.width * k)), Math.max(1, Math.round(bg.height * k)));
      bg.crop(
        Math.round((bg.width - drawnW) / 2),
        Math.round((bg.height - drawnH) / 2),
        drawnW,
        drawnH,
      );
      picture.composite(bg, offX, offY);
    }
  }

  // Which pieces, where: a template's slots, or a Creative set's own positions in its own order.
  type Place = {
    piece: Piece | null;
    text?: Position & { kind: "text"; text: TextStyle };
    decor?: string;
    colour?: string;
    box: { x: number; y: number; w: number; h: number };
    pos: Position | null;
  };
  const places: Place[] = [];
  if (creative) {
    const byRow = new Map(set.pieces.filter((p) => p.row).map((p) => [p.row as string, p]));
    const texts = set.layout!.texts ?? {};
    const decor = set.layout!.decor ?? {};
    const order = (set.layout!.order ?? []).filter((id) => byRow.has(id) || texts[id] || decor[id]);
    for (const p of set.pieces) if (p.row && !order.includes(p.row)) order.push(p.row);
    for (const id of order) {
      const d = decor[id];
      if (d) {
        if (!d.hidden && !pulled.has(d.asset) && LIB.assets[d.asset])
          places.push({
            piece: null,
            decor: LIB.assets[d.asset]![0],
            ...(d.colour ? { colour: d.colour } : {}),
            box: { x: d.x / canvasW, y: d.y / canvasH, w: d.w / canvasW, h: d.h / canvasH },
            pos: d,
          });
        continue;
      }
      const text = texts[id];
      if (text) {
        if (!text.hidden)
          places.push({
            piece: null,
            text,
            box: {
              x: text.x / canvasW,
              y: text.y / canvasH,
              w: text.w / canvasW,
              h: text.h / canvasH,
            },
            pos: text,
          });
        continue;
      }
      const p = byRow.get(id)!;
      if (!p.position || p.position.hidden) continue;
      places.push({
        piece: p,
        box: {
          x: p.position.x / canvasW,
          y: p.position.y / canvasH,
          w: p.position.w / canvasW,
          h: p.position.h / canvasH,
        },
        pos: p.position,
      });
    }
  } else {
    for (const p of set.pieces) {
      if (p.slot === null) continue;
      const slot = slots[p.slot];
      if (slot) places.push({ piece: p, box: slot, pos: null });
    }
    // The template's own decorations and words, over the pieces, in its saved order (M4.5).
    const texts = tpl?.texts ?? {};
    const decor = tpl?.decor ?? {};
    for (const id of tpl?.order ?? []) {
      const d = decor[id];
      const text = texts[id];
      if (d && !d.hidden && !pulled.has(d.asset) && LIB.assets[d.asset])
        places.push({
          piece: null,
          decor: LIB.assets[d.asset]![0],
          ...(d.colour ? { colour: d.colour } : {}),
          box: { x: d.x / canvasW, y: d.y / canvasH, w: d.w / canvasW, h: d.h / canvasH },
          pos: d,
        });
      else if (text && !text.hidden)
        places.push({
          piece: null,
          text,
          box: {
            x: text.x / canvasW,
            y: text.y / canvasH,
            w: text.w / canvasW,
            h: text.h / canvasH,
          },
          pos: text,
        });
    }
  }

  for (const { piece, text, decor, colour, box, pos } of places) {
    let art: Image;
    if (text) {
      // Words, drawn at the canvas's own scale and then scaled with everything else.
      const font = await fontBytes(text.text.font, mine.owner_id as string, async (path) => {
        const { data } = await server.storage.from("private-fonts").download(path);
        return data ? new Uint8Array(await data.arrayBuffer()) : null;
      });
      if (!font) continue;
      try {
        art = await drawText(text.text, text.w, font);
      } catch {
        continue;
      }
      // The box is already the layer's width; scale it with the rest of the canvas.
      const drawnBoxW = Math.max(1, Math.round(box.w * drawnW));
      art.resize(drawnBoxW, Math.max(1, Math.round(art.height * scale)));
      if (pos?.flipX) art.flip("horizontal");
      if (pos?.flipY) art.flip("vertical");
      if (pos?.opacity !== undefined && pos.opacity < 1) art.opacity(pos.opacity);
      const cx = offX + Math.round(box.x * drawnW + drawnBoxW / 2);
      const cy = offY + Math.round(box.y * drawnH + art.height / 2);
      const back = textBackOf(text.text.back);
      if (back !== "none")
        drawBacking(
          picture,
          back,
          text.text,
          art.width,
          art.height,
          cx,
          cy,
          pos?.rotation ?? 0,
          pos?.opacity ?? 1,
          scale,
        );
      if (pos?.rotation) art.rotate(pos.rotation, true);
      picture.composite(art, cx - Math.round(art.width / 2), cy - Math.round(art.height / 2));
      continue;
    }
    if (decor) {
      // A decoration from the library: the same file the page shows.
      const img = await libraryImage(decor, colour);
      if (!img) continue;
      art = img;
    } else {
      if (!piece || !piece.pictured) continue;
      const { data: item } = await server
        .from("items")
        .select("image_id, image_bucket")
        .eq("id", piece.id)
        .maybeSingle();
      if (!item?.image_id) continue;
      const bucket = item.image_bucket === "closet-photos" ? "closet-photos" : "item-images";
      const { data: file } = await server.storage.from(bucket).download(item.image_id);
      if (!file) continue;
      try {
        const stored = new Uint8Array(await file.arrayBuffer());
        if (!decodable(stored)) continue;
        art = still(await decode(stored));
      } catch {
        continue;
      }
    }
    const boxW = Math.max(1, Math.round(box.w * drawnW));
    const boxH = Math.max(1, Math.round(box.h * drawnH));
    if (pos) {
      // A Creative piece fills its box (and may be cropped, flipped, faded, rotated).
      if (pos.crop) {
        const cx = Math.round(pos.crop.x * art.width);
        const cy = Math.round(pos.crop.y * art.height);
        const cw = Math.max(1, Math.round(pos.crop.w * art.width));
        const ch = Math.max(1, Math.round(pos.crop.h * art.height));
        art.crop(cx, cy, cw, ch);
      }
      art.resize(boxW, boxH);
      if (pos.flipX) art.flip("horizontal");
      if (pos.flipY) art.flip("vertical");
      if (pos.opacity !== undefined && pos.opacity < 1) art.opacity(pos.opacity);
      const cx = offX + Math.round(box.x * drawnW + boxW / 2);
      const cy = offY + Math.round(box.y * drawnH + boxH / 2);
      if (pos.rotation) art.rotate(pos.rotation, true);
      picture.composite(art, cx - Math.round(art.width / 2), cy - Math.round(art.height / 2));
    } else {
      // Contain inside the slot, centred - the same as object-contain on the page.
      const fit = Math.min(boxW / art.width, boxH / art.height);
      const w = Math.max(1, Math.round(art.width * fit));
      const h = Math.max(1, Math.round(art.height * fit));
      art.resize(w, h);
      const x = offX + Math.round(box.x * drawnW + (boxW - w) / 2);
      const y = offY + Math.round(box.y * drawnH + (boxH - h) / 2);
      picture.composite(art, x, y);
    }
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
