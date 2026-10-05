import type Konva from "konva";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Image as KImage, Layer, Line, Rect, Stage, Text as KText, Transformer } from "react-konva";

import { guidesFor, snap, type Doc, type Layer as DocLayer } from "@/canvas/doc";

/** The stage's own marks - guides and the selection - are editor UI, fixed like the set's own colours. */
export const GUIDE = "#d9552b";
export const CROP_SCRIM = "rgba(0,0,0,0.45)";

export type Images = Record<string, HTMLImageElement | null>;

/** The key a layer's picture is kept under: the item id, or `asset:<catalogue id>` for a decoration. */
export function imageKey(layer: DocLayer): string {
  if (layer.kind !== "asset") return layer.itemId;
  return `asset:${layer.asset ?? ""}${layer.colour ? `:${layer.colour}` : ""}`;
}
/** The key the background picture is kept under. */
export const BACKGROUND_KEY = "background";
/** Font id → CSS family, once loaded (fonts/load.ts). */
export type Families = Record<string, string>;

export type StageApi = { stage: RefObject<Konva.Stage | null> };

/** The crop that fills a box with a picture the way CSS object-fit: cover does (centred). */
export function cover(img: HTMLImageElement, w: number, h: number) {
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const cw = w / k;
  const ch = h / k;
  return {
    crop: {
      x: (img.naturalWidth - cw) / 2,
      y: (img.naturalHeight - ch) / 2,
      width: cw,
      height: ch,
    },
  };
}

/**
 * The canvas (S59). Three Konva layers, the rule from the artwork pack: background (never
 * listening), the pieces, and the UI layer with the guides, the selection handles and - during
 * a drag - the piece being dragged. A drag never redraws the pieces layer: the piece is hidden
 * there once, drawn as a ghost in the UI layer while it moves, and put back once at the end.
 * That is the "lifted drag" M4.1 measured.
 *
 * Nothing here changes the document directly: every gesture ends in one `onChange` with the
 * edited layer, so the editor commits it as one undo step.
 */
export function CanvasStage({
  doc,
  images,
  families,
  selected,
  cropping,
  scale,
  stageRef,
  onSelect,
  onChange,
  onCrop,
  onMeasure,
}: {
  doc: Doc;
  images: Images;
  families: Families;
  selected: string | null;
  cropping: boolean;
  scale: number;
  stageRef: RefObject<Konva.Stage | null>;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<DocLayer>) => void;
  onCrop: (id: string, crop: DocLayer["crop"]) => void;
  /** A text layer's real height once drawn, so the document's box follows the words. */
  onMeasure: (id: string, h: number) => void;
}) {
  const nodes = useRef<Record<string, Konva.Image | null>>({});
  const trRef = useRef<Konva.Transformer>(null);
  const cropRef = useRef<Konva.Rect>(null);
  const cropTrRef = useRef<Konva.Transformer>(null);
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    y: number;
    v: number | null;
    h: number | null;
  } | null>(null);
  const dragState = useRef<{
    id: string;
    startX: number;
    startY: number;
    px: number;
    py: number;
    moved: boolean;
  } | null>(null);
  const pinch = useRef<{
    id: string;
    dist: number;
    angle: number;
    w: number;
    h: number;
    rotation: number;
  } | null>(null);

  // A text layer's height is whatever its words need at its width; tell the document.
  useEffect(() => {
    for (const id of doc.order) {
      const layer = doc.layers[id];
      const node = nodes.current[id] as unknown as Konva.Text | null;
      if (!layer || layer.kind !== "text" || !node || typeof node.height !== "function") continue;
      const h = Math.round(node.height());
      if (h > 0 && Math.abs(h - layer.h) > 1) onMeasure(id, h);
    }
  }, [doc, families, onMeasure]);

  // The selection handles follow the selected piece (a Transformer may live on another layer).
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selected && !cropping ? nodes.current[selected] : null;
    const layer = selected ? doc.layers[selected] : null;
    tr.nodes(node && layer && !layer.locked && !layer.hidden ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selected, cropping, doc, drag]);

  useEffect(() => {
    const tr = cropTrRef.current;
    const rect = cropRef.current;
    if (!tr) return;
    tr.nodes(cropping && rect ? [rect] : []);
    tr.getLayer()?.batchDraw();
  }, [cropping, selected]);

  function toCanvas(e: Konva.KonvaEventObject<PointerEvent | TouchEvent | MouseEvent>): {
    x: number;
    y: number;
  } {
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition() ?? { x: 0, y: 0 };
    return { x: p.x / scale, y: p.y / scale };
  }

  function pointerDown(id: string, e: Konva.KonvaEventObject<PointerEvent>) {
    const layer = doc.layers[id];
    if (!layer || layer.locked) {
      onSelect(id);
      return;
    }
    if (cropping) return;
    e.cancelBubble = true;
    onSelect(id);
    const p = toCanvas(e);
    dragState.current = { id, startX: layer.x, startY: layer.y, px: p.x, py: p.y, moved: false };
  }

  function pointerMove(e: Konva.KonvaEventObject<PointerEvent>) {
    const d = dragState.current;
    if (!d) return;
    const layer = doc.layers[d.id];
    if (!layer) return;
    const p = toCanvas(e);
    const dx = p.x - d.px;
    const dy = p.y - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    d.moved = true;
    const snapped = snap(
      { x: d.startX + dx, y: d.startY + dy, w: layer.w, h: layer.h },
      guidesFor(doc, d.id),
    );
    setDrag({ id: d.id, x: snapped.x, y: snapped.y, v: snapped.snappedV, h: snapped.snappedH });
  }

  function pointerUp() {
    const d = dragState.current;
    dragState.current = null;
    if (d && drag && d.moved) onChange(d.id, { x: Math.round(drag.x), y: Math.round(drag.y) });
    setDrag(null);
  }

  // Pinch: two fingers on the stage with a piece selected resize and rotate it (spec 6.1 #1).
  function touchMove(e: Konva.KonvaEventObject<TouchEvent>) {
    const touches = e.evt.touches;
    if (touches.length !== 2 || !selected || cropping) return;
    const layer = doc.layers[selected];
    if (!layer || layer.locked) return;
    e.evt.preventDefault();
    const [a, b] = [touches[0]!, touches[1]!];
    const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    const angle = (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
    if (!pinch.current || pinch.current.id !== selected) {
      pinch.current = {
        id: selected,
        dist,
        angle,
        w: layer.w,
        h: layer.h,
        rotation: layer.rotation,
      };
      dragState.current = null;
      setDrag(null);
      return;
    }
    const k = dist / pinch.current.dist;
    const node = nodes.current[selected];
    if (node) {
      node.scaleX((layer.flipX ? -1 : 1) * k);
      node.scaleY((layer.flipY ? -1 : 1) * k);
      node.rotation(pinch.current.rotation + (angle - pinch.current.angle));
      node.getLayer()?.batchDraw();
    }
  }

  function touchEnd() {
    const p = pinch.current;
    pinch.current = null;
    if (!p) return;
    const node = nodes.current[p.id];
    const layer = doc.layers[p.id];
    if (!node || !layer) return;
    const k = Math.abs(node.scaleX());
    const w = Math.max(24, Math.round(p.w * k));
    const h = Math.max(24, Math.round(p.h * k));
    const cx = layer.x + layer.w / 2;
    const cy = layer.y + layer.h / 2;
    node.scaleX(layer.flipX ? -1 : 1);
    node.scaleY(layer.flipY ? -1 : 1);
    onChange(p.id, {
      w,
      h,
      x: Math.round(cx - w / 2),
      y: Math.round(cy - h / 2),
      rotation: Math.round(node.rotation()),
    });
  }

  function transformEnd(id: string) {
    const node = nodes.current[id];
    const layer = doc.layers[id];
    if (!node || !layer) return;
    const w = Math.max(24, Math.round(layer.w * Math.abs(node.scaleX())));
    const h = Math.max(24, Math.round(layer.h * Math.abs(node.scaleY())));
    if (layer.kind === "text" && layer.text) {
      // Scaling words scales their size; the box follows the words on the next draw.
      const k = Math.abs(node.scaleX());
      node.scaleX(layer.flipX ? -1 : 1);
      node.scaleY(layer.flipY ? -1 : 1);
      onChange(id, {
        w,
        x: Math.round(node.x() - w / 2),
        y: Math.round(node.y() - h / 2),
        rotation: Math.round(node.rotation()),
        text: { ...layer.text, size: Math.max(12, Math.round(layer.text.size * k)) },
      });
      return;
    }
    node.scaleX(layer.flipX ? -1 : 1);
    node.scaleY(layer.flipY ? -1 : 1);
    // The node is positioned by its centre; the document keeps the top-left of the unrotated box.
    onChange(id, {
      w,
      h,
      x: Math.round(node.x() - w / 2),
      y: Math.round(node.y() - h / 2),
      rotation: Math.round(node.rotation()),
    });
  }

  function cropEnd() {
    const rect = cropRef.current;
    const layer = selected ? doc.layers[selected] : null;
    if (!rect || !layer || !selected) return;
    const w = rect.width() * rect.scaleX();
    const h = rect.height() * rect.scaleY();
    rect.scaleX(1);
    rect.scaleY(1);
    const fx = Math.min(1, Math.max(0, (rect.x() - layer.x) / layer.w));
    const fy = Math.min(1, Math.max(0, (rect.y() - layer.y) / layer.h));
    const fw = Math.min(1 - fx, Math.max(0.05, w / layer.w));
    const fh = Math.min(1 - fy, Math.max(0.05, h / layer.h));
    rect.setAttrs({
      x: layer.x + fx * layer.w,
      y: layer.y + fy * layer.h,
      width: fw * layer.w,
      height: fh * layer.h,
    });
    // Compose with any crop already applied: the rect is drawn over the shown (already cropped) picture.
    const base = layer.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    onCrop(selected, {
      x: base.x + fx * base.w,
      y: base.y + fy * base.h,
      w: fw * base.w,
      h: fh * base.h,
    });
  }

  function cropProp(
    layer: DocLayer,
    img: HTMLImageElement | null,
  ): { crop: { x: number; y: number; width: number; height: number } } | Record<string, never> {
    if (!layer.crop || !img) return {};
    return {
      crop: {
        x: layer.crop.x * img.naturalWidth,
        y: layer.crop.y * img.naturalHeight,
        width: layer.crop.w * img.naturalWidth,
        height: layer.crop.h * img.naturalHeight,
      },
    };
  }

  const piece = (layer: DocLayer, ghost: boolean) => {
    const img = images[imageKey(layer)] ?? null;
    const x = ghost && drag ? drag.x : layer.x;
    const y = ghost && drag ? drag.y : layer.y;
    const common = {
      x: x + layer.w / 2,
      y: y + layer.h / 2,
      offsetX: layer.w / 2,
      offsetY: layer.h / 2,
      width: layer.w,
      height: layer.h,
      rotation: layer.rotation,
      scaleX: layer.flipX ? -1 : 1,
      scaleY: layer.flipY ? -1 : 1,
      opacity: layer.opacity,
    };
    if (layer.kind === "text" && layer.text) {
      const family = families[layer.text.font] ?? "sans-serif";
      return (
        <KText
          key={ghost ? `ghost-${layer.id}` : layer.id}
          ref={
            ghost ? undefined : (n) => void (nodes.current[layer.id] = n as unknown as Konva.Image)
          }
          text={layer.text.text}
          fontFamily={family}
          fontSize={layer.text.size}
          fill={layer.text.colour}
          align={layer.text.align}
          lineHeight={1.2}
          x={x + layer.w / 2}
          y={y + layer.h / 2}
          offsetX={layer.w / 2}
          offsetY={layer.h / 2}
          width={layer.w}
          rotation={layer.rotation}
          scaleX={layer.flipX ? -1 : 1}
          scaleY={layer.flipY ? -1 : 1}
          opacity={layer.opacity}
          visible={ghost || drag?.id !== layer.id}
          listening={!ghost && !layer.locked}
          perfectDrawEnabled={false}
          onPointerDown={(e) => pointerDown(layer.id, e)}
          onTransformEnd={() => transformEnd(layer.id)}
        />
      );
    }
    if (!img) {
      return (
        <Rect
          key={layer.id}
          {...common}
          fill={CROP_SCRIM}
          cornerRadius={8}
          listening={!ghost}
          onPointerDown={(e) => pointerDown(layer.id, e)}
        />
      );
    }
    return (
      <KImage
        key={ghost ? `ghost-${layer.id}` : layer.id}
        ref={ghost ? undefined : (n) => void (nodes.current[layer.id] = n)}
        image={img}
        {...common}
        {...cropProp(layer, img)}
        visible={ghost || drag?.id !== layer.id}
        listening={!ghost && !layer.locked}
        perfectDrawEnabled={false}
        onPointerDown={(e) => pointerDown(layer.id, e)}
        onTransformEnd={() => transformEnd(layer.id)}
      />
    );
  };

  const dragging = drag ? doc.layers[drag.id] : null;
  const cropLayer = cropping && selected ? doc.layers[selected] : null;
  const cropBox = cropLayer
    ? { x: cropLayer.x, y: cropLayer.y, w: cropLayer.w, h: cropLayer.h }
    : null;

  return (
    <Stage
      ref={stageRef}
      width={doc.canvas.w * scale}
      height={doc.canvas.h * scale}
      scaleX={scale}
      scaleY={scale}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerLeave={pointerUp}
      onTouchMove={touchMove}
      onTouchEnd={touchEnd}
      onPointerDown={(e) => {
        if (e.target === e.target.getStage()) onSelect(null);
      }}
    >
      <Layer listening={false}>
        <Rect x={0} y={0} width={doc.canvas.w} height={doc.canvas.h} fill={doc.background} />
        {doc.backgroundAsset && images[BACKGROUND_KEY] ? (
          <KImage
            image={images[BACKGROUND_KEY]!}
            x={0}
            y={0}
            width={doc.canvas.w}
            height={doc.canvas.h}
            {...cover(images[BACKGROUND_KEY]!, doc.canvas.w, doc.canvas.h)}
            listening={false}
            perfectDrawEnabled={false}
          />
        ) : null}
      </Layer>
      <Layer>
        {doc.order.map((id) => {
          const layer = doc.layers[id];
          return layer && !layer.hidden ? piece(layer, false) : null;
        })}
      </Layer>
      <Layer>
        {dragging ? piece(dragging, true) : null}
        {drag?.v !== null && drag?.v !== undefined ? (
          <Line
            points={[drag.v, 0, drag.v, doc.canvas.h]}
            stroke={GUIDE}
            strokeWidth={2 / scale}
            dash={[8, 6]}
            listening={false}
          />
        ) : null}
        {drag?.h !== null && drag?.h !== undefined ? (
          <Line
            points={[0, drag.h, doc.canvas.w, drag.h]}
            stroke={GUIDE}
            strokeWidth={2 / scale}
            dash={[8, 6]}
            listening={false}
          />
        ) : null}
        <Transformer
          ref={trRef}
          rotateEnabled
          keepRatio
          enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
          anchorSize={14}
          borderStroke={GUIDE}
          anchorStroke={GUIDE}
          rotateAnchorOffset={30}
          flipEnabled={false}
        />
        {cropBox ? (
          <>
            <Rect
              ref={cropRef}
              x={cropBox.x}
              y={cropBox.y}
              width={cropBox.w}
              height={cropBox.h}
              stroke={GUIDE}
              strokeWidth={2 / scale}
              fill="rgba(217,85,43,0.12)"
              draggable
              dragBoundFunc={(pos) => ({
                x: Math.min(
                  Math.max(pos.x, cropBox.x * scale),
                  (cropBox.x + cropBox.w) * scale - (cropRef.current?.width() ?? 0) * scale,
                ),
                y: Math.min(
                  Math.max(pos.y, cropBox.y * scale),
                  (cropBox.y + cropBox.h) * scale - (cropRef.current?.height() ?? 0) * scale,
                ),
              })}
              onDragEnd={cropEnd}
              onTransformEnd={cropEnd}
            />
            <Transformer
              ref={cropTrRef}
              rotateEnabled={false}
              keepRatio={false}
              anchorSize={14}
              borderStroke={GUIDE}
              anchorStroke={GUIDE}
              flipEnabled={false}
            />
          </>
        ) : null}
      </Layer>
    </Stage>
  );
}
