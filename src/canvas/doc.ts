/**
 * The Creative canvas document (roadmap M4.2; spec 6.1; design pack S59–S61).
 *
 * Pure: nothing in here touches React, Konva or the database, so every rule - the layer cap,
 * the hundred-step undo, snapping, flipping, ordering - can be checked by a script with no
 * browser (scripts/check-canvas-doc.ts). The editor renders a Doc; the saver writes one.
 *
 * Coordinates are canvas pixels on a fixed-size canvas (1080 wide; the height follows the
 * shape), never screen pixels, so a set looks the same on every phone and in the export.
 */

export type CanvasShape = "square" | "portrait" | "story" | "free";

export type CanvasSize = { w: number; h: number; shape: CanvasShape };

export const CANVAS_SHAPES: Record<Exclude<CanvasShape, "free">, CanvasSize> = {
  square: { w: 1080, h: 1080, shape: "square" },
  portrait: { w: 1080, h: 1350, shape: "portrait" },
  story: { w: 1080, h: 1920, shape: "story" },
};

/** Spec 6.1 #20: 150 items per set, warning at 120 - provisional until M4.1 is run on the phone. */
export const LAYER_CAP = 150;
export const LAYER_WARNING = 120;
/** Spec 6.1 #9. */
export const UNDO_STEPS = 100;
/** How close (canvas px) an edge has to be before it snaps to a guide. */
export const SNAP_DISTANCE = 8;

export type Crop = { x: number; y: number; w: number; h: number }; // fractions of the source, 0..1

/** A text layer's words and their look (spec 6.2 #1; S62). `font` is a catalogue id, or `private:<path>`. */
export type TextStyle = {
  text: string;
  font: string;
  size: number;
  colour: string;
  align: "left" | "center" | "right";
};

export type Layer = {
  /** The set_items row id once saved; a temporary id before. For text and decoration, an id of its own. */
  id: string;
  /** Empty for a text or decoration layer. */
  itemId: string;
  /** A clipped piece, words, a decoration from the library (M4.4), or a template's empty slot (M4.5). */
  kind: "item" | "text" | "asset" | "slot";
  text?: TextStyle;
  /** The library catalogue id of a decoration (`src/library/catalogue.json`). */
  asset?: string;
  /** A structural decoration's colour, chosen by the user and fixed in the set (L14). */
  colour?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  hidden: boolean;
  locked: boolean;
  crop: Crop | null;
};

export type Doc = {
  canvas: CanvasSize;
  /** A fixed colour written into the set - never a theme token (L14). */
  background: string;
  /** A library background picture over the colour, by catalogue id; null for the colour alone. */
  backgroundAsset: string | null;
  caption: string;
  /** Bottom to top. */
  order: string[];
  layers: Record<string, Layer>;
};

export type LayoutV2 = {
  version: 2;
  mode: "creative";
  canvas: CanvasSize;
  background: string;
  backgroundAsset?: string | null;
  caption: string;
  order: string[];
  /** Text layers live in the layout (they are not pieces), keyed by id. */
  texts?: Record<string, Layer>;
  /** Decoration layers too: they are the library's pictures, not the user's pieces. */
  decor?: Record<string, Layer>;
};

/**
 * A template (M4.5; spec 6.4): the quick builder fills its slots in order; its background,
 * decorations and words come along as the set's own. Slots are fractions of the canvas so the
 * same template fits any shape the builder shows it at - the shape the quick builder and the
 * share page already read (`layout.slots`).
 */
export type TemplateLayoutV2 = {
  version: 2;
  canvas: CanvasSize;
  background: string;
  backgroundAsset?: string | null;
  slots: Array<{ x: number; y: number; w: number; h: number }>;
  order: string[];
  texts?: Record<string, Layer>;
  decor?: Record<string, Layer>;
};

export function templateLayoutOf(doc: Doc): TemplateLayoutV2 {
  const base = layoutOf(doc);
  const slots = doc.order
    .map((id) => doc.layers[id])
    .filter((l): l is Layer => !!l && l.kind === "slot" && !l.hidden)
    .map((l) => ({
      x: round4(l.x / doc.canvas.w),
      y: round4(l.y / doc.canvas.h),
      w: round4(l.w / doc.canvas.w),
      h: round4(l.h / doc.canvas.h),
    }));
  return {
    version: 2,
    canvas: base.canvas,
    background: base.background,
    backgroundAsset: base.backgroundAsset ?? null,
    slots,
    order: base.order,
    texts: base.texts ?? {},
    decor: base.decor ?? {},
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** A slot placeholder (M4.5): an empty box, 40% of the canvas wide, for a piece to fill later. */
export function addSlotLayer(doc: Doc, id: string): AddResult {
  const added = addLayer(doc, id, "", { w: doc.canvas.w * 0.4, h: doc.canvas.w * 0.4 });
  if (!added.ok) return added;
  const layer: Layer = { ...added.doc.layers[id]!, kind: "slot" };
  return { ...added, doc: { ...added.doc, layers: { ...added.doc.layers, [id]: layer } } };
}

export type PositionV2 = Omit<Layer, "id" | "itemId" | "kind" | "text" | "asset" | "colour">;

export function emptyDoc(
  shape: Exclude<CanvasShape, "free"> = "portrait",
  background = "#F4EFE6",
): Doc {
  return {
    canvas: CANVAS_SHAPES[shape],
    background,
    backgroundAsset: null,
    caption: "",
    order: [],
    layers: {},
  };
}

export function layoutOf(doc: Doc): LayoutV2 {
  const texts: Record<string, Layer> = {};
  const decor: Record<string, Layer> = {};
  for (const [id, l] of Object.entries(doc.layers)) {
    if (l.kind === "text") texts[id] = l;
    if (l.kind === "asset") decor[id] = l;
  }
  return {
    version: 2,
    mode: "creative",
    canvas: doc.canvas,
    background: doc.background,
    backgroundAsset: doc.backgroundAsset,
    caption: doc.caption,
    order: [...doc.order],
    texts,
    decor,
  };
}

export function positionOf(layer: Layer): PositionV2 {
  const {
    id: _id,
    itemId: _itemId,
    kind: _kind,
    text: _text,
    asset: _asset,
    colour: _colour,
    ...rest
  } = layer;
  return rest;
}

export function layerFromRow(
  id: string,
  itemId: string,
  position: Partial<PositionV2> | null,
  fallback: Partial<Layer> = {},
): Layer {
  return {
    id,
    itemId,
    kind: "item",
    x: position?.x ?? fallback.x ?? 0,
    y: position?.y ?? fallback.y ?? 0,
    w: position?.w ?? fallback.w ?? 400,
    h: position?.h ?? fallback.h ?? 400,
    rotation: position?.rotation ?? 0,
    flipX: position?.flipX ?? false,
    flipY: position?.flipY ?? false,
    opacity: position?.opacity ?? 1,
    hidden: position?.hidden ?? false,
    locked: position?.locked ?? false,
    crop: position?.crop ?? null,
  };
}

// ---------------------------------------------------------------------------
// Edits. Every one returns a new Doc and leaves the old one alone, which is what makes undo a
// list of documents rather than a list of inverse operations.
// ---------------------------------------------------------------------------

export function count(doc: Doc): number {
  return doc.order.length;
}

export type AddResult = { ok: true; doc: Doc; id: string } | { ok: false; reason: "cap" };

/** A new piece lands in the middle, at a third of the canvas width, on top (spec 6.1 #20 cap). */
export function addLayer(
  doc: Doc,
  id: string,
  itemId: string,
  size: { w: number; h: number },
): AddResult {
  if (count(doc) >= LAYER_CAP) return { ok: false, reason: "cap" };
  const target = doc.canvas.w / 3;
  const scale = target / Math.max(size.w, size.h, 1);
  const w = Math.round(size.w * scale);
  const h = Math.round(size.h * scale);
  const layer = layerFromRow(id, itemId, null, {
    x: Math.round((doc.canvas.w - w) / 2),
    y: Math.round((doc.canvas.h - h) / 2),
    w,
    h,
  });
  return {
    ok: true,
    id,
    doc: { ...doc, order: [...doc.order, id], layers: { ...doc.layers, [id]: layer } },
  };
}

/**
 * A decoration from the library (M4.4): placed like a piece, a third of the canvas wide, on top.
 * It is not a set_items row - the layout carries it - so its id is the editor's own.
 */
export function addAssetLayer(
  doc: Doc,
  id: string,
  asset: string,
  size: { w: number; h: number },
  colour?: string,
): AddResult {
  const added = addLayer(doc, id, "", size);
  if (!added.ok) return added;
  const layer: Layer = { ...added.doc.layers[id]!, kind: "asset", asset };
  if (colour) layer.colour = colour;
  return { ...added, doc: { ...added.doc, layers: { ...added.doc.layers, [id]: layer } } };
}

/** A text layer (S62): the words in the middle of the canvas, a third of its width, on top. */
export function addTextLayer(doc: Doc, id: string, style: TextStyle): AddResult {
  if (count(doc) >= LAYER_CAP) return { ok: false, reason: "cap" };
  const w = Math.round(doc.canvas.w * 0.6);
  const h = Math.round(style.size * 1.4);
  const base = layerFromRow(id, "", null, {
    x: Math.round((doc.canvas.w - w) / 2),
    y: Math.round((doc.canvas.h - h) / 2),
    w,
    h,
  });
  const layer: Layer = { ...base, kind: "text", text: style };
  return {
    ok: true,
    id,
    doc: { ...doc, order: [...doc.order, id], layers: { ...doc.layers, [id]: layer } },
  };
}

export function updateLayer(
  doc: Doc,
  id: string,
  patch: Partial<Omit<Layer, "id" | "itemId">>,
): Doc {
  const layer = doc.layers[id];
  if (!layer) return doc;
  return { ...doc, layers: { ...doc.layers, [id]: { ...layer, ...patch } } };
}

export function removeLayer(doc: Doc, id: string): Doc {
  if (!doc.layers[id]) return doc;
  const layers = { ...doc.layers };
  delete layers[id];
  return { ...doc, order: doc.order.filter((x) => x !== id), layers };
}

/** Spec 6.1 #4: a clone keeps size and rotation, offset a little so both can be seen. */
export function cloneLayer(doc: Doc, id: string, newId: string): AddResult {
  const source = doc.layers[id];
  if (!source) return { ok: false, reason: "cap" };
  if (count(doc) >= LAYER_CAP) return { ok: false, reason: "cap" };
  const copy: Layer = { ...source, id: newId, x: source.x + 24, y: source.y + 24, locked: false };
  const at = doc.order.indexOf(id);
  const order = [...doc.order];
  order.splice(at + 1, 0, newId);
  return { ok: true, id: newId, doc: { ...doc, order, layers: { ...doc.layers, [newId]: copy } } };
}

export type OrderMove = "forward" | "back" | "front" | "bottom";

export function reorder(doc: Doc, id: string, move: OrderMove): Doc {
  const at = doc.order.indexOf(id);
  if (at < 0) return doc;
  const order = doc.order.filter((x) => x !== id);
  const to =
    move === "front"
      ? order.length
      : move === "bottom"
        ? 0
        : move === "forward"
          ? Math.min(order.length, at + 1)
          : Math.max(0, at - 1);
  order.splice(to, 0, id);
  return { ...doc, order };
}

/** Spec 6.1 #2: flip is mirroring, so flipping twice is the original. */
export function flip(doc: Doc, id: string, axis: "x" | "y"): Doc {
  const layer = doc.layers[id];
  if (!layer) return doc;
  return updateLayer(doc, id, axis === "x" ? { flipX: !layer.flipX } : { flipY: !layer.flipY });
}

/** Spec 6.1 #7: fit - back to the size a new piece gets, keeping the centre. */
export function fit(doc: Doc, id: string, natural: { w: number; h: number }): Doc {
  const layer = doc.layers[id];
  if (!layer) return doc;
  const target = doc.canvas.w / 3;
  const scale = target / Math.max(natural.w, natural.h, 1);
  const w = Math.round(natural.w * scale);
  const h = Math.round(natural.h * scale);
  const cx = layer.x + layer.w / 2;
  const cy = layer.y + layer.h / 2;
  return updateLayer(doc, id, {
    w,
    h,
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    rotation: 0,
    crop: null,
  });
}

/** Spec 6.1 #11, "free size": the width stays 1080 so nothing moves; only the height changes. */
export const FREE_HEIGHT = { min: 540, max: 2160 } as const;
export function setFreeHeight(doc: Doc, h: number): Doc {
  const height = Math.round(Math.min(FREE_HEIGHT.max, Math.max(FREE_HEIGHT.min, h)));
  if (doc.canvas.shape === "free" && doc.canvas.h === height) return doc;
  return { ...doc, canvas: { w: 1080, h: height, shape: "free" } };
}

/** Spec 6.1 #11: switching the shape keeps the layout - pieces scale with the width and stay put. */
export function setShape(doc: Doc, shape: Exclude<CanvasShape, "free">): Doc {
  const next = CANVAS_SHAPES[shape];
  if (doc.canvas.shape === shape) return doc;
  const k = next.w / doc.canvas.w;
  const layers: Record<string, Layer> = {};
  for (const [id, l] of Object.entries(doc.layers)) {
    layers[id] = {
      ...l,
      x: Math.round(l.x * k),
      y: Math.round(l.y * k),
      w: Math.round(l.w * k),
      h: Math.round(l.h * k),
    };
  }
  return { ...doc, canvas: next, layers };
}

// ---------------------------------------------------------------------------
// Snapping (spec 6.1 #15). Guides are the canvas edges and centre, and every other visible
// layer's edges and centre. A moving box snaps when an edge or its centre comes within
// SNAP_DISTANCE of a guide; the guides it snapped to are returned so the editor can draw them.
// ---------------------------------------------------------------------------

export type Guides = { vertical: number[]; horizontal: number[] };

export function guidesFor(doc: Doc, movingId: string): Guides {
  const vertical = new Set<number>([0, doc.canvas.w / 2, doc.canvas.w]);
  const horizontal = new Set<number>([0, doc.canvas.h / 2, doc.canvas.h]);
  for (const id of doc.order) {
    if (id === movingId) continue;
    const l = doc.layers[id];
    if (!l || l.hidden) continue;
    vertical.add(l.x);
    vertical.add(l.x + l.w / 2);
    vertical.add(l.x + l.w);
    horizontal.add(l.y);
    horizontal.add(l.y + l.h / 2);
    horizontal.add(l.y + l.h);
  }
  return { vertical: [...vertical], horizontal: [...horizontal] };
}

export function snap(
  box: { x: number; y: number; w: number; h: number },
  guides: Guides,
  distance = SNAP_DISTANCE,
): { x: number; y: number; snappedV: number | null; snappedH: number | null } {
  let x = box.x;
  let y = box.y;
  let snappedV: number | null = null;
  let snappedH: number | null = null;
  let bestV = distance + 1;
  for (const g of guides.vertical) {
    for (const [edge, offset] of [
      [box.x, 0],
      [box.x + box.w / 2, box.w / 2],
      [box.x + box.w, box.w],
    ] as const) {
      const d = Math.abs(edge - g);
      if (d <= distance && d < bestV) {
        bestV = d;
        x = g - offset;
        snappedV = g;
      }
    }
  }
  let bestH = distance + 1;
  for (const g of guides.horizontal) {
    for (const [edge, offset] of [
      [box.y, 0],
      [box.y + box.h / 2, box.h / 2],
      [box.y + box.h, box.h],
    ] as const) {
      const d = Math.abs(edge - g);
      if (d <= distance && d < bestH) {
        bestH = d;
        y = g - offset;
        snappedH = g;
      }
    }
  }
  return { x, y, snappedV, snappedH };
}

// ---------------------------------------------------------------------------
// Undo (spec 6.1 #9): a hundred documents back, and redo until the next new edit.
// ---------------------------------------------------------------------------

export type History = { past: Doc[]; present: Doc; future: Doc[] };

export function historyOf(doc: Doc): History {
  return { past: [], present: doc, future: [] };
}

export function commit(h: History, next: Doc): History {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  if (past.length > UNDO_STEPS) past.splice(0, past.length - UNDO_STEPS);
  return { past, present: next, future: [] };
}

export function undo(h: History): History {
  const previous = h.past[h.past.length - 1];
  if (!previous) return h;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

/** Which layers differ between two documents - what the saver has to write. */
export function changedLayers(before: Doc, after: Doc): { changed: string[]; removed: string[] } {
  const changed: string[] = [];
  for (const [id, layer] of Object.entries(after.layers)) {
    if (before.layers[id] !== layer) changed.push(id);
  }
  const removed = Object.keys(before.layers).filter((id) => !after.layers[id]);
  return { changed, removed };
}

export function layoutChanged(before: Doc, after: Doc): boolean {
  const textChanged = Object.entries(after.layers).some(
    ([id, l]) => l.kind !== "item" && before.layers[id] !== l,
  );
  return (
    textChanged ||
    before.canvas !== after.canvas ||
    before.background !== after.background ||
    before.backgroundAsset !== after.backgroundAsset ||
    before.caption !== after.caption ||
    before.order.length !== after.order.length ||
    before.order.some((id, i) => after.order[i] !== id)
  );
}
