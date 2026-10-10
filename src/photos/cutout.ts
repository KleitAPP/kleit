/**
 * Cutting a piece out of its photo, by hand (roadmap M2.6; spec 4.4 #3 and #6; design pack S35).
 *
 * On the web there is no automatic background removal - the two libraries that do it in a
 * browser have licences a business cannot use (spec 4.4 #6) - so the web path is the honest one:
 * keep the background, or take it away yourself with an eraser and put it back with a brush. On
 * the phone (M8) the system's own cutout fills the mask in first and the same two brushes fix it.
 *
 * The picture is never painted on. Every stroke goes onto a MASK - a second canvas the same size,
 * where opaque means keep and clear means gone - and the result is the photo shown through the
 * mask. That is why undo is exact and free: the strokes are a list, and undoing one is drawing
 * the list again without it. Nothing is ever lost from the photo itself.
 *
 * Nothing here touches the DOM beyond canvases, so it runs in a test browser with no screen.
 */

export type Brush = "erase" | "restore";

export type Stroke = {
  brush: Brush;
  /** Brush width in image pixels. */
  size: number;
  /** Points in image pixels. One point is a dot. */
  points: Array<{ x: number; y: number }>;
};

export type Cutout = {
  /** The photo, already prepared (redrawn, oriented, capped). Never drawn on. */
  source: HTMLCanvasElement;
  /** Opaque = keep, transparent = gone. */
  mask: HTMLCanvasElement;
  strokes: Stroke[];
  width: number;
  height: number;
  /**
   * The mask the strokes are painted over: the phone's own cutout (M8.3), or nothing, which
   * means "keep all". Reset goes back to this, not to a blank photo.
   */
  base: HTMLCanvasElement | null;
};

/**
 * The starting point: everything kept (the web), or the phone's own cutout as the first mask
 * (`base`, the same size as the source) with the brushes to fix it.
 */
export function startCutout(
  source: HTMLCanvasElement,
  base: HTMLCanvasElement | null = null,
): Cutout {
  const mask = document.createElement("canvas");
  mask.width = source.width;
  mask.height = source.height;
  const cutout: Cutout = {
    source,
    mask,
    strokes: [],
    width: source.width,
    height: source.height,
    base: base && base.width === source.width && base.height === source.height ? base : null,
  };
  redrawMask(cutout);
  return cutout;
}

/** Add a stroke and paint it. Returns the same cutout for chaining. */
export function addStroke(cutout: Cutout, stroke: Stroke): Cutout {
  if (stroke.points.length === 0) return cutout;
  cutout.strokes.push(stroke);
  paintStroke(cutout.mask, stroke);
  return cutout;
}

/** Take the last stroke back. Exact, because the mask is rebuilt from the list. */
export function undoStroke(cutout: Cutout): Cutout {
  cutout.strokes.pop();
  redrawMask(cutout);
  return cutout;
}

/** Everything kept again. */
export function resetCutout(cutout: Cutout): Cutout {
  cutout.strokes.length = 0;
  redrawMask(cutout);
  return cutout;
}

/** The photo shown through the mask, onto the given canvas (or a new one). */
export function renderCutout(cutout: Cutout, onto?: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = onto ?? document.createElement("canvas");
  canvas.width = cutout.width;
  canvas.height = cutout.height;
  const g = must(canvas.getContext("2d"));
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = "source-over";
  g.drawImage(cutout.source, 0, 0);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(cutout.mask, 0, 0);
  g.globalCompositeOperation = "source-over";
  return canvas;
}

/** True if anything has been taken away - i.e. the result needs transparency. */
export function hasCutAnything(cutout: Cutout): boolean {
  return cutout.base !== null || cutout.strokes.some((s) => s.brush === "erase");
}

/**
 * The finished piece as a file to upload. Transparent PNG when something was cut away; JPEG
 * otherwise, because a JPEG of an untouched photo is a quarter the size and the server can read
 * both (its decoder does JPEG and PNG, not WebP - see prepare.ts).
 */
export async function finishCutout(
  cutout: Cutout,
): Promise<{ blob: Blob; type: "image/png" | "image/jpeg"; width: number; height: number }> {
  const canvas = renderCutout(cutout);
  const type = hasCutAnything(cutout) ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.86 : undefined),
  );
  if (!blob) throw new Error("could not encode the cutout");
  return { blob, type, width: cutout.width, height: cutout.height };
}

// ---------------------------------------------------------------------------

function redrawMask(cutout: Cutout): void {
  const g = must(cutout.mask.getContext("2d"));
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, cutout.mask.width, cutout.mask.height);
  if (cutout.base) {
    g.drawImage(cutout.base, 0, 0);
  } else {
    g.fillStyle = "#000";
    g.fillRect(0, 0, cutout.mask.width, cutout.mask.height);
  }
  for (const stroke of cutout.strokes) paintStroke(cutout.mask, stroke);
}

function paintStroke(mask: HTMLCanvasElement, stroke: Stroke): void {
  const g = must(mask.getContext("2d"));
  // Erase takes alpha away; restore puts it back. The colour is irrelevant - only alpha is read.
  g.globalCompositeOperation = stroke.brush === "erase" ? "destination-out" : "source-over";
  g.strokeStyle = "#000";
  g.fillStyle = "#000";
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = stroke.size;
  const [first, ...rest] = stroke.points;
  if (!first) return;
  if (rest.length === 0) {
    g.beginPath();
    g.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(first.x, first.y);
    for (const p of rest) g.lineTo(p.x, p.y);
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";
}

function must<T>(value: T | null): T {
  if (value === null) throw new Error("no 2d context");
  return value;
}
