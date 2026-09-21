import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { KleitMark } from "@/brand/KleitMark";
import {
  Chip,
  EmptyState,
  ItemCard,
  ItemCardSkeleton,
  PieceRow,
  PollCard,
  PrimaryButton,
  SetCard,
  SetCardSkeleton,
  Sheet,
  TabBar,
  Toast,
  type TabId,
} from "@/components/kleit";

/**
 * M1.3 component review page — the owner's 30-minute look (roadmap M1.3).
 * Light and dark side by side. Sample pictures are placeholders in public/dev/.
 * ⚠ A debug route: removed by the pre-launch check (security plan #18).
 */
export const Route = createFileRoute("/dev/components")({
  head: () => ({ meta: [{ title: "Kleit — components" }] }),
  component: ComponentsPage,
});

const SETTINGS = [
  "--kl-color-canvas",
  "--kl-color-surface",
  "--kl-color-surface-2",
  "--kl-color-ink",
  "--kl-color-ink-soft",
  "--kl-color-line",
  "--kl-color-brand",
  "--kl-color-brand-ink",
  "--kl-color-positive",
  "--kl-color-warning",
  "--kl-color-danger",
  "--kl-color-scrim",
  "--kl-font-display",
  "--kl-font-ui",
  "--kl-text-base",
  "--kl-radius-sm",
  "--kl-radius-md",
  "--kl-radius-pill",
  "--kl-space-4",
  "--kl-shadow-card",
  "--kl-motion-fast",
  "--kl-motion-slow",
];

function ThemeValues() {
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<[string, string][]>([]);
  useEffect(() => {
    if (!ref.current) return;
    const cs = getComputedStyle(ref.current);
    setValues(SETTINGS.map((name) => [name, cs.getPropertyValue(name).trim()]));
  }, []);
  return (
    <div ref={ref} className="rounded-md bg-surface p-3 text-xs text-ink-soft">
      <p className="mb-2 text-sm font-semibold text-ink">The 22 theme settings (this column)</p>
      <ul className="grid gap-1">
        {values.map(([name, value]) => (
          <li key={name} className="flex items-center gap-2">
            {name.includes("color") ? (
              <span className="size-4 shrink-0 rounded-sm border border-line" style={{ background: `var(${name})` }} />
            ) : null}
            <code className="text-ink">{name.replace("--kl-", "")}</code>
            <span className="truncate">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Column({ theme }: { theme: "light" | "dark" }) {
  const [tab, setTab] = useState<TabId>("home");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [voted, setVoted] = useState<string | undefined>(undefined);
  const [chips, setChips] = useState<Record<string, boolean>>({ Tops: true, Shoes: false, Bags: false });
  const [toast, setToast] = useState(false);
  const voteProps = voted === undefined ? {} : { votedId: voted };

  return (
    <section data-theme={theme} className="flex min-w-0 flex-1 flex-col gap-6 bg-canvas p-4 text-ink">
      <header className="flex items-center gap-3">
        <KleitMark size={36} />
        <span className="font-display text-3xl">Kleit</span>
        <span className="ml-auto rounded-pill border border-line px-3 py-1 text-xs text-ink-soft">
          {theme === "light" ? "Light" : "Dark"}
        </span>
      </header>

      <div>
        <h2 className="mb-2 font-display text-2xl">Set card</h2>
        <SetCard
          imageSrc="/dev/set.svg"
          imageAlt="Navy top, beige trousers, brown bag and red scarf"
          username="jay.wears"
          caption="saturday brunch?"
        />
        <div className="mt-3 max-w-60">
          <SetCardSkeleton />
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-display text-2xl">Item cards</h2>
        <div className="grid grid-cols-3 gap-3">
          <ItemCard imageSrc="/dev/top.svg" imageAlt="Navy top" name="Navy top" price="$29.90" />
          <ItemCard imageSrc="/dev/trousers.svg" imageAlt="Beige trousers" name="Beige trousers" own />
          <ItemCardSkeleton />
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-display text-2xl">Poll card</h2>
        <PollCard
          question="Which one?"
          options={[
            { id: "a", label: "Outfit A", votes: 7 },
            { id: "b", label: "Outfit B", votes: 3 },
          ]}
          onVote={setVoted}
          privacyHref="#"
          {...voteProps}
        />
      </div>

      <div>
        <h2 className="mb-2 font-display text-2xl">Piece rows</h2>
        <div className="divide-y divide-line rounded-md bg-surface px-3">
          <PieceRow thumbSrc="/dev/bag.svg" name="Brown bag" site="example-store.com" store="Example Store" price="$49.90" buyHref="#" />
          <PieceRow thumbSrc="/dev/scarf.svg" name="Red scarf" site="Uploaded by @jay.wears" own />
        </div>
        <p className="mt-2 text-sm text-ink">We earn a commission from purchases</p>
      </div>

      <div>
        <h2 className="mb-2 font-display text-2xl">Chips</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(chips).map(([label, on]) => (
            <Chip key={label} label={label} selected={on} onToggle={() => setChips({ ...chips, [label]: !on })} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-display text-2xl">Empty state</h2>
        <div className="rounded-md bg-surface">
          <EmptyState line="Nothing in your closet yet. Snap three pieces and you can build a set" actionLabel="Take a photo" />
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-display text-2xl">Sheet and toast</h2>
        <div className="grid gap-3">
          <PrimaryButton onClick={() => setSheetOpen(true)}>Open a sheet</PrimaryButton>
          <button
            type="button"
            onClick={() => setToast(true)}
            className="min-h-12 rounded-pill border border-line bg-surface px-5 text-base text-ink"
          >
            Show a toast
          </button>
          {toast ? <Toast message="Sent. We'll tell you when someone votes" onDismiss={() => setToast(false)} /> : null}
        </div>
        <Sheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title="Create"
          description="Pick how you want to start"
          action={<PrimaryButton onClick={() => setSheetOpen(false)}>Quick set</PrimaryButton>}
        >
          <p className="text-base text-ink-soft">The outfit behind this sheet stays visible.</p>
        </Sheet>
      </div>

      <ThemeValues />

      <div className="overflow-hidden rounded-md border border-line">
        <TabBar current={tab} onSelect={(next) => (next === "create" ? setSheetOpen(true) : setTab(next))} />
      </div>
    </section>
  );
}

function ComponentsPage() {
  return (
    <main className="flex min-h-screen flex-col md:flex-row">
      <Column theme="light" />
      <Column theme="dark" />
    </main>
  );
}
