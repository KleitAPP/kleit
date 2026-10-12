import { useState } from "react";

import { PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";

import { readSong, saveSong, type Song, type SongProblem } from "./song";

/**
 * The song sheet (spec 11 #12): paste a Spotify, Apple Music or YouTube Music link, see what it
 * says, fix the words, keep it on the set - or take the song off. No audio plays anywhere.
 */
export function SongSheet({
  setId,
  song,
  open,
  onOpenChange,
  onSaved,
}: {
  setId: string;
  song: Song | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (song: Song | null) => void;
}) {
  const [link, setLink] = useState("");
  const [found, setFound] = useState<Song | null>(null);
  const [problem, setProblem] = useState<SongProblem | "failed" | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    if (busy || link.trim().length < 8) return;
    setBusy(true);
    setProblem(null);
    const r = await readSong(link);
    setBusy(false);
    if (!r.ok) {
      setProblem(r.problem);
      return;
    }
    setFound(r.song);
  }

  async function keep(next: Song | null) {
    if (busy) return;
    setBusy(true);
    const ok = await saveSong(setId, next);
    setBusy(false);
    if (!ok) {
      setProblem("failed");
      return;
    }
    setFound(null);
    setLink("");
    onSaved(next);
    onOpenChange(false);
  }

  const card = found ?? song;
  const editing = found !== null;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setFound(null);
          setProblem(null);
        }
        onOpenChange(o);
      }}
      title={t("song.title")}
      description={t("song.why")}
      action={
        editing && found ? (
          <PrimaryButton onClick={() => void keep(found)} disabled={busy || !found.title.trim()}>
            {song ? t("song.replace") : t("song.add")}
          </PrimaryButton>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="text-sm text-ink-soft">{t("song.link")}</span>
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={t("song.linkPlaceholder")}
            className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        </label>
        <button
          type="button"
          onClick={() => void find()}
          disabled={busy || link.trim().length < 8}
          className="min-h-11 self-start rounded-pill border border-line bg-surface px-4 text-sm text-ink disabled:opacity-50"
        >
          {busy && !found ? t("song.finding") : t("song.find")}
        </button>
        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {t(`song.problem.${problem}`)}
          </p>
        ) : null}

        {card ? (
          <div className="rounded-md border border-line bg-surface p-3">
            <div className="flex items-center gap-3">
              <span className="size-14 shrink-0 overflow-hidden rounded-sm bg-surface-2">
                {card.cover ? (
                  <img src={card.cover} alt="" className="size-full object-cover" />
                ) : null}
              </span>
              {editing && found ? (
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <input
                    type="text"
                    value={found.title}
                    maxLength={120}
                    aria-label={t("song.songTitle")}
                    onChange={(e) => setFound({ ...found, title: e.target.value })}
                    className="min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
                  />
                  <input
                    type="text"
                    value={found.artist ?? ""}
                    maxLength={120}
                    aria-label={t("song.artist")}
                    placeholder={t("song.artist")}
                    onChange={(e) => setFound({ ...found, artist: e.target.value || null })}
                    className="min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
                  />
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base text-ink">{card.title || "…"}</p>
                  {card.artist ? (
                    <p className="truncate text-sm text-ink-soft">{card.artist}</p>
                  ) : null}
                </div>
              )}
            </div>
            {!editing && song ? (
              <button
                type="button"
                onClick={() => void keep(null)}
                disabled={busy}
                className="mt-3 min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
              >
                {t("song.remove")}
              </button>
            ) : null}
          </div>
        ) : null}
        <p className="text-sm text-ink-soft">{t("song.noAudio")}</p>
      </div>
    </Sheet>
  );
}
