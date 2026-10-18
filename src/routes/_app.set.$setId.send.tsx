import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, PrimaryButton } from "@/components/kleit";
import { supabase } from "@/integrations/supabase/client";
import {
  refreshPreview,
  autoAltText,
  autoTitle,
  loadSet,
  type Placement,
  type SetSummary,
} from "@/sets/sets";
import { t } from "@/i18n/en";
import { parseTags } from "@/search/search";
import { siteUrl } from "@/lib/site";
import { noteSetSent } from "@/native/review";
import { needsPrimer, usePermissionPrimer } from "@/native/primers";
import { askPhoneForPush, savePushSetting } from "@/native/push";
import { saveSetImage, type SaveImageShape } from "@/sets/saveImage";
import { peopleOnSet, tagPerson, untag, type TaggedPerson } from "@/sets/tags";

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
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [altText, setAltText] = useState("");
  const [savedAlt, setSavedAlt] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [choosingSize, setChoosingSize] = useState(false);
  const [tagText, setTagText] = useState("");
  // People in the set (spec 7.4): named by username; a tag waits for them unless they follow you.
  const [people, setPeople] = useState<TaggedPerson[]>([]);
  const [personText, setPersonText] = useState("");
  const [personNote, setPersonNote] = useState<string | null>(null);

  // Spec 3.4 #4: the one right moment to ask for notifications is just after the first send -
  // "Get told when friends vote". The primer says why; the phone's own prompt follows a yes.
  // On the web, or once the primer has been shown, nothing happens here.
  const pushPrimer = usePermissionPrimer("notifications", () => {
    void (async () => {
      if (await askPhoneForPush()) await savePushSetting(true);
    })();
  });
  function afterSend() {
    void noteSetSent(); // S107: the third set sent may ask for a rating, once, on a phone
    if (needsPrimer("notifications")) window.setTimeout(() => pushPrimer.ask(), 600);
  }

  useEffect(() => {
    let cancelled = false;
    void peopleOnSet(setId).then((list) => {
      if (!cancelled) setPeople(list);
    });
    return () => {
      cancelled = true;
    };
  }, [setId]);

  async function addPerson() {
    const name = personText.trim();
    if (!name) return;
    setPersonNote(null);
    const result = await tagPerson(setId, name);
    if (!result.ok) {
      setPersonNote(
        result.problem === "no-such-person"
          ? t("send.tagNobody")
          : result.problem === "refused"
            ? t("send.tagRefused")
            : result.problem === "cant-see"
              ? t("send.tagCantSee")
              : t("send.tagFailed"),
      );
      return;
    }
    setPeople((list) => [
      ...list.filter((p) => p.user_id !== result.person.user_id),
      result.person,
    ]);
    setPersonText("");
  }

  async function removePerson(userId: string) {
    if (await untag(setId, userId)) setPeople((list) => list.filter((p) => p.user_id !== userId));
  }

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
      // G5: alt text is written for you from the pieces and only ever a starting point. The row
      // holds null while it is still the written-for-you line (so it follows the pieces and the
      // share page writes it fresh each time), and the person's own words once they change it;
      // an empty field goes back to the written one, never to nothing (6.6 #1).
      setSavedAlt(loaded.set.alt_text ?? null);
      setAltText(loaded.set.alt_text ?? autoAltText(loaded.placements));
      setDescription(loaded.set.description ?? "");
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
      .update({
        title: title.trim().slice(0, 80) || autoTitle(placements),
        status: "published",
        alt_text: ownAltText(),
        description: description.trim().slice(0, 1000),
      })
      .eq("id", set.id);
    setBusy(false);
    if (error) {
      setProblem(
        (error as { code?: string }).code === "P0006"
          ? t("screen.noContact")
          : t("send.publishFailed"),
      );
      return;
    }
    setSet({
      ...set,
      status: "published",
      title: title.trim() || autoTitle(placements),
      description: description.trim().slice(0, 1000),
    });
    refreshPreview(set.id);
  }

  async function saveTags() {
    if (!set) return;
    const tags = parseTags(tagText);
    const { error } = await supabase.from("sets").update({ tags }).eq("id", set.id);
    if (!error) setTagText(tags.join(", "));
  }

  /** The person's own alt text, or null while the field still says what was written for them. */
  function ownAltText(): string | null {
    const typed = altText.trim().slice(0, 300);
    return typed && typed !== autoAltText(placements) ? typed : null;
  }

  async function saveAltText() {
    if (!set) return;
    const next = ownAltText();
    if (!altText.trim()) setAltText(autoAltText(placements));
    if (next === savedAlt) return;
    const { error } = await supabase.from("sets").update({ alt_text: next }).eq("id", set.id);
    if (!error) setSavedAlt(next);
    else if ((error as { code?: string }).code === "P0006") setProblem(t("screen.noContact"));
  }

  async function saveDescription() {
    if (!set) return;
    const next = description.trim().slice(0, 1000);
    if (next === (set.description ?? "")) return;
    const { error } = await supabase.from("sets").update({ description: next }).eq("id", set.id);
    if (!error) {
      setSet({ ...set, description: next });
      setProblem(null);
    } else if ((error as { code?: string }).code === "P0006") setProblem(t("screen.noContact"));
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
        afterSend();
        return;
      }
    } catch {
      /* the person closed the sheet; nothing to do */
    }
    await copy();
  }

  /** S47: the chat picture, to the share sheet or the downloads (drawn a moment after publish). */
  async function saveImage(shape: SaveImageShape) {
    if (saving) return;
    setChoosingSize(false);
    setSaving(true);
    setNote(null);
    const r = await saveSetImage(setId, set?.title || autoTitle(placements), shape);
    setSaving(false);
    if (r === "not-yet") setNote(t("send.imageNotYet"));
    else if (r === "failed") setNote(t("send.imageFailed"));
  }

  /** 6.6 #3: Pinterest has a plain share address; Instagram and TikTok only take the share sheet. */
  function pinterest() {
    const params = new URLSearchParams({
      url: link,
      description: set?.title || autoTitle(placements),
    });
    window.open(
      `https://www.pinterest.com/pin/create/button/?${params.toString()}`,
      "_blank",
      "noopener",
    );
    afterSend();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      afterSend();
    } catch {
      setProblem(t("send.copyFailed"));
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      {pushPrimer.sheet}
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
        <span className="text-sm text-ink-soft">{t("send.description")}</span>
        <textarea
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => void saveDescription()}
          placeholder={t("send.descriptionHint")}
          className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink"
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

      <div className="mt-4">
        <span className="text-sm text-ink-soft">{t("send.people")}</span>
        <form
          className="mt-1 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addPerson();
          }}
        >
          <input
            type="text"
            value={personText}
            onChange={(e) => setPersonText(e.target.value)}
            placeholder={t("send.peopleHint")}
            aria-label={t("send.people")}
            autoCapitalize="none"
            autoCorrect="off"
            className="min-h-12 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
          <button
            type="submit"
            disabled={!personText.trim()}
            className="min-h-12 shrink-0 rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
          >
            {t("send.tagAdd")}
          </button>
        </form>
        {people.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {people.map((p) => (
              <li key={p.user_id}>
                <button
                  type="button"
                  onClick={() => void removePerson(p.user_id)}
                  aria-label={t("send.tagRemove", { name: p.username })}
                  className="flex min-h-10 items-center gap-1 rounded-pill border border-line bg-surface px-3 text-sm text-ink"
                >
                  @{p.username}
                  {p.state === "pending" ? (
                    <span className="text-ink-soft"> · {t("send.tagWaiting")}</span>
                  ) : null}
                  <span aria-hidden="true" className="ml-1 text-ink-soft">
                    ×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {personNote ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {personNote}
          </p>
        ) : null}
        <p className="mt-1 text-sm text-ink-soft">{t("send.peopleWhy")}</p>
      </div>

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
        {set.status === "published" && set.visibility !== "public" && set.visibility !== "link" ? (
          <p className="mt-2 text-sm text-ink-soft">{t("send.privateWarning")}</p>
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
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setChoosingSize(!choosingSize)}
              disabled={saving}
              aria-expanded={choosingSize}
              className="min-h-12 rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-50"
            >
              {saving ? t("send.savingImage") : t("send.saveImage")}
            </button>
            <Link
              to="/poll/new"
              search={{ set: setId }}
              className="flex min-h-12 items-center justify-center rounded-pill border border-line bg-surface px-4 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
            >
              {t("send.makePoll")}
            </Link>
          </div>
          {choosingSize ? (
            <div
              className="mt-2 flex flex-wrap gap-2"
              role="group"
              aria-label={t("send.saveImage")}
            >
              <Chip label={t("send.sizeChat")} onToggle={() => void saveImage("chat")} />
              <Chip label={t("send.sizeStory")} onToggle={() => void saveImage("story")} />
              <Chip label={t("send.sizePost")} onToggle={() => void saveImage("post")} />
            </div>
          ) : null}
          {note ? (
            <p role="status" className="mt-2 text-sm text-ink-soft">
              {note}
            </p>
          ) : null}
          <button
            type="button"
            onClick={pinterest}
            className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            {t("send.pinterest")}
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
