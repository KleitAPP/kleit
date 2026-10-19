import { Home, Inbox, Plus, Search, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type MessageKey } from "@/i18n/en";

export type TabId = "home" | "search" | "create" | "inbox" | "you";

const TABS: { id: TabId; icon: typeof Home; label: MessageKey }[] = [
  { id: "home", icon: Home, label: "tabs.home" },
  { id: "search", icon: Search, label: "tabs.search" },
  { id: "create", icon: Plus, label: "tabs.create" },
  { id: "inbox", icon: Inbox, label: "tabs.inbox" },
  { id: "you", icon: User, label: "tabs.you" },
];

/**
 * Home · Search · Create · Inbox · You (design pack §3.1). 48 dp targets; the current
 * tab is marked by label weight AND colour, never colour alone. Create is the filled
 * circle in the middle and opens the choice sheet (decision 85).
 */
export function TabBar({ current, onSelect }: { current: TabId; onSelect: (tab: TabId) => void }) {
  return (
    <nav
      aria-label={t("tabs.label")}
      className="sticky bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-around">
        {TABS.map(({ id, icon: Icon, label: labelKey }) => {
          const active = id === current;
          const label = t(labelKey);
          if (id === "create") {
            return (
              <li key={id} className="flex min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onSelect(id)}
                  aria-label={label}
                  className="flex min-h-12 w-full min-w-0 flex-col items-center justify-center gap-1 py-1"
                >
                  <span className="flex size-10 items-center justify-center rounded-pill bg-brand text-brand-ink shadow-card">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="sr-only">{label}</span>
                </button>
              </li>
            );
          }
          return (
            <li key={id} className="flex min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onSelect(id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 w-full min-w-0 flex-col items-center justify-center gap-0.5 py-1 text-xs transition-colors duration-fast",
                  active ? "font-semibold text-brand" : "text-ink-soft",
                )}
              >
                <Icon className="size-6" aria-hidden="true" strokeWidth={active ? 2.4 : 1.8} />
                <span className="max-w-full truncate px-0.5">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
