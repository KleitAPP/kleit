import { useEffect, useRef, useState } from "react";

import { Chip, PrimaryButton } from "@/components/kleit";
import {
  addStroke,
  hasCutAnything,
  renderCutout,
  resetCutout,
  startCutout,
  undoStroke,
  type Brush,
  type Cutout,
} from "@/photos/cutout";
import { t } from "@/i18n/en";

/**
 * S35 — the cutout editor (design pack §2.2; spec 4.4 #3, #6).
 *
 * Two brushes and an undo. "Erase" takes background away, "Restore" puts it back, and Undo is
 * exact because nothing is ever painted onto the photo - see cutout.ts. Keep background is a
 * real choice here, not a fallback: a flat-lay on a nice floor is a fine closet photo as it is.
 *
 * The canvas is the full-resolution picture scaled down by CSS. Pointer positions are mapped
 * back through that scale so a stroke lands where the finger was, at whatever zoom the phone
 * has put the page at. Brush sizes are a share of the picture's width for the same reason: a
 * "medium" brush should feel the same on a 900 px photo and a 2048 px one.
 */
export function CutoutEditor({
  source,
  base = null,
  onDone,
  onKeepBackground,
}: {
  source: HTMLCanvasElement;
  /** The phone's own cutout as the first mask (M8.3), or nothing. */
  base?: HTMLCanvasElement | null;
  onDone: (cutout: Cutout) => void;
  /** The person decided to keep the photo as it is. */
  onKeepBackground: () => void;
}) {
  const view = useRef<HTMLCanvasElement>(null);
  const cutoutRef = useRef<Cutout | null>(null);
  const [brush, setBrush] = useState<Brush>("erase");
  const [size, setSize] = useState<"small" | "medium" | "large">("medium");
  const [strokes, setStrokes] = useState(0);
  const drawing = useRef<Array<{ x: number; y: number }> | null>(null);

  // Start (or restart) from the given source.
  useEffect(() => {
    const cutout = startCutout(source, base);
    cutoutRef.current = cutout;
    setStrokes(0);
    if (view.current) renderCutout(cutout, view.current);
  }, [source, base]);

  function repaint() {
    const cutout = cutoutRef.current;
    if (cutout && view.current) renderCutout(cutout, view.current);
    setStrokes(cutout?.strokes.length ?? 0);
  }

  function brushPixels(): number {
    const width = cutoutRef.current?.width ?? 1000;
    return Math.max(
      8,
      Math.round(width * (size === "small" ? 0.02 : size === "medium" ? 0.05 : 0.1)),
    );
  }

  function toImage(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = [toImage(e)];
    preview();
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current.push(toImage(e));
    preview();
  }
  function end() {
    const cutout = cutoutRef.current;
    const points = drawing.current;
    drawing.current = null;
    if (!cutout || !points) return;
    addStroke(cutout, { brush, size: brushPixels(), points });
    repaint();
  }

  /**
   * While the finger is down, show the stroke as it grows. It is painted onto the mask and then
   * taken off the list again: the mask keeps the paint, the list does not, and `end()` commits
   * the same points for real. Undo and Reset rebuild the mask from the list, so a preview can
   * never outlive the stroke it belonged to.
   */
  function preview() {
    const cutout = cutoutRef.current;
    const points = drawing.current;
    if (!cutout || !points || !view.current) return;
    addStroke(cutout, { brush, size: brushPixels(), points });
    renderCutout(cutout, view.current);
    cutout.strokes.pop();
  }

  const cut = cutoutRef.current ? hasCutAnything(cutoutRef.current) : false;

  return (
    <div className="mt-6">
      <p className="text-sm text-ink-soft">{t("cutout.how")}</p>

      {/* A checkerboard is the convention for "this part is gone"; painted with the theme's two surfaces. */}
      <div
        className="mt-3 overflow-hidden rounded-md border border-line"
        style={{
          backgroundImage:
            "linear-gradient(45deg, var(--color-surface-2) 25%, transparent 25%, transparent 75%, var(--color-surface-2) 75%), linear-gradient(45deg, var(--color-surface-2) 25%, transparent 25%, transparent 75%, var(--color-surface-2) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 8px 8px",
          backgroundColor: "var(--color-surface)",
        }}
      >
        <canvas
          ref={view}
          className="block w-full touch-none select-none"
          style={{ aspectRatio: `${source.width} / ${source.height}` }}
          aria-label={t("cutout.canvas")}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={(e) => {
            if (drawing.current) end();
            e.currentTarget.releasePointerCapture?.(e.pointerId);
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("cutout.brush")}>
        <Chip
          label={t("cutout.erase")}
          selected={brush === "erase"}
          onToggle={() => setBrush("erase")}
        />
        <Chip
          label={t("cutout.restore")}
          selected={brush === "restore"}
          onToggle={() => setBrush("restore")}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t("cutout.size")}>
        <Chip
          label={t("cutout.small")}
          selected={size === "small"}
          onToggle={() => setSize("small")}
        />
        <Chip
          label={t("cutout.medium")}
          selected={size === "medium"}
          onToggle={() => setSize("medium")}
        />
        <Chip
          label={t("cutout.large")}
          selected={size === "large"}
          onToggle={() => setSize("large")}
        />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={strokes === 0}
          onClick={() => {
            if (cutoutRef.current) undoStroke(cutoutRef.current);
            repaint();
          }}
          className="min-h-12 flex-1 rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
        >
          {t("cutout.undo")}
        </button>
        <button
          type="button"
          disabled={strokes === 0}
          onClick={() => {
            if (cutoutRef.current) resetCutout(cutoutRef.current);
            repaint();
          }}
          className="min-h-12 flex-1 rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
        >
          {t("cutout.reset")}
        </button>
      </div>

      <div className="mt-6">
        <PrimaryButton
          onClick={() => {
            if (cutoutRef.current) onDone(cutoutRef.current);
          }}
        >
          {cut ? t("cutout.useCutout") : t("photo.add")}
        </PrimaryButton>
        <button
          type="button"
          onClick={onKeepBackground}
          className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("cutout.keepBackground")}
        </button>
      </div>
    </div>
  );
}
