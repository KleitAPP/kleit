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
  saveLayoutResult,
  templates,
  type Placement,
  type QuickLayout,
  type Template,
  refreshPreview,
} from "@/sets/sets";
import { lookPool, myPool } from "@/sets/pool";
import { completeLook, cycleRing, shufflePicks } from "@/sets/suggest";
import { SWATCHES, inkFor } from "@/sets/swatches";
import { TemplateDressing } from "@/templates/TemplateDressing";
import { myDrawer } from "@/items/items";
import { t } from "@/i18n/en";

/**
 * S42 — the Quick builder (design pack W9; spec 5.1).
 *
 * Top: the template row, 4-piece pre-selected so nobody chooses one mid-run. Middle: the canvas
 * of slots. Thumb zone: the recent-clips tray, the caption, Send. Tap an empty slot or a clip in
 * the tray to fill the next slot; tap a filled slot to swap or remove it.
 *
 * Three helpers over the same slots (spec 5.1 #9, #10, #13; src/sets/suggest.ts): Shuffle fills
 * the empty slots at random from your own pieces; a filled slot swipes (or taps ‹ ›) through
 * the pieces that could stand in for it, its own kind first; Complete the look fills the empty
 * slots with the best next pieces - a kind the set lacks, the same store, the same price band,
 * your own things first. Every one of them is just `fill()` a few times: the same rows, the same
 * autosave, the same version history.
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

type SaveState = "idle" | "saved" | "failed" | "refused";

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
  /** Your closet, hearts and drawer, cleared only: what Shuffle, swipe and Complete the look draw from. */
  const [pool, setPool] = useState<ItemSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Where each slot stands in its swipe ring: the piece it started from and the index shown. */
  const cursors = useRef<Record<number, { origin: ItemSummary; index: number }>>({});
  const swipe = useRef<{ slot: number; x: number } | null>(null);
  const swiped = useRef(false);
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
      // The helpers' pool arrives on its own; nothing on the screen waits for it.
      void myPool().then((p) => {
        if (!cancelled) setPool(p);
      });
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
        const result = await saveLayoutResult(setId, toSave);
        if (result === "saved") {
          if (pending.current === toSave) pending.current = null;
          setSaveState("saved");
          if (published.current) refreshPreview(setId);
        } else if (result === "refused") {
          // The caption carries a phone number or an address (spec 13.2 #4): no retry, say why.
          setSaveState("refused");
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

  async function fill(slot: number, item: ItemSummary, viaSwipe = false) {
    if (!viaSwipe) delete cursors.current[slot];
    setNotice(null);
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
    delete cursors.current[slot];
    setPlacements((p) => p.filter((x) => x.slot !== slot));
    const ok = await clearSlot(setId, slot);
    setSaveState(ok ? "saved" : "failed");
  }

  /** Shuffle: random pieces of your own into the given slots (spec 5.1 #9). */
  async function shuffle(slotsToFill: number[]) {
    if (!pool || busy) return;
    // The slots being shuffled give up what they hold; the other slots' pieces stay out of it.
    const others = placements.filter((p) => !slotsToFill.includes(p.slot)).map((p) => p.item);
    const giving = new Set(
      placements.filter((p) => slotsToFill.includes(p.slot)).map((p) => p.item.id),
    );
    const picks = shufflePicks(
      pool.filter((p) => !giving.has(p.id)),
      others,
      slotsToFill,
    );
    if (picks.length === 0) {
      setNotice(t("builder.shuffleNothing"));
      return;
    }
    setBusy(true);
    try {
      for (const pick of picks) await fill(pick.slot, pick.item);
    } finally {
      setBusy(false);
    }
  }

  /** Complete the look: the best next piece for each empty slot (spec 5.1 #13). */
  async function complete(emptySlots: number[]) {
    if (!pool || busy) return;
    setBusy(true);
    try {
      const placedItems = placements.map((p) => p.item);
      const candidates = await lookPool(placedItems, pool);
      const picks = completeLook(placedItems, emptySlots, candidates);
      if (picks.length === 0) {
        setNotice(t("builder.completeNothing"));
        return;
      }
      for (const pick of picks) await fill(pick.slot, pick.item);
    } finally {
      setBusy(false);
    }
  }

  /** Swipe through a slot (spec 5.1 #10): the next or previous piece that could stand in for it. */
  async function cycle(slot: number, steps: 1 | -1) {
    if (!pool || busy) return;
    const placed = placements.find((p) => p.slot === slot);
    if (!placed) return;
    const others = placements.filter((p) => p.slot !== slot).map((p) => p.item);
    const cursor = cursors.current[slot] ?? { origin: placed.item, index: -1 };
    const ring = cycleRing(cursor.origin, pool, others);
    if (ring.length <= 1) {
      setNotice(t("builder.slotCycleNothing"));
      return;
    }
    // -1 is "at the origin", which sits last in the ring.
    const at = cursor.index < 0 ? ring.length - 1 : cursor.index;
    const index = (at + steps + ring.length) % ring.length;
    cursors.current[slot] = { origin: cursor.origin, index };
    setBusy(true);
    try {
      await fill(slot, ring[index]!, true);
    } finally {
      setBusy(false);
    }
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
  const empties = slots.map((_, i) => i).filter((i) => !placements.some((p) => p.slot === i));
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
        {template ? <TemplateDressing layout={template.layout} layer="under" /> : null}
        {slots.map((slot, i) => {
          const placed = placements.find((p) => p.slot === i);
          const url = placed ? images[placed.item.id] : null;
          const tag = placed
            ? placed.item.kind === "own"
              ? t("item.own")
              : priceLabel(placed.item)
            : null;
          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${slot.x * 100}%`,
                top: `${slot.y * 100}%`,
                width: `${slot.w * 100}%`,
                height: `${slot.h * 100}%`,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  // A sideways swipe just happened on this slot: that was the tap.
                  if (swiped.current) {
                    swiped.current = false;
                    return;
                  }
                  setPicking(i);
                }}
                onPointerDown={(e) => {
                  if (placed) swipe.current = { slot: i, x: e.clientX };
                }}
                onPointerUp={(e) => {
                  const start = swipe.current;
                  swipe.current = null;
                  if (!start || start.slot !== i) return;
                  const dx = e.clientX - start.x;
                  if (Math.abs(dx) < 40) return;
                  swiped.current = true;
                  void cycle(i, dx < 0 ? 1 : -1);
                }}
                onPointerCancel={() => {
                  swipe.current = null;
                }}
                aria-label={
                  placed
                    ? t("builder.slotFilled", {
                        n: i + 1,
                        name: `${placed.item.title ?? ""}${tag ? ` · ${tag}` : ""}`,
                      })
                    : t("builder.slotEmpty", { n: i + 1 })
                }
                className="flex size-full touch-pan-y items-center justify-center rounded-sm"
                style={{
                  outline: placed ? "none" : `1px dashed ${ink}`,
                  outlineOffset: -1,
                  opacity: placed ? 1 : 0.7,
                }}
              >
                {placed ? (
                  <>
                    {url ? (
                      <img
                        src={url}
                        alt=""
                        className="size-full object-contain"
                        draggable={false}
                      />
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
              {/* Swipe through the slot, as buttons too (spec 5.1 #10; design pack 8.3 #1). */}
              {placed && pool && pool.length > 0 ? (
                <span
                  className="absolute right-1 bottom-1 flex overflow-hidden rounded-pill"
                  style={{ backgroundColor: ink, color: layout.background }}
                >
                  <button
                    type="button"
                    aria-label={t("builder.slotPrev", { n: i + 1 })}
                    disabled={busy}
                    onClick={() => void cycle(i, -1)}
                    className="flex size-7 items-center justify-center text-base leading-none"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    aria-label={t("builder.slotNext", { n: i + 1 })}
                    disabled={busy}
                    onClick={() => void cycle(i, 1)}
                    className="flex size-7 items-center justify-center text-base leading-none"
                  >
                    ›
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
        {template ? <TemplateDressing layout={template.layout} layer="over" /> : null}
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
          {saveState === "saved"
            ? t("saved")
            : saveState === "failed"
              ? t("notSaved")
              : saveState === "refused"
                ? t("screen.noContact")
                : ""}
        </p>
      </div>

      {/* Shuffle and Complete the look: one tap each, over the empty slots (spec 5.1 #9, #13). */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !pool || empties.length === 0}
          title={t("builder.shuffleHint")}
          onClick={() => void shuffle(empties)}
          className="min-h-10 rounded-pill border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
        >
          {t("builder.shuffle")}
        </button>
        <button
          type="button"
          disabled={busy || !pool || empties.length === 0 || placements.length === 0}
          title={t("builder.completeHint")}
          onClick={() => void complete(empties)}
          className="min-h-10 rounded-pill border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
        >
          {t("builder.complete")}
        </button>
        {notice ? (
          <p className="basis-full text-sm text-ink-soft" role="status">
            {notice}
          </p>
        ) : null}
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
        <button
          type="button"
          onClick={() => void navigate({ to: "/set/$setId/canvas", params: { setId } })}
          className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("canvas.openInCreative")}
        </button>
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
        onShuffle={
          picking !== null && pool && pool.length > 0
            ? () => {
                const slot = picking;
                setPicking(null);
                void shuffle([slot]);
              }
            : undefined
        }
      />
    </div>
  );
}
