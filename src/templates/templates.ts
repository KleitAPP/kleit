import { supabase } from "@/integrations/supabase/client";

import {
  emptyDoc,
  layerFromRow,
  templateLayoutOf,
  CANVAS_SHAPES,
  type Doc,
  type TemplateLayoutV2,
} from "@/canvas/doc";

/**
 * Templates (roadmap M4.5; spec 6.4): the four Kleit ships (owner null), the ones people
 * publish (`is_public`), and your own. The quick builder fills any of them; the maker edits yours.
 * The row policy decides what you see (migration 017): ours, public, or your own.
 */

export type TemplateRow = {
  id: string;
  owner_id: string | null;
  name: string;
  kind: "slot" | "stacked";
  is_public: boolean;
  layout: TemplateLayoutV2 | { canvas: { w: number; h: number }; slots: TemplateLayoutV2["slots"] };
  created_at: string;
};

export type LoadedTemplate = {
  doc: Doc;
  name: string;
  isPublic: boolean;
  mine: boolean;
};

const FIELDS = "id, owner_id, name, kind, is_public, layout, created_at";

/** Everything the builder may offer: Kleit's first, then yours, then other people's public ones. */
export async function allTemplates(): Promise<TemplateRow[]> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id ?? null;
  const { data } = await supabase
    .from("templates")
    .select(FIELDS)
    .order("sort_order")
    .order("created_at");
  const rows = (data ?? []) as unknown as TemplateRow[];
  const rank = (r: TemplateRow) => (r.owner_id === null ? 0 : r.owner_id === me ? 1 : 2);
  return rows
    .filter((r) => r.owner_id === null || r.is_public || r.owner_id === me)
    .sort((a, b) => rank(a) - rank(b));
}

export async function myTemplates(): Promise<TemplateRow[]> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return [];
  const { data } = await supabase
    .from("templates")
    .select(FIELDS)
    .eq("owner_id", me)
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as TemplateRow[];
}

/** A new, private, empty template of yours. Returns its id. */
export async function createTemplate(name: string): Promise<string | null> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return null;
  const { data, error } = await supabase
    .from("templates")
    .insert({
      owner_id: me,
      name,
      kind: "slot",
      is_public: false,
      layout: templateLayoutOf(emptyDoc("portrait")),
    })
    .select("id")
    .single();
  return error || !data ? null : data.id;
}

/** The template as a document the canvas can edit: slots as slot layers, in order. */
export function docFromTemplate(layout: TemplateRow["layout"]): Doc {
  const v2 = "version" in layout && layout.version === 2 ? layout : null;
  const shape = v2?.canvas?.shape && v2.canvas.shape !== "free" ? v2.canvas.shape : "portrait";
  const canvas = v2?.canvas ?? {
    ...CANVAS_SHAPES.portrait,
    ...layout.canvas,
    shape: "free" as const,
  };
  const doc: Doc = {
    ...emptyDoc(shape, v2?.background ?? "#F4EFE6"),
    canvas: v2?.canvas ? (v2.canvas.shape === "free" ? v2.canvas : CANVAS_SHAPES[shape]) : canvas,
    backgroundAsset: v2?.backgroundAsset ?? null,
  };
  const layers: Doc["layers"] = {};
  const order: string[] = [];
  const slotIds: string[] = [];
  layout.slots.forEach((s, i) => {
    const id = `slot-${i + 1}`;
    layers[id] = {
      ...layerFromRow(id, "", {
        x: Math.round(s.x * doc.canvas.w),
        y: Math.round(s.y * doc.canvas.h),
        w: Math.round(s.w * doc.canvas.w),
        h: Math.round(s.h * doc.canvas.h),
      }),
      kind: "slot",
    };
    slotIds.push(id);
  });
  for (const [id, text] of Object.entries(v2?.texts ?? {}))
    if (text && text.kind === "text" && text.text)
      layers[id] = { ...layerFromRow(id, "", text), kind: "text", text: text.text };
  for (const [id, decor] of Object.entries(v2?.decor ?? {}))
    if (decor && decor.kind === "asset" && decor.asset) {
      layers[id] = { ...layerFromRow(id, "", decor), kind: "asset", asset: decor.asset };
      if (decor.colour) layers[id]!.colour = decor.colour;
    }
  // The saved order names slots by their saved ids; a v1 template has no order, so slots go first.
  const savedOrder = (v2?.order ?? []).filter((id) => layers[id]);
  for (const id of savedOrder) order.push(id);
  for (const id of [...slotIds, ...Object.keys(layers)]) if (!order.includes(id)) order.push(id);
  return { ...doc, layers, order };
}

export async function loadTemplate(id: string): Promise<LoadedTemplate | null> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id ?? null;
  const { data } = await supabase.from("templates").select(FIELDS).eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as unknown as TemplateRow;
  return {
    doc: docFromTemplate(row.layout),
    name: row.name,
    isPublic: row.is_public,
    mine: row.owner_id === me,
  };
}

/** Writes the whole template (it is one row; there is nothing to diff). */
export async function saveTemplate(
  id: string,
  doc: Doc,
  name: string,
  isPublic: boolean,
): Promise<boolean> {
  const layout = templateLayoutOf(doc);
  const stacked = overlaps(layout.slots);
  const { error } = await supabase
    .from("templates")
    .update({
      layout,
      name: name.trim() || "Untitled",
      is_public: isPublic,
      kind: stacked ? "stacked" : "slot",
    })
    .eq("id", id);
  return !error;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const { error } = await supabase.from("templates").delete().eq("id", id);
  return !error;
}

/** Stacked (spec 6.4 #3) is simply slots that overlap: they fill in order, later ones on top. */
function overlaps(slots: TemplateLayoutV2["slots"]): boolean {
  for (let i = 0; i < slots.length; i++)
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i]!;
      const b = slots[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true;
    }
  return false;
}
