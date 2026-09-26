import { useId, useRef, type ReactNode } from "react";

/**
 * Tabs, done the way a screen reader expects (design pack §3.1; WAI-ARIA tabs pattern).
 *
 * The first version of the profile screen had role="tablist" on a row of buttons and nothing
 * else: no panel tied to the tabs, no arrow keys, and Tab stepping through all three buttons.
 * A screen reader announced "tab, 1 of 3" and then none of the promises that come with it held.
 * Testing called it a fake tablist, which is fair.
 *
 * What a real one owes the person:
 *  - one stop on the keyboard, not three. The selected tab is the only one with tabindex 0, so
 *    Tab lands on the tab row once and the next Tab goes into the panel.
 *  - Left/Right (and Home/End) move between tabs and select as they go, which is the pattern for
 *    tabs whose panels are cheap to show.
 *  - the panel says which tab it belongs to, and the tab says which panel it opens.
 */
export type TabItem<Id extends string> = { id: Id; label: string };

export function Tabs<Id extends string>({
  items,
  current,
  onChange,
  label,
  children,
}: {
  items: readonly TabItem<Id>[];
  current: Id;
  onChange: (id: Id) => void;
  label: string;
  children: ReactNode;
}) {
  const base = useId();
  const row = useRef<HTMLDivElement | null>(null);
  const tabId = (id: Id) => `${base}-tab-${id}`;
  const panelId = (id: Id) => `${base}-panel-${id}`;

  function move(to: number) {
    const wrapped = (to + items.length) % items.length;
    const next = items[wrapped];
    if (!next) return;
    onChange(next.id);
    // Selection follows focus, so the focus has to follow it back.
    row.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(next.id))}`)?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const at = items.findIndex((item) => item.id === current);
    if (at < 0) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else return;
    event.preventDefault();
  }

  return (
    <div>
      <div
        ref={row}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="mt-6 flex border-b border-line"
      >
        {items.map(({ id, label: text }) => {
          const selected = id === current;
          return (
            <button
              key={id}
              id={tabId(id)}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={panelId(id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(id)}
              className={
                selected
                  ? "min-h-12 flex-1 border-b-2 border-brand text-base font-semibold text-brand"
                  : "min-h-12 flex-1 border-b-2 border-transparent text-base text-ink-soft"
              }
            >
              {text}
            </button>
          );
        })}
      </div>
      <div id={panelId(current)} role="tabpanel" aria-labelledby={tabId(current)} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
