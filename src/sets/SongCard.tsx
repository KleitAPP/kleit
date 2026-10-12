import { t } from "@/i18n/en";

import { openInLabel, type Song } from "./song";

/** The song card on a set (spec 11 #12): cover, title, artist, and a link that opens the service. Never audio. */
export function SongCard({ song }: { song: Song }) {
  return (
    <a
      href={song.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 flex items-center gap-3 rounded-md border border-line bg-surface p-3 transition-colors duration-fast hover:bg-surface-2"
      title={openInLabel(song.url)}
    >
      <span className="size-12 shrink-0 overflow-hidden rounded-sm bg-surface-2">
        {song.cover ? (
          <img src={song.cover} alt="" className="size-full object-cover" loading="lazy" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base text-ink">{song.title || "…"}</span>
        <span className="block truncate text-sm text-ink-soft">
          {song.artist ? `${song.artist} · ` : ""}
          {openInLabel(song.url)}
        </span>
      </span>
    </a>
  );
}
