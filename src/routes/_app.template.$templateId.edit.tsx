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
  addSlotLayer,
  addTextLayer,
  cloneLayer,
  commit,
  flip,
  historyOf,
  LAYER_CAP,
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
import {
  DEFAULT_TEXT_COLOUR,
  LayersPanel,
  PanelButton,
  SelectedPanel,
  TEXT_COLOURS,
  TextPanel,
} from "@/canvas/panels";
import { loadLibraryImage } from "@/canvas/persist";
import { Chip, EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { FONTS } from "@/fonts/catalogue";
import { loadFont } from "@/fonts/load";
import { myFonts, type MyFont } from "@/fonts/myFonts";
import { t } from "@/i18n/en";
import { LibraryDrawer } from "@/library/LibraryDrawer";
import { loadCatalogue, type Catalogue, type LibraryAsset } from "@/library/library";
import { SWATCHES } from "@/sets/swatches";
import { deleteTemplate, loadTemplate, saveTemplate } from "@/templates/templates";

/**
 * The template maker (roadmap M4.5; spec 6.4 #2–3): the Creative canvas with empty slots
 * instead of pieces. Slots are dashed boxes numbered in the order they fill; overlapping slots
 * make a stacked template. The background, decorations and words are saved with it and arrive
 * in every set made from it. Publish = anyone signed in can pick it from the builder's row.
 */
export const Route = createFileRoute("/_app/template/$templateId/edit")({
  head: () => ({
    meta: [{ title: "Template" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: TemplateMaker,
});

const SHAPES: ReadonlyArray<Exclude<CanvasShape, "free">> = ["square", "portrait", "story"];

function TemplateMaker() {
  const { templateId } = Route.useParams();
  const navigate = useNavigate();
  const [history, setHistory] = useState<History | null>(null);
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [mine, setMine] = useState(true);
  const [images, setImages] = useState<Images>({});
  const [families, setFamilies] = useState<Families>({});
  const [fonts, setFonts] = useState<MyFont[]>([]);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [library, setLibrary] = useState<"assets" | "backgrounds" | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const [notice, setNotice] = useState<string | null>(null);
  const [scale, setScale] = useState(0.3);
  const stageRef = useRef<Konva.Stage>(null);
  const lastSaved = useRef<{ doc: Doc; name: string; isPublic: boolean } | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    void myFonts().then(setFonts);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadTemplate(templateId).then((loaded) => {
      if (cancelled) return;
      if (!loaded || !loaded.mine) {
        setMissing(true);
        return;
      }
      setName(loaded.name);
      setIsPublic(loaded.isPublic);
      setMine(loaded.mine);
      setHistory(historyOf(loaded.doc));
      lastSaved.current = { doc: loaded.doc, name: loaded.name, isPublic: loaded.isPublic };
    });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

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

  // Autosave the whole row 500 ms after the last change (a template is one row).
  useEffect(() => {
    if (!doc || !lastSaved.current) return;
    const last = lastSaved.current;
    if (last.doc === doc && last.name === name && last.isPublic === isPublic) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async function attempt() {
      setSaveState("saving");
      const ok = await saveTemplate(templateId, doc, name, isPublic);
      if (ok) {
        lastSaved.current = { doc, name, isPublic };
        setSaveState("saved");
      } else {
        setSaveState("failed");
        saveTimer.current = window.setTimeout(attempt, 4000);
      }
    }, 500);
  }, [doc, name, isPublic, templateId]);

  // Library pictures and fonts the template uses.
  useEffect(() => {
    if (!doc) return;
    const wanted = Object.values(doc.layers)
      .filter((l) => l.kind === "asset" && l.asset)
      .map((l) => ({ key: imageKey(l), id: l.asset!, colour: l.colour }));
    if (doc.backgroundAsset)
      wanted.push({ key: BACKGROUND_KEY, id: doc.backgroundAsset, colour: undefined });
    const need = wanted.filter(({ key }) => images[key] === undefined);
    if (!need.length) return;
    let cancelled = false;
    void loadCatalogue().then(async (cat) => {
      setCatalogue(cat);
      for (const { key, id, colour } of need) {
        const entry = key === BACKGROUND_KEY ? cat.backgrounds[id] : cat.assets[id];
        const img = entry ? await loadLibraryImage(entry.file, colour) : null;
        if (!cancelled) setImages((m) => (m[key] === undefined ? { ...m, [key]: img } : m));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc, images]);
  useEffect(() => {
    setImages((m) => {
      if (m[BACKGROUND_KEY] === undefined) return m;
      const { [BACKGROUND_KEY]: _old, ...rest } = m;
      return rest;
    });
  }, [doc?.backgroundAsset]);
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
  const sel = selected && doc ? doc.layers[selected] : null;
  function change(id: string, patch: Partial<Doc["layers"][string]>) {
    if (doc) apply(updateLayer(doc, id, patch));
  }
  const newId = (kind: string) =>
    `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function addSlot() {
    if (!doc) return;
    if (doc.order.length >= LAYER_CAP) return setNotice(t("canvas.capReached", { cap: LAYER_CAP }));
    const id = newId("slot");
    const added = addSlotLayer(doc, id);
    if (added.ok) {
      apply(added.doc);
      setSelected(id);
    }
  }
  function addText() {
    if (!doc) return;
    const id = newId("text");
    const added = addTextLayer(doc, id, {
      text: t("text.default"),
      font: "playfair",
      size: 96,
      colour: DEFAULT_TEXT_COLOUR,
      align: "center",
      back: "scrim",
    });
    if (added.ok) {
      apply(added.doc);
      setSelected(id);
    }
  }
  function addDecoration(assetId: string, asset: LibraryAsset) {
    if (!doc) return;
    setLibrary(null);
    const id = newId("decor");
    const added = addAssetLayer(
      doc,
      id,
      assetId,
      { w: asset.w, h: asset.h },
      asset.kind === "structural" ? DEFAULT_TEXT_COLOUR : undefined,
    );
    if (added.ok) {
      apply(added.doc);
      setSelected(id);
    }
  }
  function duplicate() {
    if (!doc || !sel) return;
    const id = newId(sel.kind);
    const cloned = cloneLayer(doc, sel.id, id);
    if (cloned.ok) {
      apply(cloned.doc);
      setSelected(id);
    }
  }
  function remove(id: string) {
    if (!doc) return;
    apply(removeLayer(doc, id));
    if (selected === id) setSelected(null);
  }

  if (missing) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("template.notFound")} />
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

  const slotCount = doc.order.filter((id) => doc.layers[id]?.kind === "slot").length;
  const index = sel ? doc.order.indexOf(sel.id) : -1;
  const imgFor = sel ? images[imageKey(sel)] : null;
  const decorNames: Record<string, string> = {};
  if (catalogue)
    for (const l of Object.values(doc.layers))
      if (l.kind === "asset" && l.asset && catalogue.assets[l.asset])
        decorNames[l.asset] = catalogue.assets[l.asset]!.title;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-3 pb-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-xl text-ink">{t("template.title")}</h1>
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
          cropping={false}
          scale={scale}
          stageRef={stageRef}
          onSelect={setSelected}
          families={families}
          onChange={change}
          onCrop={() => undefined}
          onMeasure={(id, h) =>
            setHistory((hist) =>
              hist ? { ...hist, present: updateLayer(hist.present, id, { h }) } : hist,
            )
          }
        />
      </div>
      {slotCount === 0 ? <p className="mt-2 text-sm text-ink-soft">{t("template.empty")}</p> : null}
      {notice ? (
        <p
          role="status"
          className="mt-2 rounded-md border border-line bg-surface p-2 text-sm text-ink"
        >
          {notice}
        </p>
      ) : null}

      <div className="mt-3">
        {sel?.kind === "text" && sel.text ? (
          <div className="mb-3">
            <TextPanel
              style={sel.text}
              fonts={[
                ...FONTS.map((f) => ({ id: f.id, name: f.name })),
                ...fonts.map((f) => ({ id: f.id, name: `${f.name} (${t("text.myFonts")})` })),
              ]}
              onChange={(next) => change(sel.id, { text: next })}
              onAdvanced={() => undefined}
            />
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
          </div>
        ) : null}
        {sel ? (
          <SelectedPanel
            layer={sel}
            cropping={false}
            canMoveUp={index < doc.order.length - 1}
            canMoveDown={index > 0}
            canvasWidth={doc.canvas.w}
            onSizeTo={(widthPx) => {
              const w = Math.max(24, widthPx);
              const h = Math.max(24, Math.round((sel.h / sel.w) * w));
              change(sel.id, {
                w,
                h,
                x: Math.round(sel.x + (sel.w - w) / 2),
                y: Math.round(sel.y + (sel.h - h) / 2),
              });
            }}
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
            onDuplicate={duplicate}
            onOpacity={(value) => change(sel.id, { opacity: value })}
            onFit={() =>
              imgFor
                ? change(sel.id, {
                    h: Math.round((sel.w * imgFor.naturalHeight) / imgFor.naturalWidth),
                  })
                : undefined
            }
            onCrop={() => undefined}
            onLock={() => change(sel.id, { locked: !sel.locked })}
            onHide={() => {
              change(sel.id, { hidden: true });
              setSelected(null);
            }}
            onRemove={() => remove(sel.id)}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <PrimaryButton onClick={addSlot}>{t("canvas.addSlot")}</PrimaryButton>
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
            </div>
            <label className="block">
              <span className="text-sm text-ink-soft">{t("template.name")}</span>
              <input
                type="text"
                maxLength={60}
                value={name}
                placeholder={t("template.nameHint")}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
              />
            </label>
            <div className="flex gap-2" role="group" aria-label={t("template.public")}>
              <Chip
                label={t("template.private")}
                selected={!isPublic}
                onToggle={() => setIsPublic(false)}
              />
              <Chip
                label={t("template.public")}
                selected={isPublic}
                onToggle={() => {
                  if (slotCount === 0) setNotice(t("template.needSlot"));
                  else setIsPublic(true);
                }}
              />
            </div>
            <PanelButton
              label={t("template.delete")}
              danger
              onPress={() => setConfirmDelete(true)}
            />
          </div>
        )}
      </div>

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
      <LayersPanel
        open={layersOpen}
        onOpenChange={setLayersOpen}
        doc={doc}
        items={{}}
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
      <Sheet
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("template.delete")}
        description={t("template.deleteWarn")}
        action={
          <PrimaryButton
            onClick={() => {
              void deleteTemplate(templateId).then((ok) => {
                if (ok) void navigate({ to: "/you/templates" });
              });
            }}
          >
            {t("template.delete")}
          </PrimaryButton>
        }
      />
    </div>
  );
}
