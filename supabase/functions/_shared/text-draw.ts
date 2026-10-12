/**
 * Drawing a text layer the way the canvas draws it, on the server (roadmap M4.3; spec 6.2 #1).
 *
 * Used by set-preview (the chat picture) and by text-image (a private-font text layer on the
 * shared page, served as a picture so the font file never leaves the account). The font comes
 * either from the site's public /fonts/ folder (the curated OFL set) or from the owner's own
 * folder in the private-fonts bucket - and only the owner's folder, checked here.
 */
import { Image, TextLayout } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

export type TextStyle = {
  text: string;
  font: string;
  size: number;
  colour: string;
  align: "left" | "center" | "right";
};

export const SITE_URL =
  Deno.env.get("KLEIT_SITE_URL") ?? "https://kleit-test.kleitapp-team.workers.dev";

/** Fonts already read, by owner and id; bounded, and a miss is not kept (a font uploaded later is found). */
const fontCache = new Map<string, Promise<Uint8Array | null>>();
const FONT_CACHE_MAX = 64;

/**
 * The limits any text layer is drawn within, whatever the layout says: the canvas never makes
 * a layer wider than its own pixels or a face taller than a quarter of them, and the server
 * draws no more than that (a layout is JSON the owner writes, so it is clamped, not trusted).
 */
export const TEXT_LIMITS = { maxWidth: 4096, maxSize: 400, maxChars: 1000 } as const;
export function clampStyle(style: TextStyle, width: number): { style: TextStyle; width: number } {
  const size = Number.isFinite(style.size)
    ? Math.min(TEXT_LIMITS.maxSize, Math.max(4, style.size))
    : 48;
  const text = (typeof style.text === "string" ? style.text : "").slice(0, TEXT_LIMITS.maxChars);
  const align = style.align === "left" || style.align === "right" ? style.align : "center";
  const w = Number.isFinite(width) ? Math.min(TEXT_LIMITS.maxWidth, Math.max(1, width)) : 1;
  return { style: { ...style, size, text, align }, width: w };
}

/** The font's bytes, or null when the id is not one we may serve for this owner. */
export function fontBytes(
  fontId: string,
  ownerId: string,
  download: (path: string) => Promise<Uint8Array | null>,
): Promise<Uint8Array | null> {
  const key = `${ownerId}:${fontId}`;
  const cached = fontCache.get(key);
  if (cached) return cached;
  if (fontCache.size >= FONT_CACHE_MAX) fontCache.delete(fontCache.keys().next().value as string);
  const job = (async () => {
    if (fontId.startsWith("private:")) {
      const path = fontId.slice("private:".length);
      // Only the set owner's own folder: a layout can name any path, so the path is checked, not trusted.
      if (!path.startsWith(`${ownerId}/`) || path.includes("..")) return null;
      return download(path);
    }
    if (!/^[a-z0-9]+$/.test(fontId)) return null;
    try {
      const r = await fetch(`${SITE_URL}/fonts/${fontId}.ttf`);
      if (!r.ok) return null;
      return new Uint8Array(await r.arrayBuffer());
    } catch {
      return null;
    }
  })();
  fontCache.set(key, job);
  // A miss or a failure is not kept: a font uploaded later is found, and a read that broke is
  // tried again next time (a rejected promise left in the cache would answer every call).
  job.then(
    (bytes) => {
      if (!bytes && fontCache.get(key) === job) fontCache.delete(key);
    },
    () => {
      if (fontCache.get(key) === job) fontCache.delete(key);
    },
  );
  return job;
}

function colour(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1]!, 16) : 0x1f1d1a;
  return Image.rgbaToColor((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255);
}

/**
 * The words in a box of the layer's width (canvas pixels), transparent background, each line
 * aligned the way the canvas aligns it. Paragraphs are drawn one by one: imagescript draws a
 * hard line break as a missing glyph and aligns a block rather than its lines.
 */
export async function drawText(
  rawStyle: TextStyle,
  rawWidth: number,
  font: Uint8Array,
): Promise<Image> {
  const { style, width } = clampStyle(rawStyle, rawWidth);
  const boxW = Math.max(1, Math.round(width));
  const lineGap = Math.round(style.size * 1.2);
  const paragraphs = (style.text || " ").split(/\r?\n/);
  const drawn: Image[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      drawn.push(new Image(boxW, lineGap));
      continue;
    }
    // imagescript 1.3 names these the other way round: `verticalAlign` is left/center/right.
    const layout = new TextLayout({
      maxWidth: boxW,
      verticalAlign: style.align,
      wrapStyle: "word",
    });
    drawn.push(await Image.renderText(font, style.size, paragraph, colour(style.colour), layout));
  }
  const height = Math.max(
    1,
    drawn.reduce((h, img) => h + img.height, 0),
  );
  const box = new Image(boxW, height);
  let y = 0;
  for (const img of drawn) {
    const x =
      style.align === "left"
        ? 0
        : style.align === "right"
          ? boxW - img.width
          : Math.round((boxW - img.width) / 2);
    box.composite(img, Math.max(0, x), y);
    y += img.height;
  }
  return box;
}
