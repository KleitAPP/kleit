import { supabase } from "@/integrations/supabase/client";
import { t } from "@/i18n/en";

/**
 * The song card (spec 11 #12; design pack G1; migration 091): "the vibe" on a set - a title, an
 * artist and a cover that open the song in Spotify, Apple Music or YouTube Music. No audio ever
 * plays in the app. The link is read by `clip-url` (action `song`), the person corrects the
 * words, and the set keeps the four columns; the database holds the rules on what a link and
 * a cover may be.
 */
export type SongService = "spotify" | "apple" | "youtube";

export type Song = {
  url: string;
  title: string;
  artist: string | null;
  cover: string | null;
};

export type SongProblem = "bad-url" | "not-a-service" | "unreadable" | "signed-out" | "offline";

export function songService(url: string): SongService | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "open.spotify.com") return "spotify";
    if (host === "music.apple.com") return "apple";
    if (host.endsWith("youtube.com") || host === "youtu.be") return "youtube";
    return null;
  } catch {
    return null;
  }
}

/** "Open in Spotify", in the service's own name. */
export function openInLabel(url: string): string {
  switch (songService(url)) {
    case "spotify":
      return t("song.openSpotify");
    case "apple":
      return t("song.openApple");
    case "youtube":
      return t("song.openYouTube");
    default:
      return t("song.open");
  }
}

/** Ask the server to read a song link. Nothing is stored. */
export async function readSong(
  url: string,
): Promise<{ ok: true; song: Song } | { ok: false; problem: SongProblem }> {
  try {
    const { data, error } = await supabase.functions.invoke("clip-url", {
      body: { action: "song", url },
    });
    if (error) {
      const context = (error as { context?: Response })?.context;
      let problem: SongProblem = "unreadable";
      if (context && typeof context.json === "function") {
        try {
          const body = (await context.clone().json()) as { problem?: string };
          if (body.problem === "bad-url" || body.problem === "not-public") problem = "bad-url";
          else if (body.problem === "not-a-service") problem = "not-a-service";
          else if (body.problem === "signed-out") problem = "signed-out";
        } catch {
          /* the shape is the message */
        }
      }
      return { ok: false, problem };
    }
    const song = (data as { song?: Partial<Song> } | null)?.song;
    if (!song || typeof song.url !== "string" || typeof song.title !== "string")
      return { ok: false, problem: "unreadable" };
    return {
      ok: true,
      song: {
        url: song.url,
        title: song.title,
        artist: typeof song.artist === "string" ? song.artist : null,
        cover: typeof song.cover === "string" ? song.cover : null,
      },
    };
  } catch {
    return { ok: false, problem: "offline" };
  }
}

/** Keep a song on the set (or take it off with null). The owner's own write; the rules are the database's. */
export async function saveSong(setId: string, song: Song | null): Promise<boolean> {
  const { error } = await supabase
    .from("sets")
    .update({
      song_url: song?.url ?? null,
      song_title: song ? song.title.trim().slice(0, 120) || null : null,
      song_artist: song?.artist?.trim().slice(0, 120) || null,
      song_cover_url: song?.cover ?? null,
    })
    .eq("id", setId);
  return !error;
}
