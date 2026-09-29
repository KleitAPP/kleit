import { ItemCard } from "@/components/kleit";
import { priceLabel, type ItemSummary, type ScanState } from "@/items/items";
import { t } from "@/i18n/en";

/**
 * One item on a grid, with the screening state written on it when it is not yet clean.
 *
 * The state is a word, never only a colour or a spinner (design pack §8.3 #3). "Checking",
 * "Being looked at" and "Not allowed" are three different situations and a person waiting on
 * their photo deserves to know which one they are in.
 */
export function ItemTile({
  item,
  imageUrl,
  state,
  onSelect,
}: {
  item: ItemSummary;
  imageUrl: string | null;
  state: ScanState;
  onSelect?: () => void;
}) {
  const name =
    item.title?.trim() || (item.kind === "own" ? t("item.yourPiece") : t("item.untitled"));
  const price = item.kind === "own" ? null : priceLabel(item);
  const note =
    state === "pending"
      ? t("item.checking")
      : state === "review"
        ? t("item.review")
        : state === "blocked"
          ? t("item.blocked")
          : null;

  return (
    <div className="relative min-w-0">
      <ItemCard
        imageSrc={imageUrl ?? PLACEHOLDER}
        imageAlt={item.title?.trim() || ""}
        name={name}
        {...(item.kind === "own" ? { own: true } : {})}
        {...(price ? { price } : {})}
        {...(onSelect ? { onSelect } : {})}
      />
      {note ? (
        <p className="pointer-events-none absolute left-2 top-2 rounded-pill bg-surface px-2 py-1 text-xs font-medium text-ink shadow-card">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** A transparent pixel: the tile's own grey shows through when there is no picture to load. */
const PLACEHOLDER =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
