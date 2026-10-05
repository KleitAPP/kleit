import type Konva from "konva";
import { zipSync } from "fflate";

import type { Doc } from "@/canvas/doc";
import type { Images } from "@/canvas/CanvasStage";

/**
 * Export (roadmap M4.6; spec 6.6): the set as a picture, from the same stage that drew it, at
 * the sizes people actually post. No watermark, ever (decision 106). The editor's own marks -
 * handles, guides, the crop scrim - live on the stage's third layer, which is hidden for the
 * shot; a transparent PNG hides the background layer too.
 *
 * Sizes: the set at 1080 or 2160 wide; a Story (1080×1920) with the set fitted on its own
 * background colour; a carousel of square pages (the whole set first, then one page per piece)
 * zipped so they land as one download.
 */
export type ExportFormat = "png" | "jpg" | "png-transparent";
export type ExportSize = 1080 | 2160;

export type ExportResult = { blob: Blob; filename: string };

const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  "png-transparent": "image/png",
};

function shot(stage: Konva.Stage, width: number, format: ExportFormat): HTMLCanvasElement {
  // By name, not by position: a layer that re-mounts moves to the end of the stage's children.
  const ui = stage.findOne<Konva.Layer>(".ui");
  const background = stage.findOne<Konva.Layer>(".background");
  ui?.hide();
  if (format === "png-transparent") background?.hide();
  try {
    return stage.toCanvas({ pixelRatio: width / stage.width() });
  } finally {
    ui?.show();
    background?.show();
  }
}

function toBlob(canvas: HTMLCanvasElement, format: ExportFormat): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("export failed"))),
      MIME[format],
      format === "jpg" ? 0.92 : undefined,
    );
  });
}

/** The set itself, at the chosen width. */
export async function exportSet(
  stage: Konva.Stage,
  doc: Doc,
  format: ExportFormat,
  size: ExportSize,
  name: string,
): Promise<ExportResult> {
  const canvas = shot(stage, size, format);
  return {
    blob: await toBlob(canvas, format),
    filename: `${safe(name)}-${size}.${format === "jpg" ? "jpg" : "png"}`,
  };
}

/** A 1080×1920 Story: the set fitted inside, centred, on its own background colour. */
export async function exportStory(
  stage: Konva.Stage,
  doc: Doc,
  name: string,
): Promise<ExportResult> {
  const picture = shot(stage, 1080, "png");
  const out = document.createElement("canvas");
  out.width = 1080;
  out.height = 1920;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, 1080, 1920);
  const k = Math.min(1080 / picture.width, 1920 / picture.height);
  const w = Math.round(picture.width * k);
  const h = Math.round(picture.height * k);
  ctx.drawImage(picture, Math.round((1080 - w) / 2), Math.round((1920 - h) / 2), w, h);
  return { blob: await toBlob(out, "png"), filename: `${safe(name)}-story.png` };
}

/**
 * A carousel: square pages at 1080 - the whole set first (fitted), then every visible piece on
 * its own page, in the set's order - zipped as one file.
 */
export async function exportCarousel(
  stage: Konva.Stage,
  doc: Doc,
  images: Images,
  name: string,
): Promise<ExportResult> {
  const pages: Uint8Array[] = [];
  const square = (draw: (ctx: CanvasRenderingContext2D) => void) => {
    const c = document.createElement("canvas");
    c.width = 1080;
    c.height = 1080;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, 1080, 1080);
    draw(ctx);
    return c;
  };
  const whole = shot(stage, 1080, "png");
  pages.push(
    await bytes(
      square((ctx) => {
        const k = Math.min(1080 / whole.width, 1080 / whole.height);
        const w = Math.round(whole.width * k);
        const h = Math.round(whole.height * k);
        ctx.drawImage(whole, Math.round((1080 - w) / 2), Math.round((1080 - h) / 2), w, h);
      }),
    ),
  );
  for (const id of doc.order) {
    const layer = doc.layers[id];
    if (!layer || layer.hidden || layer.kind !== "item") continue;
    const img = images[layer.itemId];
    if (!img) continue;
    pages.push(
      await bytes(
        square((ctx) => {
          const pad = 80;
          const k = Math.min(
            (1080 - 2 * pad) / img.naturalWidth,
            (1080 - 2 * pad) / img.naturalHeight,
          );
          const w = Math.round(img.naturalWidth * k);
          const h = Math.round(img.naturalHeight * k);
          ctx.drawImage(img, Math.round((1080 - w) / 2), Math.round((1080 - h) / 2), w, h);
        }),
      ),
    );
    if (pages.length >= 20) break; // Instagram's own carousel limit
  }
  const files: Record<string, Uint8Array> = {};
  pages.forEach((p, i) => {
    files[`${safe(name)}-${String(i + 1).padStart(2, "0")}.png`] = p;
  });
  const zipped = zipSync(files, { level: 0 }); // PNG is already compressed
  return {
    blob: new Blob([zipped as BlobPart], { type: "application/zip" }),
    filename: `${safe(name)}-carousel.zip`,
  };
}

async function bytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await toBlob(canvas, "png");
  return new Uint8Array(await blob.arrayBuffer());
}

function safe(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "kleit-set";
}

/** Hands the file to the browser as a download. */
export function download({ blob, filename }: ExportResult): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
