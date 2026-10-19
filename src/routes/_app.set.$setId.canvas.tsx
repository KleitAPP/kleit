import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type Konva from "konva";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BACKGROUND_KEY,
  CanvasStage,
  imageKey,
  type Families,
  type Images,
} from "@/canvas/CanvasStage";
import {
  addAssetLayer,
  addLayer,
  addTextLayer,
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
  setFreeHeight,
  setShape,
  FREE_HEIGHT,
  undo,
  updateLayer,
  type CanvasShape,
  type Doc,
  type History,
  type OrderMove,
} from "@/canvas/doc";
import {
  DEFAULT_TEXT_COLOUR,
  LayersPanel,
  PanelButton,
  SelectedPanel,
  TEXT_COLOURS,
  TextPanel,
  layerName,
} from "@/canvas/panels";
import { CanvasMirror, useAnnouncer } from "@/canvas/mirror";
import { FONTS } from "@/fonts/catalogue";
import { loadFont } from "@/fonts/load";
import { myFonts, type MyFont } from "@/fonts/myFonts";
import { addRow, loadDoc, loadImage, loadLibraryImage, saveDiff } from "@/canvas/persist";
import { LibraryDrawer } from "@/library/LibraryDrawer";
import { loadCatalogue, type Catalogue, type LibraryAsset } from "@/library/library";
import { Chip, EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import { lastSaveProblem } from "@/sets/sets";
import type { ItemSummary } from "@/items/items";
import { ItemPicker } from "@/sets/ItemPicker";
import { SWATCHES } from "@/sets/swatches";
import { COLOUR_SWATCHES, isColourName } from "@/items/colour";
import {
  download,
  exportCarousel,
  exportSet,
  exportStory,
  type ExportFormat,
  type ExportSize,
} from "@/canvas/exportSet";

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
  const [families, setFamilies] = useState<Families>({});
  const [advanced, setAdvanced] = useState(false);
  const [mine, setMine] = useState<MyFont[]>([]);
  useEffect(() => {
    void myFonts().then(setMine);
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  // The screen reader's half of the canvas (spec 21 #2): the hidden layer list and one live region.
  const announcer = useAnnouncer();
  const stageWrap = useRef<HTMLDivElement | null>(null);
  const [cropping, setCropping] = useState(false);
  const [picking, setPicking] = useState(false);
  const [library, setLibrary] = useState<"assets" | "backgrounds" | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // The background hex field while it is being typed; null shows the canvas's own colour.
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  // Ctrl+C holds the id of the copied piece; Ctrl+V duplicates it (spec 6.1 #23).
  const clipboardRef = useRef<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [exportSize, setExportSize] = useState<ExportSize>(1080);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProblem, setExportProblem] = useState(false);
  const [title, setTitle] = useState("");
  const [missing, setMissing] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed" | "refused">("saved");
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
      setTitle(loaded.title);
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
      } else if (lastSaveProblem.code === "P0006") {
        // The caption carries a phone number or an address (spec 13.2 #4): no retry, say why.
        setSaveState("refused");
      } else {
        setSaveState("failed");
        saveTimer.current = window.setTimeout(attempt, 4000);
      }
    }, 400);
  }, [doc, setId]);

  // Every decoration and the background picture the document uses, loaded once from /library/.
  // The catalogue maps an id to its file; it is only fetched when a set actually has one.
  useEffect(() => {
    if (!doc) return;
    const wanted = Object.values(doc.layers)
      .filter((l) => l.kind === "asset" && l.asset)
      .map((l) => ({ key: imageKey(l), id: l.asset!, colour: l.colour }));
    if (doc.backgroundAsset)
      wanted.push({ key: BACKGROUND_KEY, id: doc.backgroundAsset, colour: undefined });
    const missing = wanted.filter(({ key }) => images[key] === undefined);
    if (!missing.length) return;
    let cancelled = false;
    void loadCatalogue().then(async (cat) => {
      setCatalogue(cat);
      for (const { key, id, colour } of missing) {
        const entry = key === BACKGROUND_KEY ? cat.backgrounds[id] : cat.assets[id];
        const img = entry ? await loadLibraryImage(entry.file, colour) : null;
        if (!cancelled) setImages((m) => (m[key] === undefined ? { ...m, [key]: img } : m));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc, images]);
  // The background picture changes with the document; drop the old one so the new one loads.
  useEffect(() => {
    setImages((m) => {
      if (m[BACKGROUND_KEY] === undefined) return m;
      const { [BACKGROUND_KEY]: _old, ...rest } = m;
      return rest;
    });
  }, [doc?.backgroundAsset]);

  // Every font the document uses, loaded once; the stage draws with a fallback until then.
  useEffect(() => {
    if (!doc) return;
    for (const l of Object.values(doc.layers)) {
      const id = l.kind === "text" ? l.text?.font : undefined;
      if (!id || families[id] !== undefined) continue;
      void loadFont(id).then((family) => {
        if (family) setFamilies((f) => ({ ...f, [id]: family }));
      });
    }
  }, [doc, families]);

  const apply = useCallback((next: Doc) => {
    setHistory((h) => (h ? commit(h, next) : h));
  }, []);

  /** Decoration titles by catalogue id, for the layer names the sheet, the mirror and the announcements share. */
  function decorNamesOf(d: Doc): Record<string, string> {
    const names: Record<string, string> = {};
    if (catalogue)
      for (const l of Object.values(d.layers))
        if (l.kind === "asset" && l.asset && catalogue.assets[l.asset])
          names[l.asset] = catalogue.assets[l.asset]!.title;
    return names;
  }

  const sel = selected && doc ? doc.layers[selected] : null;

  // Spec 6.1 #22, "colours from this set": the named colour of every piece on the canvas, once each.
  const setColours: Array<{ hex: string; name: string }> = [];
  if (doc) {
    const seen = new Set<string>();
    for (const id of doc.order) {
      const l = doc.layers[id];
      const item = l?.kind === "item" && l.itemId ? items[l.itemId] : null;
      const name = item?.color_name;
      if (name && isColourName(name) && !seen.has(name)) {
        seen.add(name);
        setColours.push({ hex: COLOUR_SWATCHES[name], name });
      }
    }
  }
  const eyedropperAvailable = typeof window !== "undefined" && "EyeDropper" in window;
  async function pickFromScreen(onColour: (hex: string) => void) {
    try {
      const Dropper = (
        window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }
      ).EyeDropper;
      if (!Dropper) return;
      const r = await new Dropper().open();
      if (/^#[0-9a-fA-F]{6}$/.test(r.sRGBHex)) onColour(r.sRGBHex);
    } catch {
      /* the person pressed Escape */
    }
  }

  function sizeTo(widthPx: number) {
    if (!doc || !sel) return;
    const w = Math.max(24, widthPx);
    const h = Math.max(24, Math.round((sel.h / sel.w) * w));
    change(sel.id, {
      w,
      h,
      x: Math.round(sel.x + (sel.w - w) / 2),
      y: Math.round(sel.y + (sel.h - h) / 2),
    });
  }

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
      // The row is already on the server, so the saved baseline carries its position (not its place in
      // the order: that is the layout's, and the layout still has to be written).
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

  function addDecoration(id: string, asset: LibraryAsset) {
    if (!doc) return;
    setLibrary(null);
    if (doc.order.length >= LAYER_CAP) {
      setNotice(t("canvas.capReached", { cap: LAYER_CAP }));
      return;
    }
    const layerId = `decor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const added = addAssetLayer(
      doc,
      layerId,
      id,
      { w: asset.w, h: asset.h },
      asset.kind === "structural" ? DEFAULT_TEXT_COLOUR : undefined,
    );
    if (!added.ok) return;
    apply(added.doc);
    setSelected(layerId);
    if (doc.order.length + 1 >= LAYER_WARNING)
      setNotice(
        t("canvas.capWarning", {
          count: doc.order.length + 1,
          cap: LAYER_CAP,
          warn: LAYER_WARNING,
        }),
      );
  }

  async function duplicate(fromId?: string) {
    if (!doc) return;
    const from = fromId ? doc.layers[fromId] : sel;
    if (!from) return;
    if (doc.order.length >= LAYER_CAP) {
      setNotice(t("canvas.capReached", { cap: LAYER_CAP }));
      return;
    }
    if (from.kind !== "item") {
      // Words and decorations live in the layout: a copy needs no row, only an id of its own.
      const copyId = `${from.kind === "text" ? "text" : "decor"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const cloned = cloneLayer(doc, from.id, copyId);
      if (!cloned.ok) return;
      apply(cloned.doc);
      setSelected(copyId);
      return;
    }
    const probe = cloneLayer(doc, from.id, "probe");
    if (!probe.ok) return;
    const copy = probe.doc.layers["probe"]!;
    const { id: _id, itemId: _itemId, ...position } = copy;
    const rowId = await addRow(setId, from.itemId, position);
    if (!rowId) {
      setSaveState("failed");
      return;
    }
    setHistory((h) => {
      if (!h) return h;
      const cloned = cloneLayer(h.present, from.id, rowId);
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

  function addText() {
    if (!doc) return;
    if (doc.order.length >= LAYER_CAP) {
      setNotice(t("canvas.capReached", { cap: LAYER_CAP }));
      return;
    }
    const id = `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const added = addTextLayer(doc, id, {
      text: t("text.default"),
      font: "playfair",
      size: 96,
      colour: DEFAULT_TEXT_COLOUR,
      align: "center",
      back: "scrim",
    });
    if (!added.ok) return;
    apply(added.doc);
    setSelected(id);
  }

  function remove(id: string) {
    if (!doc) return;
    const gone = doc.layers[id];
    if (gone)
      announcer.say(
        t("mirror.removed", {
          name: layerName(gone, items, doc.order.indexOf(id), decorNamesOf(doc)),
        }),
      );
    apply(removeLayer(doc, id));
    if (selected === id) setSelected(null);
  }

  async function runExport(make: () => Promise<{ blob: Blob; filename: string }>) {
    if (!stageRef.current) return;
    setExportBusy(true);
    setExportProblem(false);
    try {
      download(await make());
    } catch {
      setExportProblem(true);
    } finally {
      setExportBusy(false);
    }
  }

  // Web keyboard shortcuts (spec 6.1 #23).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      // A key pressed with a sheet open (the picker, the library, the layers, export, help) is the
      // sheet's, not the canvas's: L must not lock a hidden piece, Delete must not remove one.
      if (
        picking ||
        library ||
        layersOpen ||
        helpOpen ||
        exporting ||
        target?.closest("[role=dialog]")
      )
        return;
      // Holding a key down is one press for the actions that add rows.
      if (e.repeat && ["c", "v", "d"].includes(e.key.toLowerCase())) return;
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
      } else if (mod && e.key.toLowerCase() === "c" && sel) {
        e.preventDefault();
        clipboardRef.current = sel.id;
      } else if (
        mod &&
        e.key.toLowerCase() === "v" &&
        clipboardRef.current &&
        doc?.layers[clipboardRef.current]
      ) {
        e.preventDefault();
        setSelected(clipboardRef.current);
        // The copy lands a step down and right of the original, as a paste does everywhere else.
        void duplicate(clipboardRef.current);
      } else if (!mod && e.key.toLowerCase() === "l" && sel) {
        e.preventDefault();
        announcer.say(t(sel.locked ? "mirror.unlocked" : "mirror.locked"));
        change(sel.id, { locked: !sel.locked });
      } else if (e.key === "?" && !mod) {
        e.preventDefault();
        setHelpOpen(true);
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        e.preventDefault();
        remove(sel.id);
      } else if (e.key.startsWith("Arrow") && sel && !sel.locked && doc) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 10;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        announcer.move(dx, dy);
        apply(updateLayer(doc, sel.id, { x: sel.x + dx, y: sel.y + dy }));
      } else if ((e.key === "]" || e.key === "[") && sel && doc) {
        e.preventDefault();
        announcer.say(t(e.key === "]" ? "mirror.forward" : "mirror.back"));
        apply(reorder(doc, sel.id, e.key === "]" ? "forward" : "back"));
      } else if (e.key === "Escape") {
        setSelected(null);
        setCropping(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, doc, picking, library, layersOpen, helpOpen, exporting]);

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
  const imgFor = sel ? images[imageKey(sel)] : null;
  const decorNames = decorNamesOf(doc);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-3 pb-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-xl text-ink">{t("canvas.title")}</h1>
        <p className="text-sm text-ink-soft" role="status">
          {saveState === "saved"
            ? t("canvas.saved")
            : saveState === "saving"
              ? t("canvas.saving")
              : saveState === "refused"
                ? t("screen.noContact")
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
        <Chip
          label={t("canvas.shape.free")}
          selected={doc.canvas.shape === "free"}
          onToggle={() => apply(setFreeHeight(doc, doc.canvas.h))}
        />
        <PanelButton label={t("canvas.help")} onPress={() => setHelpOpen(true)} />
      </div>
      {doc.canvas.shape === "free" ? (
        <label className="mt-2 flex items-center gap-3 text-sm text-ink">
          <span className="shrink-0">{t("canvas.freeHeight")}</span>
          <input
            type="range"
            min={FREE_HEIGHT.min}
            max={FREE_HEIGHT.max}
            step={10}
            value={doc.canvas.h}
            onChange={(e) => apply(setFreeHeight(doc, Number(e.target.value)))}
            aria-label={t("canvas.freeHeight")}
            className="w-full accent-brand"
          />
          <span className="w-16 text-right tabular-nums text-ink-soft">
            {doc.canvas.w}×{doc.canvas.h}
          </span>
        </label>
      ) : null}

      <div
        ref={stageWrap}
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
            if (id && id !== selected) {
              const l = doc.layers[id];
              if (l)
                announcer.say(
                  t("mirror.selected", {
                    name: layerName(l, items, doc.order.indexOf(id), decorNames),
                  }),
                );
            }
            setSelected(id);
            if (id !== selected) setCropping(false);
          }}
          families={families}
          onChange={change}
          onCrop={(id, crop) => change(id, { crop })}
          onMeasure={(id, h) => {
            // Not an undo step: the words did not change, only the box that holds them.
            setHistory((hist) =>
              hist ? { ...hist, present: updateLayer(hist.present, id, { h }) } : hist,
            );
          }}
        />
      </div>
      <CanvasMirror
        doc={doc}
        items={items}
        decorNames={decorNames}
        selected={selected}
        onSelect={(id) => {
          setSelected(id);
          if (id !== selected) setCropping(false);
        }}
        stage={stageWrap}
      />
      {announcer.region}
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
        {sel?.kind === "text" && sel.text ? (
          <div className="mb-3">
            <TextPanel
              style={sel.text}
              fonts={[
                ...FONTS.map((f) => ({ id: f.id, name: f.name })),
                ...mine.map((f) => ({ id: f.id, name: `${f.name} (${t("text.myFonts")})` })),
              ]}
              onChange={(next) => change(sel.id, { text: next })}
              onAdvanced={() => setAdvanced((a) => !a)}
            />
            {advanced ? (
              <ColourExtras
                colours={setColours}
                current={sel.text.colour}
                eyedropper={eyedropperAvailable}
                onPick={(hex) => change(sel.id, { text: { ...sel.text!, colour: hex } })}
                onEyedropper={() =>
                  void pickFromScreen((hex) =>
                    change(sel.id, { text: { ...sel.text!, colour: hex } }),
                  )
                }
              />
            ) : null}
            {advanced ? (
              <label className="mt-2 block">
                <span className="text-sm text-ink-soft">{t("text.hex")}</span>
                <input
                  type="text"
                  value={sel.text.colour}
                  maxLength={7}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{6}$/.test(v))
                      change(sel.id, { text: { ...sel.text!, colour: v } });
                  }}
                  className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
                />
              </label>
            ) : null}
          </div>
        ) : null}
        {sel?.kind === "asset" && sel.colour ? (
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t("text.colour")}>
            {TEXT_COLOURS.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => change(sel.id, { colour: c.hex })}
                aria-label={c.name}
                aria-pressed={sel.colour!.toLowerCase() === c.hex.toLowerCase()}
                className={`size-12 rounded-pill border-2 ${sel.colour!.toLowerCase() === c.hex.toLowerCase() ? "border-ink" : "border-line"}`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
            <ColourExtras
              colours={setColours}
              current={sel.colour}
              eyedropper={eyedropperAvailable}
              onPick={(hex) => change(sel.id, { colour: hex })}
              onEyedropper={() => void pickFromScreen((hex) => change(sel.id, { colour: hex }))}
            />
          </div>
        ) : null}
        {sel ? (
          <SelectedPanel
            layer={sel}
            cropping={cropping}
            canMoveUp={index < doc.order.length - 1}
            canMoveDown={index > 0}
            canvasWidth={doc.canvas.w}
            onSizeTo={sizeTo}
            onNudge={(dx, dy) => {
              announcer.move(dx, dy);
              change(sel.id, { x: sel.x + dx, y: sel.y + dy });
            }}
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
            onRotate={(deg) => {
              announcer.say(t("mirror.rotated", { deg: (sel.rotation + deg + 360) % 360 }));
              change(sel.id, { rotation: (sel.rotation + deg + 360) % 360 });
            }}
            onFlip={(axis) => {
              announcer.say(t("mirror.flipped"));
              apply(flip(doc, sel.id, axis));
            }}
            onOrder={(move) => {
              announcer.say(t(move === "forward" ? "mirror.forward" : "mirror.back"));
              apply(reorder(doc, sel.id, move));
            }}
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
            onLock={() => {
              announcer.say(t(sel.locked ? "mirror.unlocked" : "mirror.locked"));
              change(sel.id, { locked: !sel.locked });
            }}
            onHide={() => {
              change(sel.id, { hidden: true });
              setSelected(null);
            }}
            onRemove={() => remove(sel.id)}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <PrimaryButton onClick={() => setPicking(true)}>{t("canvas.addPiece")}</PrimaryButton>
            <PanelButton label={t("canvas.addDecoration")} onPress={() => setLibrary("assets")} />
            <PanelButton label={t("canvas.addText")} onPress={addText} />
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("canvas.background")}>
              {doc.backgroundAsset ? (
                <Chip
                  label={t("canvas.plainColour")}
                  onToggle={() => apply({ ...doc, backgroundAsset: null })}
                />
              ) : null}
              <PanelButton
                label={t("canvas.moreBackgrounds")}
                onPress={() => setLibrary("backgrounds")}
              />
              {SWATCHES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => apply({ ...doc, background: s.hex, backgroundAsset: null })}
                  aria-label={s.name}
                  aria-pressed={doc.background.toLowerCase() === s.hex.toLowerCase()}
                  className={`size-12 rounded-pill border-2 ${doc.background.toLowerCase() === s.hex.toLowerCase() ? "border-ink" : "border-line"}`}
                  style={{ backgroundColor: s.hex }}
                />
              ))}
              <ColourExtras
                colours={setColours}
                current={doc.background}
                eyedropper={eyedropperAvailable}
                onPick={(hex) => apply({ ...doc, background: hex, backgroundAsset: null })}
                onEyedropper={() =>
                  void pickFromScreen((hex) =>
                    apply({ ...doc, background: hex, backgroundAsset: null }),
                  )
                }
              />
            </div>
            <label className="block">
              <span className="text-sm text-ink-soft">{t("canvas.backgroundHex")}</span>
              <input
                type="text"
                value={hexDraft ?? doc.background}
                maxLength={7}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setHexDraft(v);
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                    apply({ ...doc, background: v, backgroundAsset: null });
                    setHexDraft(null);
                  }
                }}
                onBlur={() => setHexDraft(null)}
                className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
              />
            </label>
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
            <PanelButton
              label={t("export.open")}
              disabled={doc.order.length === 0}
              onPress={() => {
                setSelected(null);
                setExporting(true);
              }}
            />
            <p className="hidden text-xs text-ink-soft md:block">{t("canvas.shortcuts")}</p>
          </div>
        )}
      </div>

      <ItemPicker open={picking} onOpenChange={setPicking} onPick={(item) => void addPiece(item)} />
      <LibraryDrawer
        open={library !== null}
        mode={library ?? "assets"}
        onOpenChange={(o) => !o && setLibrary(null)}
        onPick={(id, asset) => {
          if (library === "backgrounds") {
            setLibrary(null);
            apply({ ...doc, backgroundAsset: id });
          } else addDecoration(id, asset);
        }}
      />
      <Sheet open={helpOpen} onOpenChange={setHelpOpen} title={t("canvas.helpTitle")}>
        <p className="text-base text-ink">{t("canvas.helpList")}</p>
      </Sheet>
      <Sheet
        open={exporting}
        onOpenChange={setExporting}
        title={t("export.title")}
        description={t("export.note")}
        action={
          <PrimaryButton
            disabled={exportBusy}
            onClick={() =>
              void runExport(() =>
                exportSet(
                  stageRef.current!,
                  doc,
                  exportFormat,
                  exportSize,
                  title || t("canvas.title"),
                ),
              )
            }
          >
            {exportBusy ? t("export.working") : t("export.go")}
          </PrimaryButton>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("export.format")}>
            {(
              [
                ["png", t("export.png")],
                ["jpg", t("export.jpg")],
                ["png-transparent", t("export.transparent")],
              ] as const
            ).map(([f, label]) => (
              <Chip
                key={f}
                label={label}
                selected={exportFormat === f}
                onToggle={() => setExportFormat(f)}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("export.size")}>
            <Chip
              label={t("export.size1080")}
              selected={exportSize === 1080}
              onToggle={() => setExportSize(1080)}
            />
            <Chip
              label={t("export.size2160")}
              selected={exportSize === 2160}
              onToggle={() => setExportSize(2160)}
            />
          </div>
          <PanelButton
            label={t("export.story")}
            disabled={exportBusy}
            onPress={() =>
              void runExport(() => exportStory(stageRef.current!, doc, title || t("canvas.title")))
            }
          />
          <PanelButton
            label={t("export.carousel")}
            disabled={exportBusy}
            onPress={() =>
              void runExport(() =>
                exportCarousel(stageRef.current!, doc, images, title || t("canvas.title")),
              )
            }
          />
          {exportProblem ? (
            <p role="alert" className="text-sm text-danger">
              {t("export.failed")}
            </p>
          ) : null}
        </div>
      </Sheet>
      <LayersPanel
        open={layersOpen}
        onOpenChange={setLayersOpen}
        doc={doc}
        items={items}
        decorNames={decorNames}
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

/**
 * Spec 6.1 #22: "colours from this set" (the named colour of each piece on the canvas) and the
 * browser's own eyedropper where it exists (Chrome and Edge on a computer; nowhere on iPhone yet).
 * Shown for words, one-colour decorations and the background alike.
 */
function ColourExtras({
  colours,
  current,
  eyedropper,
  onPick,
  onEyedropper,
}: {
  colours: Array<{ hex: string; name: string }>;
  current: string | null | undefined;
  eyedropper: boolean;
  onPick: (hex: string) => void;
  onEyedropper: () => void;
}) {
  if (colours.length === 0 && !eyedropper) return null;
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2"
      role="group"
      aria-label={t("canvas.coloursFromSet")}
    >
      {colours.length > 0 ? (
        <span className="text-sm text-ink-soft">{t("canvas.coloursFromSet")}</span>
      ) : null}
      {colours.map((c) => (
        <button
          key={c.hex}
          type="button"
          onClick={() => onPick(c.hex)}
          aria-label={c.name}
          aria-pressed={(current ?? "").toLowerCase() === c.hex.toLowerCase()}
          className={`size-12 rounded-pill border-2 ${(current ?? "").toLowerCase() === c.hex.toLowerCase() ? "border-ink" : "border-line"}`}
          style={{ backgroundColor: c.hex }}
        />
      ))}
      {eyedropper ? <PanelButton label={t("canvas.eyedropper")} onPress={onEyedropper} /> : null}
    </div>
  );
}
