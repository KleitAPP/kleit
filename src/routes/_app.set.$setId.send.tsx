import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, PrimaryButton } from "@/components/kleit";
import { supabase } from "@/integrations/supabase/client";
import { refreshPreview, autoTitle, loadSet, type Placement, type SetSummary } from "@/sets/sets";
import { t } from "@/i18n/en";
import { parseTags } from "@/search/search";
import { siteUrl } from "@/lib/site";

/**
 * S46 Publish and S47 Send, as one screen (design pack W10, W11; spec 5.2, 7.1; decision 5).
 *
 * Publishing is one tap: the title is written for you from the pieces, and "who can see it" is
 * shown as a plain line with a one-tap switch - "Public — anyone can see this · Change" -
 * because new sets are public by default and that has to be said out loud, not assumed.
 *
 * The link is `/s/<code>`, served by the share Worker (M3.9) for people with no account. Until
 * that exists the link opens the signed-in set page (M3.4). The code itself is the database's:
 * 95 random bits, and only "Reset share link" changes it.
 *
 * Sending is the phone's own share sheet when there is one (`navigator.share`), and Copy link
 * everywhere. Nothing is sent by us: a set goes wherever the person sends it.
 */
export const Route = createFileRoute("/_app/set/$setId/send")({
  head: () => ({ meta: [{ title: "Send" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: SendSet,
});

type Visibility = SetSummary["visibility"];

const VISIBILITY: ReadonlyArray<{ id: Visibility; label: string; why: string }> = [
  { id: "public", label: t("vis.public"), why: t("vis.publicWhy") },
  { id: "link", label: t("vis.link"), why: t("vis.linkWhy") },
  { id: "followers", label: t("vis.followers"), why: t("vis.followersWhy") },
  { id: "friends", label: t("vis.friends"), why: t("vis.friendsWhy") },
  { id: "only_me", label: t("vis.onlyMe"), why: t("vis.onlyMeWhy") },
];

function SendSet() {
  const { setId } = Route.useParams();
  const [set, setSet] = useState<SetSummary | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [altText, setAltText] = useState("");
  const [tagText, setTagText] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadSet(setId);
      if (cancelled) return;
      if (!loaded) {
        setMissing(true);
        return;
      }
      setSet(loaded.set);
      setPlacements(loaded.placements);
      setTitle(loaded.set.title || autoTitle(loaded.placements));
      setTagText((loaded.set.tags ?? []).join(", "));
    })();
    return () => {
      cancelled = true;
    };
  }, [setId]);

  if (missing) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("builder.notFound")} />
      </div>
    );
  }
  if (!set) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8" role="status" aria-label={t("loading")}>
        <div className="kl-skeleton h-40 w-full rounded-md bg-surface-2" />
      </div>
    );
  }

  const link = siteUrl(`/s/${set.share_code}`);
  const chosen = VISIBILITY.find((v) => v.id === set.visibility) ?? VISIBILITY[0]!;

  async function publish() {
    if (!set) return;
    setBusy(true);
    setProblem(null);
    const { error } = await supabase
      .from("sets")
      .update({ title: title.trim().slice(0, 80) || autoTitle(placements), status: "published" })
      .eq("id", set.id);
    setBusy(false);
    if (error) {
      setProblem(t("send.publishFailed"));
      return;
    }
    setSet({ ...set, status: "published", title: title.trim() || autoTitle(placements) });
    refreshPreview(set.id);
  }

  async function saveTags() {
    if (!set) return;
    const tags = parseTags(tagText);
    const { error } = await supabase.from("sets").update({ tags }).eq("id", set.id);
    if (!error) setTagText(tags.join(", "));
  }

  async function saveAltText() {
    if (!set) return;
    await supabase
      .from("sets")
      .update({ alt_text: altText.trim() || null })
      .eq("id", set.id);
  }

  async function changeVisibility(next: Visibility) {
    if (!set) return;
    const { error } = await supabase.from("sets").update({ visibility: next }).eq("id", set.id);
    if (!error) {
      setSet({ ...set, visibility: next });
      refreshPreview(set.id); // a public picture only for a public or link set; taken down otherwise
    }
    setChanging(false);
  }

  async function share() {
    const text = set?.title || autoTitle(placements);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: text, url: link });
        return;
      }
    } catch {
      /* the person closed the sheet; nothing to do */
    }
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setProblem(t("send.copyFailed"));
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">
        {set.status === "published" ? t("send.title") : t("send.publishTitle")}
      </h1>

      <label className="mt-6 block">
        <span className="text-sm text-ink-soft">{t("send.setTitle")}</span>
        <input
          type="text"
          maxLength={80}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-sm text-ink-soft">{t("send.tags")}</span>
        <input
          type="text"
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          onBlur={() => void saveTags()}
          placeholder={t("send.tagsHint")}
          className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
        />
      </label>

      {/* G5: alt text lives under Advanced - offered, never in the way. */}
      <details className="mt-4 rounded-md border border-line bg-surface p-3">
        <summary className="cursor-pointer text-base text-ink">{t("send.advanced")}</summary>
        <label className="mt-3 block">
          <span className="text-sm text-ink-soft">{t("send.altText")}</span>
          <input
            type="text"
            maxLength={300}
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            onBlur={() => void saveAltText()}
            placeholder={t("send.altHint")}
            className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        </label>
      </details>

      {/* Decision 5: a plain line with a one-tap switch. */}
      <div className="mt-4 rounded-md border border-line bg-surface p-3">
        <p className="text-base text-ink">
          {chosen.label} — {chosen.why}
          {" · "}
          <button type="button" onClick={() => setChanging(!changing)} className="underline">
            {t("send.change")}
          </button>
        </p>
        {changing ? (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("send.whoCanSee")}>
            {VISIBILITY.map((v) => (
              <Chip
                key={v.id}
                label={v.label}
                selected={v.id === set.visibility}
                onToggle={() => void changeVisibility(v.id)}
              />
            ))}
          </div>
        ) : null}
        {set.visibility === "link" ? (
          <p className="mt-2 text-sm text-ink-soft">{t("send.linkWarning")}</p>
        ) : null}
      </div>

      {problem ? (
        <p role="alert" className="mt-4 text-base text-ink">
          {problem}
        </p>
      ) : null}

      {set.status !== "published" ? (
        <div className="mt-6">
          <PrimaryButton onClick={() => void publish()} disabled={busy || placements.length === 0}>
            {busy ? t("loading") : t("send.publish")}
          </PrimaryButton>
          <Link
            to="/set/$setId/edit"
            params={{ setId }}
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            {t("send.keepEditing")}
          </Link>
        </div>
      ) : (
        <div className="mt-6">
          <p
            className="truncate rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink"
            aria-label={t("send.theLink")}
          >
            {link}
          </p>
          <div className="mt-3">
            <PrimaryButton onClick={() => void share()}>{t("send.send")}</PrimaryButton>
          </div>
          <button
            type="button"
            onClick={() => void copy()}
            className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            {copied ? t("send.copied") : t("send.copyLink")}
          </button>
          <p className="mt-3 text-sm text-ink-soft">{t("disclosure.commission")}</p>
          <Link
            to="/set/$setId/edit"
            params={{ setId }}
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            {t("send.keepEditing")}
          </Link>
        </div>
      )}
    </div>
  );
}
