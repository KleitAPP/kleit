/**
 * Proves the song card's reader with no network (spec 11 #12; migration 091): which links are a
 * service and which are not, what the kept link looks like, what an oEmbed answer and a page's
 * own tags give, and that a cover is kept only from the services' own picture hosts.
 *
 * Run: bun scripts/check-song-page.ts   (CI runs it on every push)
 */
import { readFileSync } from "node:fs";

import {
  cleanSongUrl,
  coverAllowed,
  oembedUrl,
  readOembed,
  readSongPage,
  songService,
  SONG_URL_SHAPE,
} from "../supabase/functions/_shared/song-page.ts";

let failed = 0;
function check(ok: boolean, what: string, detail = "") {
  console.log(`${ok ? "ok" : "not ok"} - ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
}

// 1. Which links are a song.
check(
  songService(new URL("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc")) ===
    "spotify",
  "a Spotify track is Spotify",
);
check(
  songService(new URL("https://music.apple.com/us/album/song/123?i=456")) === "apple",
  "an Apple Music song is Apple",
);
check(
  songService(new URL("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x")) === "youtube",
  "a YouTube Music link is YouTube",
);
check(
  songService(new URL("https://youtu.be/dQw4w9WgXcQ")) === "youtube",
  "a youtu.be link is YouTube",
);
check(
  songService(new URL("http://open.spotify.com/track/abc")) === null,
  "plain http is not accepted",
);
check(
  songService(new URL("https://evil.example/open.spotify.com/track/abc")) === null,
  "another host is not a service",
);
check(
  songService(new URL("https://open.spotify.com.evil.example/track/abc")) === null,
  "a look-alike host is not a service",
);

// 2. The kept link.
check(
  cleanSongUrl(
    new URL("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc&utm_source=x"),
    "spotify",
  ) === "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
  "Spotify: the track path stays, the tracking goes",
);
check(
  cleanSongUrl(
    new URL("https://music.apple.com/us/album/after-hours/1499378108?i=1499378615&ls=1"),
    "apple",
  ) === "https://music.apple.com/us/album/after-hours/1499378108?i=1499378615",
  "Apple Music: the song id stays, the rest goes",
);
check(
  cleanSongUrl(new URL("https://youtu.be/dQw4w9WgXcQ?t=43"), "youtube") ===
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "youtu.be becomes a watch link with only the id",
);
check(
  cleanSongUrl(
    new URL("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD&feature=share"),
    "youtube",
  ) === "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
  "YouTube Music keeps its own host and only the id",
);
check(
  cleanSongUrl(
    new URL("https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC/"),
    "spotify",
  ) === "https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC",
  "Spotify: a market prefix stays, a trailing slash goes",
);
// 2b. A link on a service that is not a song is refused (migration 095): YouTube's own
// redirect page would have sent the share page's reader anywhere.
check(
  cleanSongUrl(new URL("https://www.youtube.com/redirect?q=https://evil.example"), "youtube") ===
    null,
  "YouTube: /redirect is not a song",
);
check(
  cleanSongUrl(new URL("https://www.youtube.com/@channel"), "youtube") === null,
  "YouTube: a channel is not a song",
);
check(
  cleanSongUrl(new URL("https://youtu.be/"), "youtube") === null,
  "youtu.be with no id is not a song",
);
check(
  cleanSongUrl(new URL("https://open.spotify.com/user/someone"), "spotify") === null,
  "Spotify: a person's page is not a song",
);
check(
  cleanSongUrl(new URL("https://music.apple.com/us/station/x/ra.1"), "apple") === null,
  "Apple Music: a station is not a song",
);
check(
  cleanSongUrl(
    new URL("https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb"),
    "apple",
  ) === "https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb",
  "Apple Music: a playlist is kept",
);
// The column keeps the very same shape (migration 095), so the two never drift apart.
const migration = readFileSync(
  new URL("../supabase/migrations/20261012090000_review_fixes_2.sql", import.meta.url),
  "utf8",
);
const onColumn = migration.match(/song_url ~ '([^']+)'\)/)?.[1] ?? "";
check(
  onColumn === SONG_URL_SHAPE,
  "the reader and the column keep the same shape",
  onColumn ? "" : "no constraint found",
);
check(
  oembedUrl("https://music.apple.com/us/album/x/1?i=2", "apple") === null,
  "Apple Music has no oEmbed",
);
check(
  oembedUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ", "youtube") ===
    "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
  "YouTube Music is asked through youtube.com's oEmbed",
);

// 3. Covers.
check(
  coverAllowed("https://i.scdn.co/image/ab67616d0000b273ef017e899c0547766997d874") !== null,
  "a Spotify cover is kept",
);
check(
  coverAllowed("https://is1-ssl.mzstatic.com/image/thumb/Music/1.jpg/600x600bb.jpg") !== null,
  "an Apple cover is kept",
);
check(
  coverAllowed("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg") !== null,
  "a YouTube cover is kept",
);
check(
  coverAllowed("https://evil.example/pixel.gif") === null,
  "a cover from anywhere else is dropped",
);
check(coverAllowed("http://i.scdn.co/image/abc") === null, "a plain-http cover is dropped");

// 4. oEmbed answers.
const sp = readOembed(
  {
    title: "Blinding Lights",
    thumbnail_url: "https://i.scdn.co/image/abc",
    provider_name: "Spotify",
  },
  "spotify",
);
check(
  sp.title === "Blinding Lights" &&
    sp.cover === "https://i.scdn.co/image/abc" &&
    sp.artist === undefined,
  "Spotify oEmbed: title and cover, no artist",
);
const yt = readOembed(
  {
    title: "The Weeknd - Blinding Lights (Official Video)",
    author_name: "TheWeekndVEVO",
    thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg",
  },
  "youtube",
);
check(
  yt.artist === "TheWeeknd" && yt.title?.startsWith("The Weeknd") === true,
  "YouTube oEmbed: the channel is the artist, VEVO dropped",
  yt.artist ?? "",
);
check(
  readOembed({ title: "x", author_name: "Artist - Topic" }, "youtube").artist === "Artist",
  "YouTube: a Topic channel is the artist",
);
check(Object.keys(readOembed(null, "spotify")).length === 0, "a non-answer gives nothing");

// 5. Pages.
const spotifyPage = `<html><head><meta property="og:title" content="Blinding Lights"><meta property="og:description" content="The Weeknd · Song · 2019"><meta property="og:image" content="https://i.scdn.co/image/abc"></head></html>`;
const s1 = readSongPage(spotifyPage, "spotify");
check(
  s1.title === "Blinding Lights" &&
    s1.artist === "The Weeknd" &&
    s1.cover === "https://i.scdn.co/image/abc",
  "Spotify page: title, artist from the description, cover",
);
const applePage = `<html><head><title>x</title><meta name="og:title" content="Blinding Lights by The Weeknd on Apple Music"><meta name="og:image" content="https://is1-ssl.mzstatic.com/image/thumb/a.jpg/1200x630cw.png"></head></html>`;
const a1 = readSongPage(applePage, "apple");
check(
  a1.title === "Blinding Lights" && a1.artist === "The Weeknd",
  "Apple page: title and artist from 'by'",
  `${a1.title} / ${a1.artist}`,
);
const appleSingle = `<meta property="og:title" content="After Hours - Single by The Weeknd - Apple Music">`;
const a2 = readSongPage(appleSingle, "apple");
check(
  a2.title === "After Hours" && a2.artist === "The Weeknd",
  "Apple page: '- Single' and the suffix go",
  `${a2.title} / ${a2.artist}`,
);
const ytPage = `<meta property="og:title" content="Blinding Lights - YouTube Music"><meta property="og:image" content="https://evil.example/x.jpg">`;
const y1 = readSongPage(ytPage, "youtube");
check(
  y1.title === "Blinding Lights" && y1.cover === undefined,
  "YouTube page: the suffix goes, a foreign cover is dropped",
);
check(readSongPage("<html></html>", "spotify").title === undefined, "an empty page gives no title");
const entity = `<meta property="og:title" content="Don&#39;t Stop Me Now"><meta property="og:description" content="Queen &amp; Co · Song · 1978">`;
const e1 = readSongPage(entity, "spotify");
check(e1.title === "Don't Stop Me Now" && e1.artist === "Queen & Co", "entities are decoded");

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nsong-page checks passed");
