import { supabase } from "@/integrations/supabase/client";
import { imageUrlFor, type ItemSummary } from "@/items/items";
import { newSetDefaults, refreshPreview, lastSaveProblem } from "@/sets/sets";

import {
  changedLayers,
  emptyDoc,
  layerFromRow,
  layoutChanged,
  layoutOf,
  positionOf,
  CANVAS_SHAPES,
  normaliseCanvas,
  type Doc,
  type LayoutV2,
  type PositionV2,
} from "@/canvas/doc";

/**
 * Loading and saving a Creative document (roadmap M4.2).
 *
 * Where it lives: `sets.layout` holds the canvas, background, caption and the order (a version
 * 2 layout); every piece is a `set_items` row whose `position` holds where it sits. The row id
 * IS the layer id, so a clone is a second row for the same item (migration 025 allows that).
 * Writes go through the row policy as the owner; the layout through `save_set_layout`, which
 * keeps a version (spec 5.1 #7).
 */

const ITEM_FIELDS =
  "id, kind, title, price_cents, price_currency, store_name, source_url, source_domain, image_id, image_bucket, created_at";

export type Loaded = {
  doc: Doc;
  items: Record<string, ItemSummary>;
  status: "draft" | "published";
  title: string;
};

export function isCreative(layout: unknown): layout is LayoutV2 {
  return !!layout && typeof layout === "object" && (layout as { version?: number }).version === 2;
}

export async function loadDoc(setId: string): Promise<Loaded | null> {
  const { data: set } = await supabase
    .from("sets")
    .select("id, title, status, layout")
    .eq("id", setId)
    .maybeSingle();
  if (!set) return null;
  const { data: rows } = await supabase
    .from("set_items")
    .select(`id, item_id, position, item:items(${ITEM_FIELDS})`)
    .eq("set_id", setId)
    .order("created_at");
  const items: Record<string, ItemSummary> = {};
  const raw = set.layout as Partial<LayoutV2> | null;
  const shape = raw?.canvas?.shape && raw.canvas.shape !== "free" ? raw.canvas.shape : "portrait";
  let doc: Doc = {
    ...emptyDoc(shape, raw?.background ?? "#F4EFE6"),
    backgroundAsset: raw?.backgroundAsset ?? null,
    caption: raw?.caption ?? "",
    canvas: raw?.canvas ? normaliseCanvas(raw.canvas) : CANVAS_SHAPES[shape],
  };
  const layers: Doc["layers"] = {};
  const seen: string[] = [];
  for (const row of rows ?? []) {
    if (!row.item) continue;
    const item = row.item as unknown as ItemSummary;
    items[item.id] = item;
    const position = row.position as (Partial<PositionV2> & { slot?: number }) | null;
    // A quick-mode set opened in Creative (spec 5.1 "Open in Creative"): its slots become
    // positions once, from the 4-piece template's grid, and from then on it is a canvas.
    const fallback =
      typeof position?.slot === "number" && position.x === undefined
        ? slotFallback(doc, position.slot)
        : {};
    layers[row.id] = layerFromRow(row.id, item.id, position, fallback);
    seen.push(row.id);
  }
  for (const [id, text] of Object.entries(raw?.texts ?? {})) {
    if (text && text.kind === "text" && text.text)
      layers[id] = { ...layerFromRow(id, "", text), kind: "text", text: text.text };
  }
  for (const [id, decor] of Object.entries(raw?.decor ?? {})) {
    if (decor && decor.kind === "asset" && decor.asset) {
      layers[id] = { ...layerFromRow(id, "", decor), kind: "asset", asset: decor.asset };
      if (decor.colour) layers[id]!.colour = decor.colour;
    }
  }
  const order = (raw?.order ?? []).filter((id) => layers[id]);
  for (const id of seen) if (!order.includes(id)) order.push(id);
  doc = { ...doc, layers, order };
  return { doc, items, status: set.status as "draft" | "published", title: set.title };
}

function slotFallback(doc: Doc, slot: number): Partial<Doc["layers"][string]> {
  const col = slot % 2;
  const row = Math.floor(slot / 2);
  const w = Math.round(doc.canvas.w * 0.44);
  const h = Math.round(doc.canvas.h * 0.44);
  return {
    x: Math.round(doc.canvas.w * (0.05 + col * 0.46)),
    y: Math.round(doc.canvas.h * (0.05 + row * 0.46)),
    w,
    h,
  };
}

/** A new empty Creative set, or null if it could not be made. */
export async function createCreativeDraft(): Promise<string | null> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return null;
  const { data, error } = await supabase
    .from("sets")
    .insert({
      owner_id: me,
      status: "draft",
      layout: layoutOf(emptyDoc("portrait")),
      ...(await newSetDefaults(me)),
    })
    .select("id")
    .single();
  return error || !data ? null : data.id;
}

/** Adds the piece as a new row and returns the row id, which becomes the layer id. */
export async function addRow(
  setId: string,
  itemId: string,
  position: PositionV2,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("set_items")
    .insert({ set_id: setId, item_id: itemId, position })
    .select("id")
    .single();
  return error || !data ? null : data.id;
}

/**
 * Writes what changed between two documents: positions row by row, removed rows, and the
 * layout when the canvas, background, caption or order moved. Returns false if anything failed.
 */
export async function saveDiff(
  setId: string,
  before: Doc,
  after: Doc,
  published: boolean,
): Promise<boolean> {
  const { changed, removed } = changedLayers(before, after);
  let ok = true;
  for (const id of changed) {
    const layer = after.layers[id];
    if (!layer || layer.kind !== "item") continue; // text and decoration live in the layout, below
    const { error } = await supabase
      .from("set_items")
      .update({ position: positionOf(layer) })
      .eq("id", id);
    if (error) ok = false;
  }
  const removedRows = removed.filter((id) => before.layers[id]?.kind === "item");
  if (removedRows.length) {
    const { error } = await supabase.from("set_items").delete().in("id", removedRows);
    if (error) ok = false;
  }
  if (layoutChanged(before, after) || removed.length) {
    const { error } = await supabase.rpc("save_set_layout", {
      p_set_id: setId,
      p_layout: layoutOf(after),
    });
    lastSaveProblem.code = error ? ((error as { code?: string }).code ?? null) : null;
    if (error) ok = false;
  }
  if (ok && published) refreshPreview(setId);
  return ok;
}

/**
 * A library picture (decoration or background), from this site's own /library/ folder. A
 * structural SVG is fetched as text, given the user's colour in place of currentColor, and
 * sized up four times so the canvas draws it sharp at any scale.
 */
export async function loadLibraryImage(
  file: string,
  colour?: string,
): Promise<HTMLImageElement | null> {
  let src = `/library/${file}`;
  if (file.endsWith(".svg")) {
    try {
      const text = await (await fetch(src)).text();
      const sized = text
        .replace(
          / width="(\d+)" height="(\d+)"/,
          (_m, w, h) => ` width="${w * 4}" height="${h * 4}"`,
        )
        .replace(/currentColor/g, colour && /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : "#161513");
      src = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** One HTMLImageElement per item, loaded once; the editor draws from these. */
export async function loadImage(item: ItemSummary): Promise<HTMLImageElement | null> {
  const url = await imageUrlFor(item);
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
