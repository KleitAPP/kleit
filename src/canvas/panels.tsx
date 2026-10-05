import { Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import type { ItemSummary } from "@/items/items";

import type { Doc, Layer, OrderMove, TextStyle } from "@/canvas/doc";

/** A panel button: 48 dp, label always visible (never an icon alone). */
export function PanelButton({
  label,
  onPress,
  disabled,
  pressed,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  pressed?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-pressed={pressed}
      className={`min-h-12 shrink-0 rounded-pill border px-3 text-sm font-medium disabled:opacity-40 ${
        pressed
          ? "border-ink bg-ink text-canvas"
          : danger
            ? "border-line bg-surface text-danger"
            : "border-line bg-surface text-ink"
      }`}
    >
      {label}
    </button>
  );
}

export function layerName(
  layer: Layer,
  items: Record<string, ItemSummary>,
  index: number,
  decorNames: Record<string, string> = {},
): string {
  if (layer.kind === "slot") {
    return t("layers.name", { n: index + 1, name: t("template.slotName") });
  }
  if (layer.kind === "asset" && layer.asset)
    return t("layers.name", { n: index + 1, name: decorNames[layer.asset] ?? t("library.title") });
  if (layer.kind === "text" && layer.text)
    return t("layers.name", {
      n: index + 1,
      name: t("layers.text", { words: layer.text.text.slice(0, 40) }),
    });
  const item = items[layer.itemId];
  const name =
    item?.title?.trim() || (item?.kind === "own" ? t("item.yourPiece") : t("item.untitled"));
  const store = item?.store_name?.trim() || item?.source_domain || "";
  return t("layers.name", { n: index + 1, name: store ? `${name}, ${store}` : name });
}

/**
 * S61 — the selected-piece panel. Every canvas tool as a button, so nothing requires a drag
 * (spec 6.1 #24; design pack 8.3 #7). Lives in the thumb zone.
 */
export function SelectedPanel({
  layer,
  canMoveUp,
  canMoveDown,
  cropping,
  onNudge,
  onSize,
  onRotate,
  onFlip,
  onOrder,
  onDuplicate,
  onOpacity,
  onFit,
  onCrop,
  onLock,
  onHide,
  onRemove,
}: {
  layer: Layer;
  canMoveUp: boolean;
  canMoveDown: boolean;
  cropping: boolean;
  onNudge: (dx: number, dy: number) => void;
  onSize: (factor: number) => void;
  onRotate: (deg: number) => void;
  onFlip: (axis: "x" | "y") => void;
  onOrder: (move: OrderMove) => void;
  onDuplicate: () => void;
  onOpacity: (value: number) => void;
  onFit: () => void;
  onCrop: () => void;
  onLock: () => void;
  onHide: () => void;
  onRemove: () => void;
}) {
  const locked = layer.locked;
  return (
    <div className="flex flex-col gap-2" aria-label={t("panel.title")}>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t("panel.move")}>
        <PanelButton label={t("panel.left")} onPress={() => onNudge(-10, 0)} disabled={locked} />
        <PanelButton label={t("panel.right")} onPress={() => onNudge(10, 0)} disabled={locked} />
        <PanelButton label={t("panel.up")} onPress={() => onNudge(0, -10)} disabled={locked} />
        <PanelButton label={t("panel.down")} onPress={() => onNudge(0, 10)} disabled={locked} />
        <PanelButton label={t("panel.smaller")} onPress={() => onSize(0.9)} disabled={locked} />
        <PanelButton label={t("panel.bigger")} onPress={() => onSize(1.1)} disabled={locked} />
        <PanelButton
          label={t("panel.rotateLeft")}
          onPress={() => onRotate(-15)}
          disabled={locked}
        />
        <PanelButton
          label={t("panel.rotateRight")}
          onPress={() => onRotate(15)}
          disabled={locked}
        />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t("panel.more")}>
        <PanelButton
          label={t("panel.flip")}
          onPress={() => onFlip("x")}
          disabled={locked}
          pressed={layer.flipX}
        />
        <PanelButton
          label={t("panel.flop")}
          onPress={() => onFlip("y")}
          disabled={locked}
          pressed={layer.flipY}
        />
        <PanelButton
          label={t("panel.forward")}
          onPress={() => onOrder("forward")}
          disabled={!canMoveUp}
        />
        <PanelButton
          label={t("panel.back")}
          onPress={() => onOrder("back")}
          disabled={!canMoveDown}
        />
        <PanelButton label={t("panel.duplicate")} onPress={onDuplicate} />
        <PanelButton label={t("panel.fit")} onPress={onFit} disabled={locked} />
        <PanelButton
          label={cropping ? t("panel.cropDone") : t("panel.crop")}
          onPress={onCrop}
          disabled={locked}
          pressed={cropping}
        />
        <PanelButton
          label={locked ? t("panel.unlock") : t("panel.lock")}
          onPress={onLock}
          pressed={locked}
        />
        <PanelButton label={t("panel.hide")} onPress={onHide} />
        <PanelButton label={t("panel.remove")} onPress={onRemove} danger />
      </div>
      <label className="flex items-center gap-3 text-sm text-ink">
        <span className="shrink-0">{t("panel.opacity")}</span>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round(layer.opacity * 100)}
          disabled={locked}
          onChange={(e) => onOpacity(Number(e.target.value) / 100)}
          aria-label={t("panel.opacity")}
          className="w-full accent-brand"
        />
        <span className="w-10 text-right tabular-nums text-ink-soft">
          {Math.round(layer.opacity * 100)}%
        </span>
      </label>
    </div>
  );
}

/**
 * S60 — the layers panel: the ordered list, top first, with hide and lock; also the screen-
 * reader path to the canvas ("Layer 2: black boots, Zara").
 */
export function LayersPanel({
  open,
  onOpenChange,
  doc,
  items,
  decorNames = {},
  selected,
  onSelect,
  onOrder,
  onToggleHidden,
  onToggleLocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: Doc;
  items: Record<string, ItemSummary>;
  /** Decoration titles by catalogue id, for the list's names. */
  decorNames?: Record<string, string>;
  selected: string | null;
  onSelect: (id: string) => void;
  onOrder: (id: string, move: OrderMove) => void;
  onToggleHidden: (id: string) => void;
  onToggleLocked: (id: string) => void;
}) {
  const topFirst = [...doc.order].reverse();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("layers.title")}
      description={t("layers.what", { count: doc.order.length })}
    >
      {topFirst.length === 0 ? (
        <p className="text-base text-ink-soft">{t("layers.empty")}</p>
      ) : (
        <ol className="divide-y divide-line" aria-label={t("layers.title")}>
          {topFirst.map((id, i) => {
            const layer = doc.layers[id];
            if (!layer) return null;
            const index = doc.order.indexOf(id);
            const name = layerName(layer, items, index, decorNames);
            return (
              <li key={id} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  onClick={() => onSelect(id)}
                  aria-pressed={selected === id}
                  className={`min-h-12 min-w-0 flex-1 truncate rounded-sm px-2 text-left text-base ${selected === id ? "bg-surface-2 text-ink" : "text-ink"}`}
                >
                  {name}
                  {layer.hidden ? ` · ${t("layers.hidden")}` : ""}
                  {layer.locked ? ` · ${t("layers.locked")}` : ""}
                </button>
                <PanelButton
                  label={t("panel.forward")}
                  onPress={() => onOrder(id, "forward")}
                  disabled={i === 0}
                />
                <PanelButton
                  label={t("panel.back")}
                  onPress={() => onOrder(id, "back")}
                  disabled={i === topFirst.length - 1}
                />
                <PanelButton
                  label={layer.hidden ? t("layers.show") : t("panel.hide")}
                  onPress={() => onToggleHidden(id)}
                  pressed={layer.hidden}
                />
                <PanelButton
                  label={layer.locked ? t("panel.unlock") : t("panel.lock")}
                  onPress={() => onToggleLocked(id)}
                  pressed={layer.locked}
                />
              </li>
            );
          })}
        </ol>
      )}
    </Sheet>
  );
}

/** The text colours (spec 6.1 #22: 12 swatches; a hex field under Advanced). Fixed, like a set's background (L14). */
export const DEFAULT_TEXT_COLOUR = "#1F1D1A";
export const TEXT_COLOURS: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: "#1F1D1A", name: "Ink" },
  { hex: "#FFFFFF", name: "White" },
  { hex: "#D9552B", name: "Brick" },
  { hex: "#B23A48", name: "Cherry" },
  { hex: "#E0A458", name: "Mustard" },
  { hex: "#5B7553", name: "Olive" },
  { hex: "#2E5E8C", name: "Navy" },
  { hex: "#7A5195", name: "Plum" },
  { hex: "#E6A3B3", name: "Rose" },
  { hex: "#8C7B6B", name: "Taupe" },
  { hex: "#6B6B6B", name: "Grey" },
  { hex: "#F4EFE6", name: "Paper" },
];

/**
 * S62 — the text tool, for a selected text layer: the words, the font, size, colour, alignment.
 * Fonts are the curated OFL set plus the person's own uploads (S63).
 */
export function TextPanel({
  style,
  fonts,
  onChange,
  onAdvanced,
}: {
  style: TextStyle;
  fonts: ReadonlyArray<{ id: string; name: string }>;
  onChange: (next: TextStyle) => void;
  onAdvanced?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2" aria-label={t("text.title")}>
      <label className="block">
        <span className="text-sm text-ink-soft">{t("text.words")}</span>
        <textarea
          value={style.text}
          maxLength={500}
          rows={2}
          onChange={(e) => onChange({ ...style, text: e.target.value })}
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink"
        />
      </label>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t("text.font")}>
        {fonts.map((f) => (
          <PanelButton
            key={f.id}
            label={f.name}
            pressed={style.font === f.id}
            onPress={() => onChange({ ...style, font: f.id })}
          />
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t("text.size")}>
        <PanelButton
          label={t("panel.smaller")}
          onPress={() => onChange({ ...style, size: Math.max(12, Math.round(style.size * 0.85)) })}
        />
        <PanelButton
          label={t("panel.bigger")}
          onPress={() => onChange({ ...style, size: Math.min(600, Math.round(style.size * 1.15)) })}
        />
        <PanelButton
          label={t("text.alignLeft")}
          pressed={style.align === "left"}
          onPress={() => onChange({ ...style, align: "left" })}
        />
        <PanelButton
          label={t("text.alignCenter")}
          pressed={style.align === "center"}
          onPress={() => onChange({ ...style, align: "center" })}
        />
        <PanelButton
          label={t("text.alignRight")}
          pressed={style.align === "right"}
          onPress={() => onChange({ ...style, align: "right" })}
        />
        {onAdvanced ? <PanelButton label={t("text.advanced")} onPress={onAdvanced} /> : null}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("text.colour")}>
        {TEXT_COLOURS.map((c) => (
          <button
            key={c.hex}
            type="button"
            onClick={() => onChange({ ...style, colour: c.hex })}
            aria-label={c.name}
            aria-pressed={style.colour.toLowerCase() === c.hex.toLowerCase()}
            className={`size-12 rounded-pill border-2 ${style.colour.toLowerCase() === c.hex.toLowerCase() ? "border-ink" : "border-line"}`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
    </div>
  );
}
