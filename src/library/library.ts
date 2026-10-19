/**
 * The decoration library (roadmap M4.4; artwork pack §3, §9a).
 *
 * 466 pictures - 284 museum cutouts (CC0) and 182 drawn for Kleit - plus 70 backgrounds, in 14
 * packs. The catalogue is written by scripts/build-library.mjs from the licence records, so every
 * entry here has a row saying where it came from; the drawer reads nothing else. It is loaded
 * once, on first use, because nobody needs 190 KB of titles to open the app.
 */

import { supabase } from "@/integrations/supabase/client";
import { isNativeApp, siteUrl } from "@/lib/site";

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

/**
 * The catalogue, less anything pulled (spec 13.3 #6; migration 118): an asset of ours that had
 * to be taken down is listed on the server within minutes and leaves the files at the next
 * deploy, so the drawer asks for the list once and drops those entries. No answer (offline, a
 * slow start) leaves the shipped catalogue as it is - the drawer must work with no signal.
 */
export function loadCatalogue(): Promise<Catalogue> {
  loading ??= Promise.all([
    import("./catalogue.json").then((m) => m.default as unknown as Catalogue),
    pulledAssets(),
  ]).then(([catalogue, pulled]) => withoutPulled(catalogue, pulled));
  return loading;
}

async function pulledAssets(): Promise<string[]> {
  try {
    const { data } = await supabase.rpc("pulled_library_assets");
    return Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** The catalogue without the pulled ids - a copy when any apply, the same object when none do. */
export function withoutPulled(catalogue: Catalogue, pulled: readonly string[]): Catalogue {
  const gone = pulled.filter((id) => id in catalogue.assets || id in catalogue.backgrounds);
  if (gone.length === 0) return catalogue;
  const assets = { ...catalogue.assets };
  const backgrounds = { ...catalogue.backgrounds };
  for (const id of gone) {
    delete assets[id];
    delete backgrounds[id];
  }
  const packs = catalogue.packs.map((p) => ({
    ...p,
    backgrounds: p.backgrounds.filter((id) => !gone.includes(id)),
    count: Object.values(assets).filter((a) => a.packs.includes(p.id)).length,
  }));
  return { packs, assets, backgrounds };
}

/**
 * The library's URL for a catalogue file (a decoration, a background, or a thumbnail).
 *
 * Inside the phone apps the drawn decorations, the backgrounds, the structural pieces and every
 * thumbnail ship in the app, so the drawer works with no signal (M8.5; spec 20.2 #2). The museum
 * photographs (`cutouts/`, 26 MB) do not: they come from the website on first use, which keeps
 * the app a third of the size, and the drawer says so when the network is away.
 */
export function libraryUrl(file: string): string {
  if (file.startsWith("cutouts/") && isNativeApp()) return siteUrl(`/library/${file}`);
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
