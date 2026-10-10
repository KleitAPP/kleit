import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { supabase } from "@/integrations/supabase/client";
import { buyUrlFor, imageUrlFor, priceLabel, type ItemSummary } from "@/items/items";
import {
  autoTitle,
  deleteSet,
  loadSet,
  templates,
  type Placement,
  type SetSummary,
  type Template,
  refreshPreview,
} from "@/sets/sets";
import { inkFor } from "@/sets/swatches";
import { CreativeView } from "@/canvas/CreativeView";
import { SaveToCollection } from "@/collections/SaveToCollection";
import { t } from "@/i18n/en";
import { ReportButton } from "@/safety/ReportButton";
import { setCommentsSetting, type CommentsSetting } from "@/social/comments";
import { SocialBar } from "@/social/SocialBar";
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
  const [mine, setMine] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [commentsSetting, setCommentsSettingState] = useState<CommentsSetting>("everyone");
  const [missing, setMissing] = useState(false);
  const [options, setOptions] = useState(false);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      const { data: owner } = await supabase
        .from("sets")
        .select("owner_id")
        .eq("id", setId)
        .maybeSingle();
      setMine(!!owner && owner.owner_id === who.data.user?.id);
      setMe(who.data.user?.id ?? null);
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
                aria-label={placed.item.title ?? t("item.untitled")}
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
          const buy = buyUrlFor(item, set.id);
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
              {buy ? (
                <a
                  href={buy}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("piece.buyA11y", { name, store })}
                  className="shrink-0 rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-ink"
                >
                  {t("piece.buyAt", { store })}
                </a>
              ) : null}
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

      <SocialBar setId={setId} me={me} mine={mine} commentsSetting={commentsSetting} />

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
