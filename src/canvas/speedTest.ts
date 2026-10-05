/**
 * M4.1 — the canvas speed test, the part that measures (roadmap M4.1; artwork pack §7.6).
 *
 * Nothing in here knows about React or Konva: it takes "draw N nodes", "move one node", and
 * reads the clock, so the page can be driven by a person on the older Android and by the CI
 * script on a desktop in exactly the same way. The numbers to beat (artwork pack §7.6):
 * ≤ 33 ms sustained per frame while dragging one of 150 nodes, ≤ 1,500 ms first render,
 * ≤ 250 MB heap, ≤ 400 ms for a 24-thumbnail drawer's first paint.
 */

export type NodeKind = "drawn" | "raster";

export type SpeedResult = {
  count: number;
  kind: NodeKind;
  pixelRatio: number;
  firstRenderMs: number;
  /** Frame times while dragging, in ms: the median and the slowest of the middle 90 %. */
  dragMedianMs: number;
  dragP95Ms: number;
  dragFrames: number;
  /**
   * The same drag with the moving node lifted onto the UI layer for the length of the drag, so
   * the other nodes are not redrawn every frame - what the editor will do (Konva's own advice).
   */
  liftedMedianMs: number;
  liftedP95Ms: number;
  heapMb: number | null;
  drawerFirstPaintMs: number;
  /** `drag` is judged on the lifted drag, the one the editor performs; `dragFlat` is the naive one. */
  passes: {
    drag: boolean;
    dragFlat: boolean;
    firstRender: boolean;
    heap: boolean | null;
    drawer: boolean;
  };
};

/** The test canvas's own colours: a set's background and ink, fixed like any artwork (L14). */
export const PAPER = "#F4EFE6";
export const INK = "#1f1d1a";
export const BRICK = "#d9552b";
export const hueFill = (hue: number): string => `hsl(${hue} 55% 50%)`;

export const TARGETS = { dragMs: 33, firstRenderMs: 1500, heapMb: 250, drawerMs: 400 } as const;

export function heapMb(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? Math.round(mem.usedJSHeapSize / 1048576) : null;
}

/**
 * Drives one node across the canvas for about a second and a half and records how long each
 * frame took. `move` is called once per animation frame with a 0..1 progress.
 */
export function measureDrag(
  move: (t: number) => void,
  frames = 90,
): Promise<{ median: number; p95: number; frames: number }> {
  return new Promise((resolve) => {
    const times: number[] = [];
    let last = performance.now();
    let i = 0;
    const step = () => {
      const now = performance.now();
      if (i > 0) times.push(now - last);
      last = now;
      move(i / frames);
      i += 1;
      if (i <= frames) requestAnimationFrame(step);
      else {
        const sorted = [...times].sort((a, b) => a - b);
        const at = (q: number) =>
          sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
        resolve({ median: at(0.5), p95: at(0.95), frames: times.length });
      }
    };
    requestAnimationFrame(step);
  });
}

/** Deterministic positions, so two runs draw the same picture. */
export function placements(
  count: number,
  w: number,
  h: number,
): Array<{ x: number; y: number; size: number; rotation: number; hue: number }> {
  const out = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < count; i++) {
    const size = 80 + rand() * 200;
    out.push({
      x: rand() * (w - size),
      y: rand() * (h - size),
      size,
      rotation: rand() * 360,
      hue: Math.floor(rand() * 360),
    });
  }
  return out;
}

/** A 256² "cutout" stand-in: a soft blob with a hole, drawn once into a bitmap. */
export function rasterStandIn(hue: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = `hsl(${hue} 60% 55%)`;
  g.beginPath();
  g.ellipse(128, 128, 110, 90, 0.4, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.arc(160, 100, 30, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = "source-over";
  g.strokeStyle = "rgba(0,0,0,.35)";
  g.lineWidth = 6;
  g.beginPath();
  g.ellipse(128, 128, 110, 90, 0.4, 0, Math.PI * 2);
  g.stroke();
  return c;
}

/** A drawn-decoration stand-in: an eight-point star path, the kind of thing the library ships. */
export const STAR_PATH =
  "M50 0 L61 35 L98 35 L68 57 L79 91 L50 70 L21 91 L32 57 L2 35 L39 35 Z M50 20 L56 40 L76 40 L60 52 L66 72 L50 60 L34 72 L40 52 L24 40 L44 40 Z";

/** The drawer's first paint: 24 thumbnails as data-URI images, timed from append to load. */
export function measureDrawer(host: HTMLElement, thumbnails: string[]): Promise<number> {
  return new Promise((resolve) => {
    host.replaceChildren();
    const t0 = performance.now();
    let loaded = 0;
    for (const src of thumbnails) {
      const img = new Image();
      img.width = 160;
      img.height = 160;
      img.decoding = "async";
      img.onload = img.onerror = () => {
        loaded += 1;
        if (loaded === thumbnails.length)
          requestAnimationFrame(() => resolve(performance.now() - t0));
      };
      img.src = src;
      host.appendChild(img);
    }
  });
}

export function thumbnailDataUris(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(rasterStandIn((i * 47) % 360).toDataURL("image/png"));
  }
  return out;
}
