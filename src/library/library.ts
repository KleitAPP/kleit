/**
 * The decoration library (roadmap M4.4; artwork pack §3, §9a).
 *
 * 466 pictures - 284 museum cutouts (CC0) and 182 drawn for Kleit - plus 70 backgrounds, in 14
 * packs. The catalogue is written by scripts/build-library.mjs from the licence records, so every
 * entry here has a row saying where it came from; the drawer reads nothing else. It is loaded
 * once, on first use, because nobody needs 190 KB of titles to open the app.
 */

export type LibraryAsset = {
  /** A museum photograph, a picture drawn for Kleit, or a one-colour structural SVG the user recolours. */
  kind: "cutout" | "drawn" | "structural";
  family?: string;
  /** The museum's own object title for a cutout - the name a screen reader says (§8 #2). */
  title: string;
  packs: string[];
  credit: string;
  source: string;
  file: string;
  thumb: string;
  w: number;
  h: number;
  bytes: number;
};

export type LibraryPack = {
  id: string;
  name: string;
  tier: "free" | "paid";
  for: string;
  holds: string;
  palette: string[];
  count: number;
  backgrounds: string[];
};

export type Catalogue = {
  packs: LibraryPack[];
  assets: Record<string, LibraryAsset>;
  backgrounds: Record<string, LibraryAsset>;
};

let loading: Promise<Catalogue> | null = null;

export function loadCatalogue(): Promise<Catalogue> {
  loading ??= import("./catalogue.json").then((m) => m.default as unknown as Catalogue);
  return loading;
}

/** The library's URL for a catalogue file (a decoration, a background, or a thumbnail). */
export function libraryUrl(file: string): string {
  return `/library/${file}`;
}

/** Case-insensitive search over titles, within one pack or the whole library. */
export function searchAssets(
  catalogue: Catalogue,
  query: string,
  pack: string | null,
): Array<[string, LibraryAsset]> {
  const q = query.trim().toLowerCase();
  return Object.entries(catalogue.assets).filter(
    ([, a]) => (!pack || a.packs.includes(pack)) && (!q || a.title.toLowerCase().includes(q)),
  );
}
