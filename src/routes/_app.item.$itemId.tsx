import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { SaveToCollection } from "@/collections/SaveToCollection";
import { EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { FolderPlus, Heart } from "lucide-react";

import { ColourChips } from "@/items/ColourChips";
import { colourLabel, isColourName, type ColourName } from "@/items/colour";
import {
  buyUrlFor,
  closetItemUses,
  deleteClosetItem,
  imageUrlFor,
  inMyCloset,
  isSaved,
  myScanStates,
  oneItem,
  priceLabel,
  saveItem,
  setItemColour,
  unsaveItem,
  type ItemSummary,
  type ScanState,
  setsWithItem,
  type SetWithItem,
} from "@/items/items";
import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";
import { previewUrl } from "@/search/search";
import { ReportButton } from "@/safety/ReportButton";
import { appealPhoto, myPhotoAppeal, photoAppealAllowed } from "@/safety/moderation";
import { ask, startSetWith } from "@/social/ask";

/**
 * S40 — Item page (design pack §2.2): the photo, the price and where it came from, and Buy.
 *
 * What you may see here is the database's decision: a product only once its image has passed
 * screening, your own piece always, someone else's own piece only through a set they shared
 * (M3.1). An item the policy hides comes back as "not found" - the same words as an item that
 * does not exist, so this page cannot be used to test which ids are real.
 *
 * Buy does three things the spec asks for at once (8.2 #7, #13, #14): the disclosure sits beside
 * it in normal text, the tap is counted with a random id and never a name, and the store opens
 * in the phone's own browser - `target="_blank"` here, the system browser inside the app at M8.
 *
 * "Sets with this item" (spec 9 #2) lists the public published sets the piece sits on, through
 * `sets_with_item` (migration 093); nothing is shown when there are none. "Find similar" waits for
 * the photo search (M10, CL40) - a heading over nothing would be a promise.
 *
 * Remove from closet (spec 7.1 #7, #11; S26): shown only when the piece is in YOUR closet - the
 * closet table answers nobody else, so the question "is this mine?" is the database's. A piece
 * that sits on some of your sets asks one thing first: keep it there, or take it off them too.
 *
 * The catalogue's small promises (2026-10-12): "Price at [store] as of [date]" under a store
 * price (spec 4.8 #2); "Sold out" as a word (4.8 #1; design pack 8.3 #3); the clipper's credit,
 * "Clipped by @name", or the closed-account words once that account has gone (4.3 #4, 4.2 #6);
 * the colour word, with chips to correct it on a piece of your own (4.4 #4); and "Build a set
 * with it", which opens the builder with the piece in slot 1 (6.3 #4).
 */
export const Route = createFileRoute("/_app/item/$itemId")({
  head: () => ({ meta: [{ title: "Item" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: ItemPage,
});

type Loaded =
  | { at: "loading" }
  | { at: "missing" }
  | {
      at: "found";
      item: ItemSummary;
      imageUrl: string | null;
      state: ScanState | null;
      mine: boolean;
      saved: boolean;
      /** The clipper's or uploader's username; null when that account has closed or is unreadable. */
      by: string | null;
      /** Your appeal on a blocked photo of yours (spec 13.4 #4), if any. */
      appeal: { state: "open" | "upheld" | "overturned"; note: string } | null;
      /** Whether an appeal may be filed (the policy's answer: not for a too-small, moving or removed-before block). */
      canAppeal: boolean;
    };

function ItemPage() {
  const { itemId } = Route.useParams();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Loaded>({ at: "loading" });
  const [removing, setRemoving] = useState<{ uses: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [inSets, setInSets] = useState<SetWithItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [appealing, setAppealing] = useState(false);
  const [appealWords, setAppealWords] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoaded({ at: "loading" });
    setInSets([]);
    void (async () => {
      const item = await oneItem(itemId);
      if (!item) {
        if (!cancelled) setLoaded({ at: "missing" });
        return;
      }
      const [imageUrl, states, mine, saved, sets, by] = await Promise.all([
        imageUrlFor(item),
        myScanStates([item.id]),
        item.kind === "own" ? inMyCloset(item.id) : Promise.resolve(false),
        item.kind === "product" ? isSaved(item.id) : Promise.resolve(false),
        setsWithItem(item.id),
        usernameOf(item.owner_id ?? null),
      ]);
      const state = states.get(item.id) ?? null;
      const [appeal, canAppeal] = await Promise.all([
        state === "blocked" ? myPhotoAppeal(item.id) : Promise.resolve(null),
        state === "blocked" ? photoAppealAllowed(item.id) : Promise.resolve(false),
      ]);
      if (!cancelled) setInSets(sets);
      if (!cancelled)
        setLoaded({
          at: "found",
          item,
          imageUrl,
          state,
          mine,
          saved,
          by,
          appeal,
          canAppeal,
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // The appeal on a blocked photo of yours (spec 13.4 #4, 4.7 #3): one sentence, once; a
  // different person than the one who blocked it decides within seven days (migration 113).
  async function sendAppeal() {
    if (loaded.at !== "found" || busy || appealWords.trim().length === 0) return;
    setBusy(true);
    const ok = await appealPhoto(loaded.item.id, appealWords);
    setBusy(false);
    if (!ok) {
      setProblem(t("item.appealFailed"));
      return;
    }
    setAppealing(false);
    setLoaded({ ...loaded, appeal: { state: "open", note: "" }, canAppeal: false });
  }

  // Hearting (S39): a save is a row of yours; the policy only takes a cleared product.
  async function toggleSaved() {
    if (loaded.at !== "found" || busy) return;
    setBusy(true);
    const next = !loaded.saved;
    const ok = next ? await saveItem(loaded.item.id) : await unsaveItem(loaded.item.id);
    setBusy(false);
    if (ok) setLoaded({ ...loaded, saved: next });
  }

  async function askToRemove() {
    setProblem(null);
    setRemoving({ uses: await closetItemUses(itemId) });
  }

  // Build around this piece (spec 5.1 #12): a question with this piece locked; friends answer
  // with a set that has it on. A cleared store piece only - the database refuses the rest.
  async function buildAround() {
    if (loaded.at !== "found" || busy) return;
    setBusy(true);
    // A question is 200 characters at most (migration 033); a store's title can be as long.
    const name = (loaded.item.title?.trim() || t("item.untitled")).slice(0, 150);
    const askId = await ask(t("ask.buildAroundQuestion", { name }), loaded.item.id);
    setBusy(false);
    if (askId) void navigate({ to: "/asks/$askId", params: { askId } });
    else setProblem(t("item.removeFailed"));
  }

  // Build a set with it (spec 6.3 #4): a quick draft with this piece in slot 1, then the builder.
  async function buildWith() {
    if (loaded.at !== "found" || busy) return;
    setBusy(true);
    setProblem(null);
    const setId = await startSetWith(loaded.item.id);
    setBusy(false);
    if (setId) void navigate({ to: "/set/$setId/edit", params: { setId } });
    else setProblem(t("item.removeFailed"));
  }

  // The colour word on a piece of yours (spec 4.4 #4 "the user confirms"): the guess, corrected.
  async function recolour(colour: ColourName | null) {
    if (loaded.at !== "found" || busy) return;
    const before = loaded.item.color_name ?? null;
    setLoaded({ ...loaded, item: { ...loaded.item, color_name: colour } });
    if (!(await setItemColour(loaded.item.id, colour)))
      setLoaded((now) =>
        now.at === "found" ? { ...now, item: { ...now.item, color_name: before } } : now,
      );
  }

  async function remove(keepInSets: boolean) {
    setBusy(true);
    const done = await deleteClosetItem(itemId, keepInSets);
    setBusy(false);
    if (!done) {
      setProblem(t("item.removeFailed"));
      return;
    }
    setRemoving(null);
    void navigate({ to: "/you/closet" });
  }

  if (loaded.at === "loading") {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8" role="status" aria-label={t("loading")}>
        <div className="kl-skeleton aspect-square w-full rounded-md bg-surface-2" />
      </div>
    );
  }

  if (loaded.at === "missing") {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("item.notFound")} />
      </div>
    );
  }

  const { item, imageUrl, state, mine, saved, by } = loaded;
  const name =
    item.title?.trim() || (item.kind === "own" ? t("item.yourPiece") : t("item.untitled"));
  const price = priceLabel(item);
  const was =
    item.price_was_cents != null &&
    item.price_cents != null &&
    item.price_was_cents > item.price_cents
      ? priceLabel({ price_cents: item.price_was_cents, price_currency: item.price_currency })
      : null;
  const buy = buyUrlFor(item, undefined, state);
  const store = item.store_name?.trim() || item.source_domain || "";
  // Yours: the scan states answer only for your own rows (migration 015), closet or clipped.
  const yours = state !== null;
  const colour = isColourName(item.color_name) ? item.color_name : null;
  // A cleared store piece, anyone's; a piece of your own, cleared. Somebody else's own piece is
  // not placeable (spec 4.5 #5.3) and the database would refuse it, so the button is not offered.
  const canBuild =
    item.kind === "product" ? state === null || state === "clean" : mine && state === "clean";
  const note =
    state === "pending"
      ? t("item.checkingLong")
      : state === "review"
        ? t("item.reviewLong")
        : state === "blocked"
          ? t("item.blockedLong")
          : null;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <div className="aspect-square w-full overflow-hidden rounded-md bg-surface-2">
        {imageUrl ? (
          <img src={imageUrl} alt={item.title?.trim() || ""} className="size-full object-contain" />
        ) : null}
      </div>

      <div className="mt-4 flex items-start justify-between gap-3">
        <h1 className="font-display text-2xl text-ink">{name}</h1>
        <div className="flex shrink-0 items-center gap-1">
          {item.kind === "product" ? (
            <button
              type="button"
              aria-pressed={saved}
              aria-label={saved ? t("item.saved") : t("item.save")}
              title={t("item.saveWhy")}
              disabled={busy}
              onClick={() => void toggleSaved()}
              className={`flex min-h-11 items-center gap-1 rounded-pill border px-3 text-sm ${saved ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink"}`}
            >
              <Heart className="size-4" aria-hidden="true" />
              {saved ? t("item.saved") : t("item.save")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setSaving(true)}
            className="flex min-h-11 items-center gap-1 rounded-pill border border-line bg-surface px-3 text-sm text-ink"
          >
            <FolderPlus className="size-4" aria-hidden="true" />
            {t("collections.folder")}
          </button>
          <ReportButton type="item" id={itemId} />
        </div>
      </div>
      {item.kind === "own" ? (
        <p className="mt-1 text-xs font-semibold tracking-wide text-ink-soft">{t("item.own")}</p>
      ) : (
        <p className="mt-1 text-base text-ink-soft">
          {[price, store ? t("piece.from", { site: store }) : null].filter(Boolean).join(" · ")}
          {was ? (
            <>
              {" "}
              <s className="text-ink-soft">{t("item.was", { price: was })}</s>
            </>
          ) : null}
          {item.sold_out ? (
            <>
              {" · "}
              <span className="font-medium text-ink">{t("item.soldOut")}</span>
            </>
          ) : null}
        </p>
      )}
      {price && item.price_checked_at && store ? (
        <p className="mt-1 text-sm text-ink-soft">
          {t("item.priceAsOf", { store, date: dateLabel(item.price_checked_at) })}
        </p>
      ) : null}
      {item.dead_link_at ? (
        <p role="status" className="mt-2 text-sm text-ink-soft">
          {t("item.gone")}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-ink-soft">
        {t("item.added", { date: dateLabel(item.created_at) })}
        {item.kind === "product" && (by || !item.owner_id) ? (
          // No owner means the account closed (the FK sets null); an owner whose profile cannot be
          // read (a block, a ban, a break) is simply not named.
          <>
            {" · "}
            {by ? t("item.clippedBy", { name: by }) : t("item.clippedByGone")}
          </>
        ) : by && !mine ? (
          <>
            {" · "}
            {t("item.uploadedBy", { name: by })}
          </>
        ) : null}
      </p>
      {yours ? (
        <div className="mt-3">
          <p className="text-sm text-ink-soft">
            {t("item.colour")}
            {colour ? `: ${colourLabel(colour)}` : ""}
          </p>
          <div className="mt-1">
            <ColourChips
              value={colour}
              onChange={(c) => void recolour(c)}
              label={t("item.colour")}
            />
          </div>
        </div>
      ) : colour ? (
        <p className="mt-1 text-sm text-ink-soft">
          {t("item.colour")}: {colourLabel(colour)}
        </p>
      ) : null}

      {note ? (
        <div
          role="status"
          className="mt-4 rounded-md border border-line bg-surface p-3 text-sm text-ink"
        >
          <p>{note}</p>
          {state === "blocked" && yours && (loaded.appeal || loaded.canAppeal) ? (
            loaded.appeal ? (
              <p className="mt-2 text-ink-soft">
                {loaded.appeal.state === "open"
                  ? t("item.appealOpen")
                  : loaded.appeal.state === "upheld"
                    ? t("item.appealUpheld")
                    : t("item.appealOverturned")}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setProblem(null);
                  setAppealing(true);
                }}
                className="mt-2 min-h-11 rounded-pill border border-line bg-surface px-4 text-sm font-medium text-ink"
              >
                {t("item.appeal")}
              </button>
            )
          ) : null}
        </div>
      ) : null}

      <Sheet
        open={appealing}
        onOpenChange={(o) => {
          if (!o) setAppealing(false);
        }}
        title={t("item.appeal")}
        description={t("item.appealWhy")}
        action={
          <PrimaryButton
            onClick={() => void sendAppeal()}
            disabled={busy || appealWords.trim().length === 0}
          >
            {busy ? t("loading") : t("item.appealSend")}
          </PrimaryButton>
        }
      >
        {problem ? (
          <p role="alert" className="mb-3 text-sm font-medium text-danger">
            {problem}
          </p>
        ) : null}
        <label className="block">
          <span className="sr-only">{t("item.appealLabel")}</span>
          <textarea
            value={appealWords}
            onChange={(e) => setAppealWords(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder={t("item.appealLabel")}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-soft"
          />
        </label>
      </Sheet>

      {buy ? (
        <div className="mt-6">
          <a
            href={buy}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("piece.buyA11y", { name, store })}
            className="flex min-h-12 w-full items-center justify-center rounded-pill bg-brand px-5 text-base font-medium text-brand-ink transition-opacity duration-fast hover:opacity-90"
          >
            {t("piece.buyAt", { store })}
          </a>
          {/* Beside the button, in normal text (spec 8.2 #7). */}
          <p className="mt-2 text-sm text-ink-soft">{t("disclosure.commission")}</p>
        </div>
      ) : null}

      {canBuild ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void buildWith()}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
        >
          {t("item.buildWith")}
        </button>
      ) : null}

      {/* Somebody else's catalogue piece answers no scan state (it is readable only once cleared); your own says "clean". */}
      {item.kind === "product" && (state === null || state === "clean") ? (
        <button
          type="button"
          disabled={busy}
          title={t("ask.buildAroundWhy")}
          onClick={() => void buildAround()}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
        >
          {t("ask.buildAround")}
        </button>
      ) : null}
      {problem && removing === null ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {problem}
        </p>
      ) : null}

      {inSets.length > 0 ? (
        <section className="mt-6" aria-labelledby="in-sets">
          <h2 id="in-sets" className="text-base font-medium text-ink">
            {t("item.inSets", { count: inSets.length })}
          </h2>
          <ul className="mt-2 grid grid-cols-2 gap-3">
            {inSets.map((s) => {
              const url = previewUrl(s);
              return (
                <li key={s.id}>
                  <Link
                    to="/set/$setId"
                    params={{ setId: s.id }}
                    className="block overflow-hidden rounded-md bg-surface shadow-card"
                  >
                    <div className="aspect-square w-full bg-surface-2">
                      {url ? (
                        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
                      ) : null}
                    </div>
                    <p className="truncate px-3 py-2 text-sm text-ink">{s.title || "…"}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {mine ? (
        <>
          <Link
            to="/you/closet"
            className="mt-6 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
          >
            {t("item.backToCloset")}
          </Link>
          <button
            type="button"
            onClick={() => void askToRemove()}
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-pill px-5 text-base font-medium text-danger transition-colors duration-fast hover:bg-surface-2"
          >
            {t("item.remove")}
          </button>
        </>
      ) : null}

      <Sheet
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("item.remove")}
        description={t("item.removeWarning")}
        action={
          removing && removing.uses > 0 ? null : (
            <PrimaryButton onClick={() => void remove(true)} disabled={busy}>
              {t("item.removeConfirm")}
            </PrimaryButton>
          )
        }
      >
        {removing && removing.uses > 0 ? (
          <div>
            <p className="text-base text-ink">{t("item.removeUsed", { count: removing.uses })}</p>
            <div className="mt-3 flex flex-col gap-2">
              <Choice
                label={t("item.removeKeep")}
                hint={t("item.removeKeepHint")}
                disabled={busy}
                onClick={() => void remove(true)}
              />
              <Choice
                label={t("item.removeAlso")}
                hint={t("item.removeAlsoHint")}
                disabled={busy}
                onClick={() => void remove(false)}
              />
            </div>
          </div>
        ) : null}
        {problem ? (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {problem}
          </p>
        ) : null}
      </Sheet>
      <SaveToCollection itemId={itemId} open={saving} onOpenChange={setSaving} />
    </div>
  );
}

function Choice({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-12 w-full flex-col items-start rounded-md border border-line bg-surface px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-2 disabled:opacity-40"
    >
      <span className="text-base font-medium text-ink">{label}</span>
      <span className="text-sm text-ink-soft">{hint}</span>
    </button>
  );
}

/** The username behind an id, or null: the account has closed (the id is gone) or is not readable. */
async function usernameOf(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("username")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.username ?? null;
}

function dateLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
