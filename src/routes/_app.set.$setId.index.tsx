import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { supabase } from "@/integrations/supabase/client";
import {
  buyUrlFor,
  imageUrlFor,
  priceLabel,
  saveItem,
  savedItemIds,
  unsaveItem,
  type ItemSummary,
  myScanStates,
  type ScanState,
} from "@/items/items";
import { Heart } from "lucide-react";
import {
  autoTitle,
  deleteSet,
  loadSet,
  remixSet,
  setRemixMode,
  startFromStyle,
  templates,
  type Placement,
  type RemixMode,
  type SetSummary,
  type Template,
  refreshPreview,
} from "@/sets/sets";
import { inkFor } from "@/sets/swatches";
import { approveTag, peopleOnSet, untag, type TaggedPerson } from "@/sets/tags";
import { featureSet } from "@/contests/contests";
import { myRoles } from "@/safety/moderation";
import { CreativeView } from "@/canvas/CreativeView";
import { SaveToCollection } from "@/collections/SaveToCollection";
import { t } from "@/i18n/en";
import { siteUrl } from "@/lib/site";
import { ReportButton } from "@/safety/ReportButton";
import { setCommentsSetting, type CommentsSetting } from "@/social/comments";
import { AccountLabelChip } from "@/social/AccountLabel";
import { asAccountLabel, type AccountLabel } from "@/social/labels";
import { SocialBar } from "@/social/SocialBar";
import { SongCard } from "@/sets/SongCard";
import { SongSheet } from "@/sets/SongSheet";
import { TemplateDressing } from "@/templates/TemplateDressing";

/**
 * S48 — the set page, signed in, and S49 — its options (design pack §2.3, W13; spec 5, 7).
 *
 * What you see here is what the row policy let through: your own set in any state, or someone
 * else's that `can_view_set` allows. The pieces come with their price or OWN tag and a Buy that
 * goes through the redirect with this set's id, so a tap from here is counted against the set.
 *
 * The "…" options for the owner: Edit · Who can see it · Reset share link · Version history ·
 * Delete. Two of those get a plain warning before they happen (design pack G6): resetting the
 * link kills every copy already sent, and deleting hides the set for 30 days then removes it.
 * Comments, likes and remix arrive with the social milestone, and the page says so rather than
 * showing dead buttons.
 */
export const Route = createFileRoute("/_app/set/$setId/")({
  head: () => ({ meta: [{ title: "Set" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: SetPage,
});

type Visibility = SetSummary["visibility"];
const VISIBILITY: ReadonlyArray<{ id: Visibility; label: string }> = [
  { id: "public", label: t("vis.public") },
  { id: "link", label: t("vis.link") },
  { id: "followers", label: t("vis.followers") },
  { id: "friends", label: t("vis.friends") },
  { id: "only_me", label: t("vis.onlyMe") },
];

function SetPage() {
  const { setId } = Route.useParams();
  const navigate = useNavigate();
  const [set, setSet] = useState<SetSummary | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [template, setTemplate] = useState<Template | null>(null);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [states, setStates] = useState<Map<string, ScanState>>(new Map());
  const [mine, setMine] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  /** Who made it (spec 11 #9: with their label), for the line under the title. */
  const [creator, setCreator] = useState<{ username: string; label: AccountLabel } | null>(null);
  const [commentsSetting, setCommentsSettingState] = useState<CommentsSetting>("everyone");
  const [missing, setMissing] = useState(false);
  const [options, setOptions] = useState(false);
  const [songSheet, setSongSheet] = useState(false);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [remixing, setRemixing] = useState(false);
  const [styling, setStyling] = useState(false);
  // People tagged in the set (spec 7.4): approved for everyone; waiting ones for the owner and
  // the person themselves, who can say yes or take themselves off.
  const [people, setPeople] = useState<TaggedPerson[]>([]);
  // Hearting a store piece from someone's set (S39): which of these you already saved.
  const [saved, setSaved] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = placements.filter((p) => p.item.kind === "product").map((p) => p.item.id);
    if (ids.length === 0) return;
    let cancelled = false;
    void savedItemIds(ids).then((s) => {
      if (!cancelled) setSaved(s);
    });
    return () => {
      cancelled = true;
    };
  }, [placements]);
  async function toggleSaved(itemId: string) {
    const on = !saved.has(itemId);
    const ok = on ? await saveItem(itemId) : await unsaveItem(itemId);
    if (!ok) return;
    setSaved((prev) => {
      const next = new Set(prev);
      if (on) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }
  // An admin may put a public set on Home's Featured, or take it off (S90, spec 4.7 #1.3).
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void myRoles().then((r) => {
      if (!cancelled) setAdmin(r.includes("admin"));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  async function toggleFeatured() {
    if (!set) return;
    const on = !set.featured_at;
    if (await featureSet(set.id, on))
      setSet({ ...set, featured_at: on ? new Date().toISOString() : null });
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
  const myTag = me ? people.find((p) => p.user_id === me) : undefined;

  async function sayYesToTag() {
    if (await approveTag(setId))
      setPeople((list) => list.map((p) => (p.user_id === me ? { ...p, state: "approved" } : p)));
  }
  async function removeMe() {
    if (me && (await untag(setId, me))) setPeople((list) => list.filter((p) => p.user_id !== me));
  }

  /** "Use this set's style" (spec 6.4 #4): the look without the pieces, as a draft of yours. */
  async function useStyle() {
    if (!set || styling) return;
    setStyling(true);
    const result = await startFromStyle(set.id);
    if (!result) {
      setStyling(false);
      setNotice(t("setpage.styleFailed"));
      return;
    }
    void navigate({
      to: result.creative ? "/set/$setId/canvas" : "/set/$setId/edit",
      params: { setId: result.id },
    });
  }

  /** Remix (spec 7.4): a new draft of yours, credited; then straight into the editor. */
  async function remix() {
    if (!set || remixing) return;
    setRemixing(true);
    setNotice(t("setpage.remixing"));
    const result = await remixSet(set.id);
    if (!result.ok) {
      setRemixing(false);
      setNotice(
        result.problem === "off"
          ? t("setpage.remixOff")
          : result.problem === "followers"
            ? t("setpage.remixFollowers")
            : t("setpage.remixFailed"),
      );
      return;
    }
    const go = () =>
      void navigate({
        to: result.creative ? "/set/$setId/canvas" : "/set/$setId/edit",
        params: { setId: result.id },
      });
    if (result.skipped > 0) {
      setNotice(t("setpage.remixSkipped", { count: result.skipped }));
      window.setTimeout(go, 1800);
    } else go();
  }

  async function chooseRemixMode(mode: RemixMode) {
    if (!set) return;
    if (await setRemixMode(set.id, mode)) setSet({ ...set, remix_mode: mode });
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loaded, tpls, who] = await Promise.all([
        loadSet(setId),
        templates(),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      if (!loaded) {
        setMissing(true);
        return;
      }
      setSet(loaded.set);
      setPlacements(loaded.placements);
      setTemplate(tpls.find((tpl) => tpl.id === loaded.set.layout.template) ?? tpls[0] ?? null);
      // Your own pieces' screening states: a piece not yet cleared shows no Buy (the door says no).
      void myScanStates(loaded.placements.map((p) => p.item.id)).then((found) => {
        if (!cancelled) setStates(found);
      });
      const { data: owner } = await supabase
        .from("sets")
        .select("owner_id")
        .eq("id", setId)
        .maybeSingle();
      setMine(!!owner && owner.owner_id === who.data.user?.id);
      setMe(who.data.user?.id ?? null);
      if (owner) {
        const { data: by } = await supabase
          .from("profiles")
          .select("username, label")
          .eq("user_id", owner.owner_id)
          .maybeSingle();
        setCreator(by ? { username: by.username, label: asAccountLabel(by.label) } : null);
      }
      const { data: cs } = await supabase
        .from("sets")
        .select("comments_setting")
        .eq("id", setId)
        .maybeSingle();
      if (cs && ["everyone", "following", "off"].includes(cs.comments_setting))
        setCommentsSettingState(cs.comments_setting as CommentsSetting);
      const urls: Record<string, string | null> = {};
      await Promise.all(
        loaded.placements.map(async (p) => {
          urls[p.item.id] = await imageUrlFor(p.item);
        }),
      );
      if (!cancelled) setImages(urls);
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
        <div className="kl-skeleton aspect-[4/5] w-full rounded-md bg-surface-2" />
      </div>
    );
  }

  const title = set.title || autoTitle(placements) || t("profile.draftUntitled");
  const ink = inkFor(set.layout.background);
  const sources = [
    ...new Set(placements.map((p) => p.item.source_domain).filter(Boolean)),
  ] as string[];
  const sorted = [...placements].sort((a, b) => a.slot - b.slot);
  const chosen = VISIBILITY.find((v) => v.id === set.visibility) ?? VISIBILITY[0]!;

  async function changeVisibility(next: Visibility) {
    if (!set) return;
    const { error } = await supabase.from("sets").update({ visibility: next }).eq("id", set.id);
    if (!error) {
      setSet({ ...set, visibility: next });
      refreshPreview(set.id);
    }
  }

  async function resetLink() {
    if (!set) return;
    const { data, error } = await supabase.rpc("reset_share_code", { p_set_id: set.id });
    setConfirm(null);
    if (error || !data) {
      setNotice(t("setpage.resetFailed"));
      return;
    }
    setSet({ ...set, share_code: data });
    setNotice(t("setpage.resetDone"));
  }

  /**
   * Embed (M9.3; spec 6.6 #5): one iframe line for a blog or a website. The embed page is the
   * Worker's `/e/<code>`, so it lives and dies with the share link - Only me or a reset code
   * stops the embed at the same moment.
   */
  async function copyEmbed() {
    if (!set) return;
    const src = siteUrl(`/e/${set.share_code}`);
    const name = (set.title || title).replace(/"/g, "'");
    const code = `<iframe src="${src}" title="${name} on Kleit" loading="lazy" style="width:100%;max-width:520px;aspect-ratio:4/5;border:0;border-radius:12px"></iframe>`;
    setOptions(false);
    try {
      await navigator.clipboard.writeText(code);
      setNotice(t("setpage.embedCopied"));
    } catch {
      setNotice(t("setpage.embedFailed"));
    }
  }

  async function remove() {
    if (!set) return;
    // Into Recently deleted for 30 days (S26); the chat picture comes down with it.
    const ok = await deleteSet(set.id);
    setConfirm(null);
    if (!ok) {
      setNotice(t("setpage.deleteFailed"));
      return;
    }
    void navigate({ to: "/you" });
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-ink">{title}</h1>
          {creator ? (
            <p className="mt-1 text-sm text-ink-soft">
              <Link
                to="/u/$username"
                params={{ username: creator.username }}
                className="underline-offset-2 hover:underline"
              >
                {t("set.by", { username: creator.username })}
              </Link>
              <AccountLabelChip label={creator.label} className="ml-1 align-middle" />
            </p>
          ) : null}
          {set.description ? (
            <p className="mt-1 whitespace-pre-wrap text-base text-ink">{set.description}</p>
          ) : null}
          {set.layout.caption ? (
            <p className="mt-1 text-base text-ink-soft">{set.layout.caption}</p>
          ) : null}
          {set.tags?.length ? (
            <p className="mt-1 flex flex-wrap gap-x-2 text-sm">
              {set.tags.map((tag) => (
                <Link
                  key={tag}
                  to="/tag/$tag"
                  params={{ tag }}
                  className="text-ink-soft underline-offset-2 hover:underline"
                >
                  #{tag}
                </Link>
              ))}
            </p>
          ) : null}
          {set.status === "draft" ? (
            <p className="mt-1 text-sm text-ink-soft">{t("setpage.draft")}</p>
          ) : null}
          {people.length > 0 ? (
            <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-ink-soft">
              <span>{t("setpage.with")}</span>
              {people.map((p) => (
                <Link
                  key={p.user_id}
                  to="/u/$username"
                  params={{ username: p.username }}
                  className="underline-offset-2 hover:underline"
                >
                  @{p.username}
                  {p.state === "pending" ? ` (${t("setpage.withWaiting")})` : ""}
                </Link>
              ))}
            </p>
          ) : null}
          {admin && set.status === "published" && set.visibility === "public" ? (
            <button
              type="button"
              onClick={() => void toggleFeatured()}
              className="mt-1 block text-sm text-ink-soft underline-offset-2 hover:underline"
            >
              {set.featured_at ? t("setpage.unfeature") : t("setpage.feature")}
            </button>
          ) : null}
          {set.song ? <SongCard song={set.song} /> : null}
          {set.remixed_from_label ? (
            set.remixed_from_set_id ? (
              <Link
                to="/set/$setId"
                params={{ setId: set.remixed_from_set_id }}
                className="mt-1 block text-sm text-ink-soft underline-offset-2 hover:underline"
              >
                {set.remixed_from_label}
              </Link>
            ) : (
              <p className="mt-1 text-sm text-ink-soft">{set.remixed_from_label}</p>
            )
          ) : null}
        </div>
        {mine ? (
          <button
            type="button"
            onClick={() => setOptions(true)}
            aria-label={t("set.options")}
            className="flex size-12 shrink-0 items-center justify-center rounded-pill border border-line bg-surface text-xl text-ink"
          >
            …
          </button>
        ) : (
          <ReportButton type="set" id={setId} />
        )}
      </div>

      {set.creative ? (
        <div className="mt-4">
          <CreativeView setId={setId} />
        </div>
      ) : (
        <div
          className="relative mt-4 w-full overflow-hidden rounded-md border border-line"
          style={{
            aspectRatio: `${template?.layout.canvas.w ?? 4} / ${template?.layout.canvas.h ?? 5}`,
            backgroundColor: set.layout.background,
          }}
          aria-label={t("builder.canvas")}
        >
          {template ? <TemplateDressing layout={template.layout} layer="under" /> : null}
          {(template?.layout.slots ?? []).map((slot, i) => {
            const placed = placements.find((p) => p.slot === i);
            if (!placed) return null;
            const url = images[placed.item.id];
            const tag = placed.item.kind === "own" ? t("item.own") : priceLabel(placed.item);
            return (
              <Link
                key={i}
                to="/item/$itemId"
                params={{ itemId: placed.item.id }}
                className="absolute"
                style={{
                  left: `${slot.x * 100}%`,
                  top: `${slot.y * 100}%`,
                  width: `${slot.w * 100}%`,
                  height: `${slot.h * 100}%`,
                }}
                aria-label={`${placed.item.title ?? t("item.untitled")}${tag ? ` · ${tag}` : ""}`}
              >
                {url ? <img src={url} alt="" className="size-full object-contain" /> : null}
                {tag ? (
                  <span
                    className="absolute bottom-1 left-1 rounded-pill px-2 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: ink, color: set.layout.background }}
                  >
                    {tag}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {template ? <TemplateDressing layout={template.layout} layer="over" /> : null}
        </div>
      )}

      {notice ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-line bg-surface p-3 text-sm text-ink"
        >
          {notice}
        </p>
      ) : null}

      {/* The pieces, as a list with Buy - the tap-dots of the shared page, in reading order. */}
      <ul className="mt-4 divide-y divide-line">
        {sorted.map(({ item }) => {
          const buy = buyUrlFor(item, set.id, states.get(item.id) ?? null);
          const name =
            item.title?.trim() || (item.kind === "own" ? t("item.yourPiece") : t("item.untitled"));
          const store = item.store_name?.trim() || item.source_domain || "";
          return (
            <li key={item.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-base text-ink">{name}</p>
                <p className="text-sm text-ink-soft">
                  {item.kind === "own"
                    ? t("piece.ownItem")
                    : [priceLabel(item), store ? t("piece.from", { site: store }) : null]
                        .filter(Boolean)
                        .join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {item.kind === "product" ? (
                  <button
                    type="button"
                    aria-pressed={saved.has(item.id)}
                    aria-label={`${saved.has(item.id) ? t("item.saved") : t("item.save")}: ${name}`}
                    title={t("item.saveWhy")}
                    onClick={() => void toggleSaved(item.id)}
                    className={`flex size-11 items-center justify-center rounded-pill border ${saved.has(item.id) ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink"}`}
                  >
                    <Heart className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
                {buy ? (
                  <a
                    href={buy}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("piece.buyA11y", { name, store })}
                    className="rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-ink"
                  >
                    {t("piece.buyAt", { store })}
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {placements.some((p) => p.item.source_url) ? (
        <p className="mt-1 text-sm text-ink-soft">{t("disclosure.commission")}</p>
      ) : null}

      {sources.length ? (
        <section className="mt-6">
          <h2 className="text-base font-medium text-ink">{t("setpage.sources")}</h2>
          <p className="mt-1 text-sm text-ink-soft">{sources.join(" · ")}</p>
        </section>
      ) : null}

      {myTag ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {myTag.state === "pending" ? (
            <button
              type="button"
              onClick={() => void sayYesToTag()}
              className="min-h-12 rounded-pill bg-brand px-5 text-base font-medium text-brand-ink"
            >
              {t("setpage.tagApprove")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void removeMe()}
            className="min-h-12 rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            {t("setpage.tagRemoveMe")}
          </button>
        </div>
      ) : null}

      <SocialBar setId={setId} me={me} mine={mine} commentsSetting={commentsSetting} />

      {set.status === "published" && (mine || set.remix_mode !== "off") ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => void remix()}
            disabled={remixing}
            className="flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
          >
            {t("setpage.remix")}
          </button>
          <p className="mt-2 text-sm text-ink-soft">{t("setpage.remixWhat")}</p>
        </div>
      ) : null}

      {set.status === "published" && !mine ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void useStyle()}
            disabled={styling}
            className="flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
          >
            {t("setpage.useStyle")}
          </button>
          <p className="mt-2 text-sm text-ink-soft">{t("setpage.useStyleWhat")}</p>
          {/* Spec 7.1 #1: anyone's set can go into one of YOUR folders (the owner has it in the options). */}
          <button
            type="button"
            onClick={() => setSaving(true)}
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            {t("collections.saveTo")}
          </button>
        </div>
      ) : null}

      {mine ? (
        <div className="mt-6">
          <PrimaryButton
            onClick={() => void navigate({ to: "/set/$setId/send", params: { setId } })}
          >
            {set.status === "published" ? t("send.title") : t("builder.send")}
          </PrimaryButton>
        </div>
      ) : null}

      {/* S49 — options. */}
      <Sheet open={options} onOpenChange={setOptions} title={t("setpage.options")}>
        <ul className="flex flex-col divide-y divide-line">
          <li>
            <Link
              to={set.creative ? "/set/$setId/canvas" : "/set/$setId/edit"}
              params={{ setId }}
              className="flex min-h-12 items-center text-base text-ink"
            >
              {t("setpage.edit")}
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                setOptions(false);
                setSongSheet(true);
              }}
              className="flex min-h-12 w-full items-center justify-between text-left text-base text-ink"
            >
              <span>{t("setpage.song")}</span>
              <span className="truncate pl-3 text-sm text-ink-soft">
                {set.song ? set.song.title : t("setpage.songNone")}
              </span>
            </button>
          </li>
          <li className="py-3">
            <p className="text-base text-ink">{t("social.setting")}</p>
            <p className="text-sm text-ink-soft">{t("social.settingWhy")}</p>
            <div
              className="mt-2 flex flex-wrap gap-2"
              role="group"
              aria-label={t("social.setting")}
            >
              {(["everyone", "following", "off"] as const).map((c) => (
                <Chip
                  key={c}
                  label={t(`social.setting.${c}`)}
                  selected={commentsSetting === c}
                  onToggle={() =>
                    void setCommentsSetting(setId, c).then((ok) => ok && setCommentsSettingState(c))
                  }
                />
              ))}
            </div>
          </li>
          <li className="py-3">
            <p className="text-base text-ink">{t("send.whoCanSee")}</p>
            <div
              className="mt-2 flex flex-wrap gap-2"
              role="group"
              aria-label={t("send.whoCanSee")}
            >
              {VISIBILITY.map((v) => (
                <Chip
                  key={v.id}
                  label={v.label}
                  selected={v.id === chosen.id}
                  onToggle={() => void changeVisibility(v.id)}
                />
              ))}
            </div>
          </li>
          <li className="py-3">
            <p className="text-base text-ink">{t("setpage.remixMode")}</p>
            <div
              className="mt-2 flex flex-wrap gap-2"
              role="group"
              aria-label={t("setpage.remixMode")}
            >
              {(["anyone", "followers", "off"] as const).map((m) => (
                <Chip
                  key={m}
                  label={t(`remix.${m}`)}
                  selected={(set.remix_mode ?? "anyone") === m}
                  onToggle={() => void chooseRemixMode(m)}
                />
              ))}
            </div>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                setOptions(false);
                setSaving(true);
              }}
              className="flex min-h-12 w-full items-center text-left text-base text-ink"
            >
              {t("collections.saveTo")}
            </button>
          </li>
          <li>
            <Link
              to="/set/$setId/history"
              params={{ setId }}
              className="flex min-h-12 items-center text-base text-ink"
            >
              {t("setpage.history")}
            </Link>
          </li>
          {set.status === "published" &&
          (set.visibility === "public" || set.visibility === "link") ? (
            <li>
              <button
                type="button"
                onClick={() => void copyEmbed()}
                className="flex min-h-12 w-full items-center text-left text-base text-ink"
              >
                {t("setpage.embed")}
              </button>
            </li>
          ) : null}
          <li>
            <button
              type="button"
              onClick={() => {
                setOptions(false);
                setConfirm("reset");
              }}
              className="flex min-h-12 w-full items-center text-left text-base text-ink"
            >
              {t("setpage.resetLink")}
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                setOptions(false);
                setConfirm("delete");
              }}
              className="flex min-h-12 w-full items-center text-left text-base text-danger"
            >
              {t("setpage.delete")}
            </button>
          </li>
        </ul>
      </Sheet>
      <SongSheet
        setId={setId}
        song={set.song ?? null}
        open={songSheet}
        onOpenChange={setSongSheet}
        onSaved={(song) => setSet({ ...set, song })}
      />

      <SaveToCollection setId={setId} open={saving} onOpenChange={setSaving} />

      {/* G6: the plain warning, before it happens. */}
      <Sheet
        open={confirm === "reset"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t("setpage.resetLink")}
        description={t("setpage.resetWarning")}
        action={
          <PrimaryButton onClick={() => void resetLink()}>
            {t("setpage.resetConfirm")}
          </PrimaryButton>
        }
      />
      <Sheet
        open={confirm === "delete"}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t("setpage.delete")}
        description={t("setpage.deleteWarning")}
        action={
          <PrimaryButton onClick={() => void remove()}>{t("setpage.deleteConfirm")}</PrimaryButton>
        }
      />
    </div>
  );
}
