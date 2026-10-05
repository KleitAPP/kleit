import { createFileRoute } from "@tanstack/react-router";
import Konva from "konva";
import { useEffect, useMemo, useRef, useState } from "react";

import { emptyDoc } from "@/canvas/doc";
import { exportSet, type ExportFormat, type ExportSize } from "@/canvas/exportSet";
import { Image as KImage, Layer, Path, Rect, Stage } from "react-konva";

import {
  BRICK,
  heapMb,
  hueFill,
  INK,
  PAPER,
  measureDrag,
  measureDrawer,
  placements,
  rasterStandIn,
  STAR_PATH,
  TARGETS,
  thumbnailDataUris,
  type NodeKind,
  type SpeedResult,
} from "@/canvas/speedTest";

/**
 * M4.1 — the older-Android canvas speed test (roadmap M4.1; artwork pack §7.5–7.6).
 *
 * The Konva rules the real editor will be checked against are already obeyed here, so the
 * number this page measures is the number the editor will get: three layers in total
 * (background, canvas, UI), the background not listening, `pixelRatio` chosen once, caching
 * on nothing smaller than 128 px. 50 / 100 / 150 nodes, drawn or raster, pixelRatio 1 or 2.
 *
 * Tap "Run" and read the numbers; or let scripts/check-canvas-speed.mjs drive it through
 * `window.KleitSpeed`. A debug route, removed before launch like /dev/screens (WA7).
 */
export const Route = createFileRoute("/dev/canvas-speed")({
  head: () => ({
    meta: [{ title: "Kleit - canvas speed" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: CanvasSpeed,
});

const W = 1080;
const H = 1350;

declare global {
  interface Window {
    KleitSpeed?: {
      run: (count: number, kind: NodeKind, pixelRatio: number) => Promise<SpeedResult>;
      last: SpeedResult | null;
      /** M4.6: the export, from this stage - size, type and a corner pixel's alpha. */
      exportProbe: (
        format: ExportFormat,
        size: ExportSize,
      ) => Promise<{ w: number; h: number; type: string; bytes: number; cornerAlpha: number }>;
    };
  }
}

function CanvasSpeed() {
  const [count, setCount] = useState(150);
  const [kind, setKind] = useState<NodeKind>("drawn");
  const [pixelRatio, setPixelRatio] = useState(1);
  const [result, setResult] = useState<SpeedResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(0.3);
  const stageRef = useRef<Konva.Stage>(null);
  const movingRef = useRef<Konva.Node>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const mountedAt = useRef(performance.now());
  const firstRender = useRef<number | null>(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerWidth - 32) / W));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // pixelRatio is a Konva global, set before the stage draws (artwork pack §7.5 rule 4).
  Konva.pixelRatio = pixelRatio;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- epoch re-keys the layer on purpose
  const nodes = useMemo(() => placements(count, W, H), [count, epoch]);
  const bitmaps = useMemo(
    () => (kind === "raster" ? nodes.map((n) => rasterStandIn(n.hue)) : []),
    [nodes, kind],
  );
  const thumbs = useMemo(() => thumbnailDataUris(24), []);

  useEffect(() => {
    // The first render of this many nodes: from the moment the change was asked for (the
    // mount, or the re-key in run()) to the frame after the layer has painted - React's work,
    // Konva's node creation and the draw all inside it.
    firstRender.current = null;
    const started = mountedAt.current;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        firstRender.current = performance.now() - started;
      });
    });
  }, [nodes, kind, pixelRatio]);

  async function run(c = count, k = kind, pr = pixelRatio): Promise<SpeedResult> {
    setBusy(true);
    mountedAt.current = performance.now();
    setCount(c);
    setKind(k);
    setPixelRatio(pr);
    setEpoch((e) => e + 1); // a fresh layer every run, so "first render" is always a first render
    await new Promise((r) => setTimeout(r, 600));
    const stage = stageRef.current!;
    const canvasLayer = stage.getLayers()[1]!;
    const mover = movingRef.current!;
    const startX = mover.x();
    const startY = mover.y();
    const path = (t: number) => ({
      x: startX + Math.sin(t * Math.PI * 2) * 300,
      y: startY + Math.cos(t * Math.PI * 2) * 200,
    });
    // Naive: the whole layer redraws every frame.
    const drag = await measureDrag((t) => {
      mover.position(path(t));
      canvasLayer.batchDraw();
    });
    mover.position({ x: startX, y: startY });
    canvasLayer.batchDraw();
    // Lifted: the moving node goes to the UI layer for the drag, so only it redraws.
    const uiLayer = stage.getLayers()[2]!;
    mover.moveTo(uiLayer);
    canvasLayer.batchDraw();
    const lifted = await measureDrag((t) => {
      mover.position(path(t));
      uiLayer.batchDraw();
    });
    mover.position({ x: startX, y: startY });
    mover.moveTo(canvasLayer);
    mover.moveToTop();
    canvasLayer.batchDraw();
    uiLayer.batchDraw();
    const drawerMs = drawerRef.current ? await measureDrawer(drawerRef.current, thumbs) : 0;
    const heap = heapMb();
    const fr = firstRender.current ?? 0;
    const out: SpeedResult = {
      count: c,
      kind: k,
      pixelRatio: pr,
      firstRenderMs: Math.round(fr),
      dragMedianMs: Math.round(drag.median * 10) / 10,
      dragP95Ms: Math.round(drag.p95 * 10) / 10,
      dragFrames: drag.frames,
      liftedMedianMs: Math.round(lifted.median * 10) / 10,
      liftedP95Ms: Math.round(lifted.p95 * 10) / 10,
      heapMb: heap,
      drawerFirstPaintMs: Math.round(drawerMs),
      passes: {
        drag: lifted.p95 <= TARGETS.dragMs,
        dragFlat: drag.p95 <= TARGETS.dragMs,
        firstRender: fr <= TARGETS.firstRenderMs,
        heap: heap === null ? null : heap <= TARGETS.heapMb,
        drawer: drawerMs <= TARGETS.drawerMs,
      },
    };
    setResult(out);
    setBusy(false);
    if (window.KleitSpeed) window.KleitSpeed.last = out;
    return out;
  }

  async function exportProbe(format: ExportFormat, size: ExportSize) {
    const { blob } = await exportSet(
      stageRef.current!,
      { ...emptyDoc("portrait"), background: PAPER },
      format,
      size,
      "probe",
    );
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(2, 2, 1, 1).data;
    return { w: bmp.width, h: bmp.height, type: blob.type, bytes: blob.size, cornerAlpha: px[3]! };
  }

  useEffect(() => {
    window.KleitSpeed = { run, last: result, exportProbe };
    return () => {
      delete window.KleitSpeed;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, kind, pixelRatio, result]);

  return (
    <div className="min-h-dvh bg-canvas px-4 py-6 text-ink">
      <h1 className="font-display text-2xl">Canvas speed (M4.1)</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Targets: drag ≤ {TARGETS.dragMs} ms/frame · first render ≤ {TARGETS.firstRenderMs} ms · heap
        ≤ {TARGETS.heapMb} MB · drawer ≤ {TARGETS.drawerMs} ms
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {[50, 100, 150].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCount(c)}
            aria-pressed={count === c}
            className={`rounded-pill border border-line px-3 py-1 ${count === c ? "bg-ink text-canvas" : "bg-surface"}`}
          >
            {c} nodes
          </button>
        ))}
        {(["drawn", "raster"] as NodeKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`rounded-pill border border-line px-3 py-1 ${kind === k ? "bg-ink text-canvas" : "bg-surface"}`}
          >
            {k}
          </button>
        ))}
        {[1, 2].map((pr) => (
          <button
            key={pr}
            type="button"
            onClick={() => setPixelRatio(pr)}
            aria-pressed={pixelRatio === pr}
            className={`rounded-pill border border-line px-3 py-1 ${pixelRatio === pr ? "bg-ink text-canvas" : "bg-surface"}`}
          >
            pixelRatio {pr}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          className="rounded-pill bg-brand px-4 py-1 font-medium text-brand-ink disabled:opacity-40"
        >
          {busy ? "Measuring…" : "Run"}
        </button>
      </div>

      {result ? (
        <dl
          className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm"
          aria-live="polite"
          data-testid="result"
        >
          <dt>Drag (lifted), median / p95</dt>
          <dd>
            {result.liftedMedianMs} / {result.liftedP95Ms} ms {result.passes.drag ? "✓" : "✗"}
          </dd>
          <dt>Drag (whole layer), median / p95</dt>
          <dd>
            {result.dragMedianMs} / {result.dragP95Ms} ms {result.passes.dragFlat ? "✓" : "✗"}
          </dd>
          <dt>First render</dt>
          <dd>
            {result.firstRenderMs} ms {result.passes.firstRender ? "✓" : "✗"}
          </dd>
          <dt>JS heap</dt>
          <dd>
            {result.heapMb === null
              ? "not exposed by this browser"
              : `${result.heapMb} MB ${result.passes.heap ? "✓" : "✗"}`}
          </dd>
          <dt>Drawer first paint</dt>
          <dd>
            {result.drawerFirstPaintMs} ms {result.passes.drawer ? "✓" : "✗"}
          </dd>
        </dl>
      ) : null}

      <div
        className="mt-4 overflow-hidden rounded-md border border-line"
        style={{ width: W * scale, height: H * scale }}
      >
        <Stage ref={stageRef} width={W * scale} height={H * scale} scaleX={scale} scaleY={scale}>
          {/* Layer 1: background. Never listens (artwork pack §7.5 rule 3). */}
          <Layer listening={false}>
            <Rect x={0} y={0} width={W} height={H} fill={PAPER} />
          </Layer>
          {/* Layer 2: the nodes. The first one is the one the test drags. */}
          <Layer key={`${kind}-${epoch}-${pixelRatio}`}>
            {nodes.map((n, i) =>
              kind === "drawn" ? (
                <Path
                  key={i}
                  ref={i === 0 ? (movingRef as React.RefObject<Konva.Path>) : undefined}
                  data={STAR_PATH}
                  x={n.x}
                  y={n.y}
                  rotation={n.rotation}
                  scaleX={n.size / 100}
                  scaleY={n.size / 100}
                  fill={hueFill(n.hue)}
                  stroke={INK}
                  strokeWidth={2}
                  perfectDrawEnabled={false}
                  listening={i === 0}
                />
              ) : (
                <KImage
                  key={i}
                  ref={i === 0 ? (movingRef as React.RefObject<Konva.Image>) : undefined}
                  image={bitmaps[i]}
                  x={n.x}
                  y={n.y}
                  rotation={n.rotation}
                  width={n.size}
                  height={n.size}
                  listening={i === 0}
                />
              ),
            )}
          </Layer>
          {/* Layer 3: UI - the selection outline around the dragged node. */}
          <Layer listening={false}>
            <Rect
              x={nodes[0]?.x ?? 0}
              y={nodes[0]?.y ?? 0}
              width={nodes[0]?.size ?? 0}
              height={nodes[0]?.size ?? 0}
              stroke={BRICK}
              strokeWidth={3}
              dash={[8, 6]}
            />
          </Layer>
        </Stage>
      </div>

      <h2 className="mt-4 text-base font-medium">Drawer stand-in (24 thumbnails at 160 px)</h2>
      <div ref={drawerRef} className="mt-2 flex flex-wrap gap-2" aria-label="drawer" />
    </div>
  );
}
