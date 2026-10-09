import { t } from "@/i18n/en";

/**
 * A piece on a plain neutral tile (closet, tray, item picker). Price OR the OWN tag,
 * always as text — never colour alone (design pack §8.2, §8.3 #3).
 * The tile is surface-2: neutral grey in both themes so clothing colours read true.
 */
export function ItemCard({
  imageSrc,
  imageAlt,
  name,
  price,
  own,
  onSelect,
}: {
  imageSrc: string;
  imageAlt: string;
  name: string;
  price?: string;
  own?: boolean;
  onSelect?: () => void;
}) {
  const body = (
    <>
      <div className="aspect-square w-full overflow-hidden rounded-sm bg-surface-2">
        <img src={imageSrc} alt={imageAlt} className="size-full object-contain" loading="lazy" />
      </div>
      <p className="mt-2 truncate text-sm text-ink">{name}</p>
      {own ? (
        <p className="text-xs font-semibold tracking-wide text-ink-soft">{t("item.own")}</p>
      ) : price ? (
        <p className="text-sm text-ink-soft">{price}</p>
      ) : null}
    </>
  );
  if (!onSelect) return <div className="min-w-0">{body}</div>;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="block w-full min-w-0 rounded-sm text-left transition-opacity duration-fast active:opacity-70"
    >
      {body}
    </button>
  );
}
