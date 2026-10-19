import { useEffect, useMemo, useState } from "react";

import { Chip, EmptyState, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import { useOnline } from "@/offline/net";
import {
  libraryUrl,
  loadCatalogue,
  searchAssets,
  type Catalogue,
  type LibraryAsset,
} from "@/library/library";

/**
 * The decoration drawer (M4.4; artwork pack §7.2): fourteen pack tiles, each showing four
 * thumbnails; open one and its pieces fill a grid of 160 px thumbnails that load lazily, so the
 * first paint is a couple of dozen small files. A search box finds a piece by its title across
 * the whole library. In background mode the same sheet shows each pack's five backgrounds.
 *
 * Every tile's label is the asset's title - for a museum cutout, the museum's own words - which
 * is also what a screen reader says and what the layers list shows once placed.
 */
/**
 * A tile's picture. A structural SVG is one colour (currentColor) so it is shown as a mask in
 * the theme's ink - that is the drawer's tile, UI, not the user's canvas (artwork pack A18).
 */
export function Thumb({
  asset,
  alt,
  small = false,
  cover = false,
}: {
  asset: LibraryAsset;
  alt: string;
  small?: boolean;
  cover?: boolean;
}) {
  const side = small ? 80 : 120;
  if (asset.kind === "structural") {
    const url = `url(${libraryUrl(asset.thumb)})`;
    return (
      <span
        role="img"
        aria-label={alt}
        className="block aspect-square w-full bg-ink"
        style={{
          maskImage: url,
          WebkitMaskImage: url,
          maskSize: "80% 80%",
          WebkitMaskSize: "80% 80%",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
        }}
      />
    );
  }
  return (
    <img
      src={libraryUrl(asset.thumb)}
      alt={alt}
      loading="lazy"
      width={side}
      height={side}
      className={
        cover
          ? "aspect-square w-full rounded-sm object-cover"
          : "aspect-square w-full object-contain"
      }
    />
  );
}

export function LibraryDrawer({
  open,
  mode,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  mode: "assets" | "backgrounds";
  onOpenChange: (open: boolean) => void;
  onPick: (id: string, asset: LibraryAsset) => void;
}) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [pack, setPack] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open && !catalogue) void loadCatalogue().then(setCatalogue);
  }, [open, catalogue]);
  useEffect(() => {
    if (open) {
      setPack(null);
      setQuery("");
    }
  }, [open, mode]);

  const results = useMemo(() => {
    if (!catalogue) return [];
    if (mode === "backgrounds") {
      return Object.entries(catalogue.backgrounds).filter(
        ([, b]) => !pack || b.packs.includes(pack),
      );
    }
    if (!pack && !query.trim()) return [];
    return searchAssets(catalogue, query, pack);
  }, [catalogue, mode, pack, query]);

  const showPacks = mode === "assets" ? !pack && !query.trim() : false;
  const online = useOnline();

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "assets" ? t("library.title") : t("library.backgrounds")}
    >
      {!online ? <p className="mb-3 text-sm text-ink-soft">{t("offline.museum")}</p> : null}
      {!catalogue ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="kl-skeleton aspect-square rounded-md bg-surface-2" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {mode === "assets" ? (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("library.search")}
              aria-label={t("library.search")}
              className="min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
            />
          ) : null}
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            role="group"
            aria-label={t("library.allPacks")}
          >
            <Chip
              label={t("library.allPacks")}
              selected={pack === null}
              onToggle={() => setPack(null)}
            />
            {catalogue.packs.map((p) => (
              <Chip
                key={p.id}
                label={p.name}
                selected={pack === p.id}
                onToggle={() => setPack(p.id)}
              />
            ))}
          </div>

          {showPacks ? (
            <ul className="grid grid-cols-2 gap-3" aria-label={t("library.allPacks")}>
              {catalogue.packs.map((p) => {
                const firstFour = Object.entries(catalogue.assets)
                  .filter(([, a]) => a.packs.includes(p.id))
                  .slice(0, 4);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPack(p.id)}
                      className="w-full rounded-md border border-line bg-surface-2 p-2 text-left"
                    >
                      <div className="grid grid-cols-2 gap-1">
                        {firstFour.map(([id, a]) => (
                          <Thumb key={id} asset={a} alt="" small />
                        ))}
                      </div>
                      <p className="mt-2 text-base text-ink">{p.name}</p>
                      <p className="text-xs text-ink-soft">
                        {t("library.pieces", { count: p.count })}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : results.length === 0 ? (
            <EmptyState line={t("library.empty")} />
          ) : (
            <ul
              className="grid grid-cols-3 gap-2"
              style={{ contentVisibility: "auto", containIntrinsicSize: "auto none" }}
            >
              {results.map(([id, a]) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onPick(id, a)}
                    aria-label={a.title}
                    title={`${a.title} — ${a.credit}`}
                    className="flex w-full flex-col items-center rounded-md border border-line bg-surface-2 p-1"
                  >
                    <Thumb asset={a} alt={a.title} cover={mode === "backgrounds"} />
                    <span className="mt-1 line-clamp-1 w-full text-center text-xs text-ink-soft">
                      {a.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}
