import { t } from "@/i18n/en";

/**
 * One piece on the shared page or the Sources list: "Buy at [store] · $49.90" or
 * "Their own item", with "from [site]" beneath (spec 4.2 #5, 8.1). Buy opens the store
 * in the phone's own browser, never inside Kleit (spec 8.2 #14).
 */
export function PieceRow({
  thumbSrc,
  name,
  site,
  store,
  price,
  buyHref,
  own,
}: {
  thumbSrc: string;
  name: string;
  site: string;
  store?: string;
  price?: string;
  buyHref?: string;
  own?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="size-16 shrink-0 overflow-hidden rounded-sm bg-surface-2">
        <img src={thumbSrc} alt="" className="size-full object-contain" loading="lazy" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base text-ink">{name}</p>
        <p className="truncate text-sm text-ink-soft">{t("piece.from", { site })}</p>
      </div>
      {own || !buyHref || !store ? (
        <span className="shrink-0 text-sm text-ink-soft">{t("piece.ownItem")}</span>
      ) : (
        <a
          href={buyHref}
          target="_blank"
          rel="noopener noreferrer sponsored"
          aria-label={t("piece.buyA11y", { name, store })}
          className="inline-flex min-h-12 shrink-0 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink transition-opacity duration-fast hover:opacity-90"
        >
          {t("piece.buyAt", { store })}
          {price ? ` · ${price}` : ""}
        </a>
      )}
    </div>
  );
}
