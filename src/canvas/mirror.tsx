import { useCallback, useEffect, useRef, useState } from "react";

import { t } from "@/i18n/en";
import type { ItemSummary } from "@/items/items";

import type { Doc } from "./doc";
import { layerName } from "./panels";

/**
 * The canvas for a screen reader (spec 21 #2): a hidden, ordered list of the layers beside the
 * stage - "Layer 2: black boots, Zara" - kept in step with the canvas by surgical updates (React
 * reconciles the list; nothing is rebuilt), with two-way sync between the canvas's selection
 * and keyboard focus, and one coalescing live region so five arrow presses say "Moved 50
 * pixels left" once rather than five times.
 *
 * The list is the same words the Layers sheet uses (layerName); the sheet stays, for the
 * reorder, hide and lock buttons. Arrow keys, [ and ], L, Delete and the rest work while a
 * layer button here has focus, through the canvas's own key handler.
 */

const COALESCE_MS = 300;

type Pending = { dx: number; dy: number; words: string[] };

/** One polite live region; `move` adds up nudges, `say` queues a sentence; both flush together. */
export function useAnnouncer(): {
  say: (words: string) => void;
  move: (dx: number, dy: number) => void;
  region: React.ReactNode;
} {
  const [text, setText] = useState("");
  const pending = useRef<Pending>({ dx: 0, dy: 0, words: [] });
  const timer = useRef<number | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    const { dx, dy, words } = pending.current;
    pending.current = { dx: 0, dy: 0, words: [] };
    const parts = [...words];
    if (dx !== 0 || dy !== 0) parts.unshift(moveWords(dx, dy));
    if (parts.length === 0) return;
    // A changed string is what a live region announces; the same one twice would be silent, so
    // a trailing space alternates to make "Moved 10 pixels left" twice read twice.
    setText((old) => {
      const next = parts.join(". ");
      return old === next ? `${next} ` : next;
    });
  }, []);

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, COALESCE_MS);
  }, [flush]);

  const say = useCallback(
    (words: string) => {
      pending.current.words.push(words);
      schedule();
    },
    [schedule],
  );
  const move = useCallback(
    (dx: number, dy: number) => {
      pending.current.dx += dx;
      pending.current.dy += dy;
      schedule();
    },
    [schedule],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const region = (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
  return { say, move, region };
}

function moveWords(dx: number, dy: number): string {
  const parts: string[] = [];
  if (dx !== 0)
    parts.push(t(dx < 0 ? "mirror.movedLeft" : "mirror.movedRight", { px: Math.abs(dx) }));
  if (dy !== 0) parts.push(t(dy < 0 ? "mirror.movedUp" : "mirror.movedDown", { px: Math.abs(dy) }));
  return t("mirror.moved", { how: parts.join(t("mirror.and")) });
}

export function CanvasMirror({
  doc,
  items,
  decorNames,
  selected,
  onSelect,
  stage,
}: {
  doc: Doc;
  items: Record<string, ItemSummary>;
  decorNames: Record<string, string>;
  selected: string | null;
  onSelect: (id: string) => void;
  /** The stage's wrapper: a selection made by a tap in it moves focus to the matching button. */
  stage: React.RefObject<HTMLDivElement | null>;
}) {
  const list = useRef<HTMLOListElement | null>(null);

  // Canvas → focus: when the selection changes and the keyboard was on the stage, the body or
  // the list itself, focus follows to the matching button (never when the person is typing in
  // a field, and never scrolling the page to do it).
  useEffect(() => {
    if (!selected || !list.current) return;
    const active = document.activeElement;
    const free =
      !active ||
      active === document.body ||
      list.current.contains(active) ||
      (stage.current?.contains(active) ?? false);
    if (!free) return;
    const button = list.current.querySelector<HTMLButtonElement>(`[data-layer="${selected}"]`);
    button?.focus({ preventScroll: true });
  }, [selected, stage]);

  return (
    <ol ref={list} className="sr-only" aria-label={t("mirror.title")}>
      {doc.order.map((id, index) => {
        const layer = doc.layers[id];
        if (!layer) return null;
        const name = layerName(layer, items, index, decorNames);
        return (
          <li key={id}>
            <button
              type="button"
              data-layer={id}
              aria-pressed={selected === id}
              onClick={() => onSelect(id)}
            >
              {name}
              {layer.hidden ? ` · ${t("layers.hidden")}` : ""}
              {layer.locked ? ` · ${t("layers.locked")}` : ""}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
