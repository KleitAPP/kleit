import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type Konva from "konva";
import { useCallback, useEffect, useRef, useState } from "react";

import { CanvasStage, type Images } from "@/canvas/CanvasStage";
import {
  addLayer,
  cloneLayer,
  commit,
  fit,
  flip,
  historyOf,
  LAYER_CAP,
  LAYER_WARNING,
  redo,
  removeLayer,
  reorder,
  setShape,
  undo,
  updateLayer,
  type CanvasShape,
  type Doc,
  type History,
  type OrderMove,
} from "@/canvas/doc";
import { LayersPanel, PanelButton, SelectedPanel } from "@/canvas/panels";
import { addRow, loadDoc, loadImage, saveDiff } from "@/canvas/persist";
import { Chip, EmptyState, PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import type { ItemSummary } from "@/items/items";
import { ItemPicker } from "@/sets/ItemPicker";
import { SWATCHES } from "@/sets/swatches";

/**
 * S59–S61 — Creative mode (roadmap M4.2; spec 6.1).
 *
 * The document is pure (doc.ts); this screen holds the history, asks the stage to draw the
 * present, commits each gesture as one undo step, and autosaves the difference 400 ms after the
 * last change. The thumb zone carries the selected piece's buttons (S61) so nothing needs a
 * drag; the layers sheet (S60) is the ordered list a screen reader walks.
 */
export const Route = createFileRoute("/_app/set/$setId/canvas")({
  head: () => ({
    meta: [{ title: "Creative set" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: CanvasScreen,
});

const SHAPES: ReadonlyArray<Exclude<CanvasShape, "free">> = ["square", "portrait", "story"];

function CanvasScreen() {
  const { setId } = Route.useParams();
  const navigate = useNavigate();
  const [history, setHistory] = useState<History | null>(null);
  const [items, setItems] = useState<Record<string, ItemSummary>>({});
  const [images, setImages] = useState<Images>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const [picking, setPicking] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const [notice, setNotice] = useState<string | null>(null);
  const [scale, setScale] = useState(0.3);
  const published = useRef(false);
  const stageRef = useRef<Konva.Stage>(null);
  const lastSaved = useRef<Doc | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Load.
  useEffect(() => {
    let cancelled = false;
    void loadDoc(setId).then(async (loaded) => {
      if (cancelled) return;
      if (!loaded) {
        setMissing(true);
        return;
      }
      published.current = loaded.status === "published";
      setItems(loaded.items);
      setHistory(historyOf(loaded.doc));
      lastSaved.current = loaded.doc;
      const loadedImages: Images = {};
      await Promise.all(
        Object.values(loaded.items).map(async (item) => {
          loadedImages[item.id] = await loadImage(item);
        }),
      );
      if (!cancelled) setImages(loadedImages);
    });
    return () => {
      cancelled = true;
    };
  }, [setId]);

  // Fit the canvas to the screen width; the document stays in canvas pixels.
  const doc = history?.present ?? null;
  useEffect(() => {
    if (!doc) return;
    const fitScale = () =>
      setScale(
        Math.min(
          (window.innerWidth - 32) / doc.canvas.w,
          (window.innerHeight * 0.55) / doc.canvas.h,
        ),
      );
    fitScale();
    window.addEventListener("resize", fitScale);
    return () => window.removeEventListener("resize", fitScale);
  }, [doc?.canvas.w, doc?.canvas.h, doc]);

  // Autosave the difference, 400 ms after the last change; retry on failure (spec 6.1 #10).
  useEffect(() => {
    if (!doc || !lastSaved.current || doc === lastSaved.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async function attempt() {
      const before = lastSaved.current;
      if (!before || before === doc) return;
      setSaveState("saving");
      const ok = await saveDiff(setId, before, doc, published.current);
      if (ok) {
        lastSaved.current = doc;
        setSaveState("saved");
      } else {
        setSaveState("failed");
        saveTimer.current = window.setTimeout(attempt, 4000);
      }
    }, 400);
  }, [doc, setId]);

  const apply = useCallback((next: Doc) => {
    setHistory((h) => (h ? commit(h, next) : h));
  }, []);

  const sel = selected && doc ? doc.layers[selected] : null;

  function change(id: string, patch: Partial<Doc["layers"][string]>) {
    if (!doc) return;
    apply(updateLayer(doc, id, patch));
  }

  async function addPiece(item: ItemSummary) {
    if (!doc) return;
    setPicking(false);
    if (doc.order.length >= LAYER_CAP) {
      setNotice(t("canvas.capReached", { cap: LAYER_CAP }));
      return;
    }
    const img = images[item.id] ?? (await loadImage(item));
    setItems((m) => ({ ...m, [item.id]: item }));
    setImages((m) => ({ ...m, [item.id]: img }));
    const size = img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: 400, h: 400 };
    const probe = addLayer(doc, "probe", item.id, size);
    if (!probe.ok) return;
    const position = probe.doc.layers["probe"]!;
    const rowId = await addRow(setId, item.id, {
      x: position.x,
      y: position.y,
      w: position.w,
      h: position.h,
      rotation: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
      hidden: false,
      locked: false,
      crop: null,
    });
    if (!rowId) {
      setSaveState("failed");
      return;
    }
    setHistory((h) => {
      if (!h) return h;
      const added = addLayer(h.present, rowId, item.id, size);
      if (!added.ok) return h;
      // The row is already on the server; the saved baseline carries it so the diff does not write it twice.
      lastSaved.current = lastSaved.current
        ? {
            ...lastSaved.current,
            layers: { ...lastSaved.current.layers, [rowId]: added.doc.layers[rowId]! },
            order: [...lastSaved.current.order, rowId],
          }
        : lastSaved.current;
      return commit(h, added.doc);
    });
    setSelected(rowId);
    if (doc.order.length + 1 >= LAYER_WARNING)
      setNotice(
        t("canvas.capWarning", {
          count: doc.order.length + 1,
          cap: LAYER_CAP,
          warn: LAYER_WARNING,
        }),
      );
  }

  async function duplicate() {
    if (!doc || !sel) return;
    if (doc.order.length >= LAYER_CAP) {
      setNotice(t("canvas.capReached", { cap: LAYER_CAP }));
      return;
    }
    const probe = cloneLayer(doc, sel.id, "probe");
    if (!probe.ok) return;
    const copy = probe.doc.layers["probe"]!;
    const { id: _id, itemId: _itemId, ...position } = copy;
    const rowId = await addRow(setId, sel.itemId, position);
    if (!rowId) {
      setSaveState("failed");
      return;
    }
    setHistory((h) => {
      if (!h) return h;
      const cloned = cloneLayer(h.present, sel.id, rowId);
      if (!cloned.ok) return h;
      lastSaved.current = lastSaved.current
        ? {
            ...lastSaved.current,
            layers: { ...lastSaved.current.layers, [rowId]: cloned.doc.layers[rowId]! },
            order: [...lastSaved.current.order, rowId],
          }
        : lastSaved.current;
      return commit(h, cloned.doc);
    });
    setSelected(rowId);
  }

  function remove(id: string) {
    if (!doc) return;
    apply(removeLayer(doc, id));
    if (selected === id) setSelected(null);
  }

  // Web keyboard shortcuts (spec 6.1 #23).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        setHistory((h) => (h ? undo(h) : h));
      } else if (
        (mod && e.key.toLowerCase() === "z" && e.shiftKey) ||
        (mod && e.key.toLowerCase() === "y")
      ) {
        e.preventDefault();
        setHistory((h) => (h ? redo(h) : h));
      } else if (mod && e.key.toLowerCase() === "d" && sel) {
        e.preventDefault();
        void duplicate();
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        e.preventDefault();
        remove(sel.id);
      } else if (e.key.startsWith("Arrow") && sel && !sel.locked && doc) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 10;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        apply(updateLayer(doc, sel.id, { x: sel.x + dx, y: sel.y + dy }));
      } else if ((e.key === "]" || e.key === "[") && sel && doc) {
        e.preventDefault();
        apply(reorder(doc, sel.id, e.key === "]" ? "forward" : "back"));
      } else if (e.key === "Escape") {
        setSelected(null);
        setCropping(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, doc]);

  if (missing) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("canvas.notFound")} />
      </div>
    );
  }
  if (!doc || !history) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8" role="status" aria-label={t("loading")}>
        <div className="kl-skeleton aspect-[4/5] w-full rounded-md bg-surface-2" />
      </div>
    );
  }

  const index = sel ? doc.order.indexOf(sel.id) : -1;
  const imgFor = sel ? images[sel.itemId] : null;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-3 pb-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-xl text-ink">{t("canvas.title")}</h1>
        <p className="text-sm text-ink-soft" role="status">
          {saveState === "saved"
            ? t("canvas.saved")
            : saveState === "saving"
              ? t("canvas.saving")
              : t("canvas.notSaved")}
        </p>
      </div>

      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        <PanelButton
          label={t("canvas.undo")}
          onPress={() => setHistory((h) => (h ? undo(h) : h))}
          disabled={history.past.length === 0}
        />
        <PanelButton
          label={t("canvas.redo")}
          onPress={() => setHistory((h) => (h ? redo(h) : h))}
          disabled={history.future.length === 0}
        />
        <PanelButton label={t("canvas.layers")} onPress={() => setLayersOpen(true)} />
        {SHAPES.map((shape) => (
          <Chip
            key={shape}
            label={t(`canvas.shape.${shape}`)}
            selected={doc.canvas.shape === shape}
            onToggle={() => apply(setShape(doc, shape))}
          />
        ))}
      </div>

      <div
        className="mt-3 overflow-hidden rounded-md border border-line bg-surface-2 touch-none"
        style={{ width: doc.canvas.w * scale, height: doc.canvas.h * scale }}
        aria-label={t("builder.canvas")}
      >
        <CanvasStage
          doc={doc}
          images={images}
          selected={selected}
          cropping={cropping}
          scale={scale}
          stageRef={stageRef}
          onSelect={(id) => {
            setSelected(id);
            if (id !== selected) setCropping(false);
          }}
          onChange={change}
          onCrop={(id, crop) => change(id, { crop })}
        />
      </div>
      {doc.order.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{t("canvas.empty")}</p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="mt-2 rounded-md border border-line bg-surface p-2 text-sm text-ink"
        >
          {notice}
        </p>
      ) : null}

      {/* Thumb zone. */}
      <div className="mt-3">
        {sel ? (
          <SelectedPanel
            layer={sel}
            cropping={cropping}
            canMoveUp={index < doc.order.length - 1}
            canMoveDown={index > 0}
            onNudge={(dx, dy) => change(sel.id, { x: sel.x + dx, y: sel.y + dy })}
            onSize={(k) => {
              const w = Math.max(24, Math.round(sel.w * k));
              const h = Math.max(24, Math.round(sel.h * k));
              change(sel.id, {
                w,
                h,
                x: Math.round(sel.x + (sel.w - w) / 2),
                y: Math.round(sel.y + (sel.h - h) / 2),
              });
            }}
            onRotate={(deg) => change(sel.id, { rotation: (sel.rotation + deg + 360) % 360 })}
            onFlip={(axis) => apply(flip(doc, sel.id, axis))}
            onOrder={(move) => apply(reorder(doc, sel.id, move))}
            onDuplicate={() => void duplicate()}
            onOpacity={(value) => change(sel.id, { opacity: value })}
            onFit={() =>
              apply(
                fit(
                  doc,
                  sel.id,
                  imgFor
                    ? { w: imgFor.naturalWidth, h: imgFor.naturalHeight }
                    : { w: sel.w, h: sel.h },
                ),
              )
            }
            onCrop={() => setCropping((c) => !c)}
            onLock={() => change(sel.id, { locked: !sel.locked })}
            onHide={() => {
              change(sel.id, { hidden: true });
              setSelected(null);
            }}
            onRemove={() => remove(sel.id)}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <PrimaryButton onClick={() => setPicking(true)}>{t("canvas.addPiece")}</PrimaryButton>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("canvas.background")}>
              {SWATCHES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => apply({ ...doc, background: s.hex })}
                  aria-label={s.name}
                  aria-pressed={doc.background.toLowerCase() === s.hex.toLowerCase()}
                  className={`size-12 rounded-pill border-2 ${doc.background.toLowerCase() === s.hex.toLowerCase() ? "border-ink" : "border-line"}`}
                  style={{ backgroundColor: s.hex }}
                />
              ))}
            </div>
            <label className="block">
              <span className="text-sm text-ink-soft">{t("builder.caption")}</span>
              <input
                type="text"
                maxLength={280}
                value={doc.caption}
                placeholder={t("builder.captionHint")}
                onChange={(e) => apply({ ...doc, caption: e.target.value })}
                className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
              />
            </label>
            <PrimaryButton
              disabled={doc.order.length === 0}
              onClick={() => void navigate({ to: "/set/$setId/send", params: { setId } })}
            >
              {t("canvas.send")}
            </PrimaryButton>
            <p className="hidden text-xs text-ink-soft md:block">{t("canvas.shortcuts")}</p>
          </div>
        )}
      </div>

      <ItemPicker open={picking} onOpenChange={setPicking} onPick={(item) => void addPiece(item)} />
      <LayersPanel
        open={layersOpen}
        onOpenChange={setLayersOpen}
        doc={doc}
        items={items}
        selected={selected}
        onSelect={(id) => {
          setSelected(id);
          setLayersOpen(false);
        }}
        onOrder={(id, move: OrderMove) => apply(reorder(doc, id, move))}
        onToggleHidden={(id) => change(id, { hidden: !doc.layers[id]?.hidden })}
        onToggleLocked={(id) => change(id, { locked: !doc.layers[id]?.locked })}
      />
    </div>
  );
}
