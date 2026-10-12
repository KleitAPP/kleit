/**
 * The song card's reader (spec 11 #12; migration 091): a Spotify, Apple Music or YouTube Music
 * link becomes a title, an artist and a cover - from the service's own oEmbed answer where there
 * is one, and from the page's Open Graph tags otherwise. Pure: nothing here fetches. The app
 * shows what came back and the person can correct it before the set keeps it.
 *
 * Rules the database also enforces (091): the link is one of the three services over https; the
 * cover comes only from their picture hosts, because a stranger's browser fetches it straight
 * from there when the share page is drawn.
 */
export type SongService = "spotify" | "apple" | "youtube";

export type SongRead = {
  service: SongService;
  url: string;
  title: string | null;
  artist: string | null;
  cover: string | null;
};

const SERVICES: Record<string, SongService> = {
  "open.spotify.com": "spotify",
  "music.apple.com": "apple",
  "music.youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
};

const COVER_HOSTS =
  /^https:\/\/(i\.scdn\.co|[a-z0-9-]+\.spotifycdn\.com|is[0-9]+-ssl\.mzstatic\.com|i[0-9]*\.ytimg\.com|img\.youtube\.com)\//;

export function songService(url: URL): SongService | null {
  if (url.protocol !== "https:") return null;
  return SERVICES[url.hostname.toLowerCase()] ?? null;
}

/** The link the set keeps: the song's own path, no tracking codes; YouTube keeps only `v`. */
export function cleanSongUrl(url: URL, service: SongService): string {
  const host = url.hostname.toLowerCase();
  if (service === "youtube") {
    const id =
      host === "youtu.be"
        ? url.pathname.replace(/^\//, "").split("/")[0]
        : url.searchParams.get("v");
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return host === "music.youtube.com"
        ? `https://music.youtube.com/watch?v=${id}`
        : `https://www.youtube.com/watch?v=${id}`;
    }
    return `https://${host}${url.pathname}`;
  }
  if (service === "apple") {
    // An Apple Music link to one song carries its id as `?i=`; keep that one, drop the rest.
    const i = url.searchParams.get("i");
    return `https://music.apple.com${url.pathname}${i && /^\d+$/.test(i) ? `?i=${i}` : ""}`;
  }
  return `https://open.spotify.com${url.pathname}`;
}

/** The oEmbed address for the services that have one; null for Apple Music, which does not. */
export function oembedUrl(clean: string, service: SongService): string | null {
  if (service === "spotify")
    return `https://open.spotify.com/oembed?url=${encodeURIComponent(clean)}`;
  if (service === "youtube") {
    const watch = clean.replace("https://music.youtube.com/", "https://www.youtube.com/");
    return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`;
  }
  return null;
}

/** A cover is kept only when it comes from the services' own picture hosts. */
export function coverAllowed(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  return COVER_HOSTS.test(trimmed) && trimmed.length <= 500 ? trimmed : null;
}

/** What an oEmbed answer says (Spotify: title and cover; YouTube: title, channel and cover). */
export function readOembed(json: unknown, service: SongService): Partial<SongRead> {
  if (!json || typeof json !== "object") return {};
  const j = json as Record<string, unknown>;
  const title = tidy(j["title"]);
  const cover = coverAllowed(typeof j["thumbnail_url"] === "string" ? j["thumbnail_url"] : null);
  const author = tidy(j["author_name"]);
  const out: Partial<SongRead> = {};
  if (title) out.title = title;
  if (cover) out.cover = cover;
  // A YouTube channel is the artist more often than not: "Artist - Topic", "ArtistVEVO".
  if (service === "youtube" && author) out.artist = tidyChannel(author);
  return out;
}

/** What the page's own tags say. Spotify and Apple Music write the artist into the description or the title. */
export function readSongPage(html: string, service: SongService): Partial<SongRead> {
  const meta = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = tag[0];
    const name = attrs.match(/(?:property|name)=["']([^"']+)["']/i)?.[1];
    const content = attrs.match(/content=["']([^"']*)["']/i)?.[1];
    if (name && content != null && !meta.has(name.toLowerCase()))
      meta.set(name.toLowerCase(), decodeEntities(content));
  }
  const out: Partial<SongRead> = {};
  const ogTitle =
    tidy(meta.get("og:title")) ?? tidy(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const description = tidy(meta.get("og:description")) ?? "";
  const cover = coverAllowed(meta.get("og:image") ?? null);
  if (cover) out.cover = cover;
  if (!ogTitle) return out;

  if (service === "apple") {
    // "Song by Artist on Apple Music" · "Song - Single by Artist on Apple Music" · "Album by Artist".
    const t = ogTitle.replace(/\s+(on|-|–|\|)\s+Apple Music\s*$/i, "");
    const by = t.match(/^(.*?)\s+by\s+(.+)$/i);
    if (by) {
      out.title = tidy(by[1]?.replace(/\s+-\s+(Single|EP)$/i, "")) ?? null;
      out.artist = tidy(by[2]) ?? null;
    } else out.title = t;
    return out;
  }
  if (service === "spotify") {
    out.title = ogTitle;
    // "Artist · Song · 2024" for a track; "Artist · Album · 2024 · 12 songs" for an album.
    const first = description.split(/\s+·\s+/)[0];
    if (first && first !== ogTitle) out.artist = tidy(first) ?? null;
    return out;
  }
  out.title = ogTitle.replace(/\s+-\s+YouTube( Music)?$/i, "");
  return out;
}

function tidy(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.replace(/\s+/g, " ").trim();
  return t.length > 0 ? t.slice(0, 120) : undefined;
}

function tidyChannel(name: string): string {
  return name
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\s*\(Official\)$/i, "")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}
