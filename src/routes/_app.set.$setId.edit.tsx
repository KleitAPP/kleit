import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { Chip, EmptyState, PrimaryButton } from "@/components/kleit";
import { imageUrlFor, priceLabel, type ItemSummary } from "@/items/items";
import { ItemPicker } from "@/sets/ItemPicker";
import {
  autoTitle,
  clearSlot,
  loadSet,
  placeItem,
  priceTotal,
  saveLayout,
  templates,
  type Placement,
  type QuickLayout,
  type Template,
  refreshPreview,
} from "@/sets/sets";
import { SWATCHES, inkFor } from "@/sets/swatches";
import { myDrawer } from "@/items/items";
import { t } from "@/i18n/en";

/**
 * S42 — the Quick builder (design pack W9; spec 5.1).
 *
 * Top: the template row, 4-piece pre-selected so nobody chooses one mid-run. Middle: the canvas
 * of slots. Thumb zone: the recent-clips tray, the caption, Send. Tap an empty slot or a clip in
 * the tray to fill the next slot; tap a filled slot to swap or remove it.
 *
 * Autosave after every change (guardrail 1). The screen says "Saved" after the fact and never
 * "saving"; if a save fails it says so and keeps trying, and the work is still on the screen.
 * The layout goes through `save_set_layout`, which writes a version too; the pieces go into
 * set_items row by row. Force-closing the app mid-edit and reopening loses nothing, because
 * nothing waits for a button.
 *
 * The background is a fixed colour written into the set, chosen from six swatches. It does not
 * follow the phone's dark mode, on purpose (L14).
 */
export const Route = createFileRoute("/_app/set/$setId/edit")({
  head: () => ({
    meta: [{ title: "Quick set" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: QuickBuilder,
});

type SaveState = "idle" | "saved" | "failed";

function QuickBuilder() {
  const { setId } = Route.useParams();
  const navigate = useNavigate();
  const [layout, setLayout] = useState<QuickLayout | null>(null);
  const [missing, setMissing] = useState(false);
  const [all, setAll] = useState<Template[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [tray, setTray] = useState<ItemSummary[]>([]);
  const [picking, setPicking] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimer = useRef<number | null>(null);
  const pending = useRef<QuickLayout | null>(null);
  /** Always the newest layout - for code that runs after an await and must not use a stale copy. */
  const latest = useRef<QuickLayout | null>(null);
  /** Published sets redraw their chat picture after each save (CL30); drafts have none. */
  const published = useRef(false);

  // Load everything once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loaded, tpls, drawer] = await Promise.all([loadSet(setId), templates(), myDrawer()]);
      if (cancelled) return;
      if (!loaded) {
        setMissing(true);
        return;
      }
      setAll(tpls);
      published.current = loaded.set.status === "published";
      const opening = loaded.set.layout.template
        ? loaded.set.layout
        : { ...loaded.set.layout, template: tpls[0]?.id ?? "" };
      latest.current = opening;
      setLayout(opening);
      setPlacements(loaded.placements);
      setTray(drawer);
      const urls: Record<string, string | null> = {};
      await Promise.all(
        [...loaded.placements.map((p) => p.item), ...drawer].map(async (item) => {
          if (!(item.id in urls)) urls[item.id] = await imageUrlFor(item);
        }),
      );
      if (!cancelled) setImages(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [setId]);

  /** Every layout change lands here; the write is debounced a little and retried on failure. */
  const commit = useCallback(
    (next: QuickLayout) => {
      setLayout(next);
      latest.current = next;
      pending.current = next;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async function attempt() {
        const toSave = pending.current;
        if (!toSave) return;
        const ok = await saveLayout(setId, toSave);
        if (ok) {
          if (pending.current === toSave) pending.current = null;
          setSaveState("saved");
          if (published.current) refreshPreview(setId);
        } else {
          setSaveState("failed");
          saveTimer.current = window.setTimeout(attempt, 4000);
        }
      }, 400);
    },
    [setId],
  );

  async function ensureImage(item: ItemSummary) {
    if (item.id in images) return;
    const url = await imageUrlFor(item);
    setImages((m) => ({ ...m, [item.id]: url }));
  }

  async function fill(slot: number, item: ItemSummary) {
    await ensureImage(item);
    // Optimistic: the piece appears at once; the row policy is what makes it stick.
    setPlacements((p) => [
      ...p.filter((x) => x.slot !== slot && x.item.id !== item.id),
      { slot, item },
    ]);
    setPicking(null);
    const ok = await placeItem(setId, slot, item.id);
    setSaveState(ok ? "saved" : "failed");
    // A version, so undo-by-history sees the piece too. From the ref, not the closure: this runs
    // after an await, and a caption typed in the meantime must not be overwritten (found by the
    // core-loop test, 2026-09-29 - it types faster than the network answers).
    if (ok && latest.current) commit({ ...latest.current });
  }

  async function empty(slot: number) {
    setPlacements((p) => p.filter((x) => x.slot !== slot));
    const ok = await clearSlot(setId, slot);
    setSaveState(ok ? "saved" : "failed");
  }

  if (missing) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("builder.notFound")} />
      </div>
    );
  }
  if (!layout) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8" role="status" aria-label={t("loading")}>
        <div className="kl-skeleton aspect-[4/5] w-full rounded-md bg-surface-2" />
      </div>
    );
  }

  const template = all.find((tpl) => tpl.id === layout.template) ?? all[0];
  const slots = template?.layout.slots ?? [];
  const nextEmpty = slots.findIndex((_, i) => !placements.some((p) => p.slot === i));
  const total = priceTotal(placements);
  const ink = inkFor(layout.background);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6">
      {/* Top: template row and the running total. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label={t("builder.template")}>
          {all.map((tpl) => (
            <Chip
              key={tpl.id}
              label={tpl.name}
              selected={tpl.id === template?.id}
              onToggle={() => commit({ ...layout, template: tpl.id })}
            />
          ))}
        </div>
        <p className="shrink-0 text-sm text-ink-soft" aria-live="polite">
          {placements.length > 0
            ? t("builder.total", {
                total:
                  priceLabel({ price_cents: total.cents, price_currency: total.currency }) ?? "",
              })
            : ""}
        </p>
      </div>

      {/* Middle: the canvas. Positions are fractions of the template's canvas. */}
      <div
        className="relative mt-3 w-full overflow-hidden rounded-md border border-line"
        style={{
          aspectRatio: `${template?.layout.canvas.w ?? 4} / ${template?.layout.canvas.h ?? 5}`,
          backgroundColor: layout.background,
        }}
        aria-label={t("builder.canvas")}
      >
        {slots.map((slot, i) => {
          const placed = placements.find((p) => p.slot === i);
          const url = placed ? images[placed.item.id] : null;
          const tag = placed
            ? placed.item.kind === "own"
              ? t("item.own")
              : priceLabel(placed.item)
            : null;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setPicking(i)}
              aria-label={
                placed
                  ? t("builder.slotFilled", { n: i + 1, name: placed.item.title ?? "" })
                  : t("builder.slotEmpty", { n: i + 1 })
              }
              className="absolute flex items-center justify-center rounded-sm"
              style={{
                left: `${slot.x * 100}%`,
                top: `${slot.y * 100}%`,
                width: `${slot.w * 100}%`,
                height: `${slot.h * 100}%`,
                outline: placed ? "none" : `1px dashed ${ink}`,
                outlineOffset: -1,
                opacity: placed ? 1 : 0.7,
              }}
            >
              {placed ? (
                <>
                  {url ? (
                    <img src={url} alt="" className="size-full object-contain" draggable={false} />
                  ) : null}
                  {tag ? (
                    <span
                      className="absolute bottom-1 left-1 rounded-pill px-2 py-0.5 text-xs font-medium"
                      style={{ backgroundColor: ink, color: layout.background }}
                    >
                      {tag}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-2xl" style={{ color: ink }} aria-hidden="true">
                  +
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Swatches: fixed colours, written into the set. */}
      <div className="mt-3 flex gap-2" role="group" aria-label={t("builder.background")}>
        {SWATCHES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-label={s.name}
            aria-pressed={s.hex === layout.background}
            onClick={() => commit({ ...layout, background: s.hex })}
            className="size-8 rounded-pill border-2"
            style={{
              backgroundColor: s.hex,
              borderColor: s.hex === layout.background ? "var(--color-ink)" : "var(--color-line)",
            }}
          />
        ))}
        <p className="ml-auto self-center text-sm text-ink-soft" role="status">
          {saveState === "saved" ? t("saved") : saveState === "failed" ? t("notSaved") : ""}
        </p>
      </div>

      {/* Thumb zone: the tray, the caption, Send. */}
      <p className="mt-5 text-sm text-ink-soft">{t("builder.tray")}</p>
      {tray.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">{t("builder.trayEmpty")}</p>
      ) : (
        <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {tray.map((item) => (
            <li key={item.id} className="shrink-0">
              <button
                type="button"
                onClick={() => void fill(nextEmpty >= 0 ? nextEmpty : 0, item)}
                aria-label={t("builder.addToNext", { name: item.title ?? "" })}
                className="block size-20 overflow-hidden rounded-sm bg-surface-2"
              >
                {images[item.id] ? (
                  <img
                    src={images[item.id] ?? ""}
                    alt=""
                    className="size-full object-contain"
                    loading="lazy"
                  />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="mt-4 block">
        <span className="text-sm text-ink-soft">{t("builder.caption")}</span>
        <input
          type="text"
          maxLength={280}
          value={layout.caption}
          placeholder={t("builder.captionHint")}
          onChange={(e) => commit({ ...layout, caption: e.target.value })}
          className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
        />
      </label>

      <div className="mt-4">
        <PrimaryButton
          disabled={placements.length === 0}
          onClick={() => void navigate({ to: "/set/$setId/send", params: { setId } })}
        >
          {t("builder.send")}
        </PrimaryButton>
        <p className="mt-2 text-sm text-ink-soft">
          {autoTitle(placements) || t("builder.titleHint")}
        </p>
      </div>

      <ItemPicker
        open={picking !== null}
        onOpenChange={(open) => {
          if (!open) setPicking(null);
        }}
        onPick={(item) => {
          if (picking !== null) void fill(picking, item);
        }}
        onRemove={
          picking !== null && placements.some((p) => p.slot === picking)
            ? () => {
                const slot = picking;
                setPicking(null);
                void empty(slot);
              }
            : undefined
        }
      />
    </div>
  );
}
