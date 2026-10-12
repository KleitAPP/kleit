import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, PrimaryButton } from "@/components/kleit";
import {
  readLink,
  saveClip,
  type PageRead,
  type ReadProblem,
  type SaveProblem,
} from "@/items/clipLink";
import { t } from "@/i18n/en";
import { onSharedAddress, takeSharedAddress } from "@/native/incoming";

/**
 * S29 Paste a link → S30 Reading the page → S31 Pick the image → S32 Item details → checking,
 * as one screen (design pack §2.2, §4.4; spec 4.1, 4.2).
 *
 * The one rule that shapes it (G10): a slow or blocked store must not cost the person their
 * clip. The read is capped at four seconds on the server; if it fails, S32 opens anyway with the
 * fields empty and the link kept, and they add it by hand. Nothing they typed is ever lost to
 * a store's bad day.
 *
 * The source line is shown and cannot be edited (spec 4.2 #2). It is the one field the person
 * does not own, because it is the record of where the picture came from - and the database's
 * trigger enforces that, not this screen.
 */
export const Route = createFileRoute("/_app/add/link")({
  head: () => ({
    meta: [{ title: "Clip a link" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  // ?url= is how the browser extension arrives (M9.1): the address is filled in, and the person
  // taps Read - a link in a chat can carry ?url= too, and the signed-in app must not fetch an
  // address on a stranger's say-so. A share from another app on the phone (M8.2) hands its
  // address over in memory instead (takeSharedAddress) and that one is read at once. ?image=
  // is the picture the person right-clicked.
  validateSearch: (search: Record<string, unknown>): { url?: string; image?: string } => ({
    ...(typeof search["url"] === "string" && search["url"] ? { url: search["url"] } : {}),
    ...(typeof search["image"] === "string" && /^https?:\/\//.test(search["image"])
      ? { image: search["image"] }
      : {}),
  }),
  component: AddLink,
});

type Stage =
  | { at: "paste" }
  | { at: "reading" }
  | { at: "details"; page: PageRead; readProblem: ReadProblem | null }
  | { at: "saving" }
  | {
      at: "done";
      state: "clean" | "review" | "blocked" | "checking";
      kind: "product" | "non_product";
    }
  | { at: "failed"; problem: SaveProblem };

const READ_WORDS: Record<ReadProblem, string> = {
  "bad-url": t("clip.badUrl"),
  "opted-out": t("clip.optedOut"),
  refused: t("clip.refused"),
  "timed-out": t("clip.timedOut"),
  unreadable: t("clip.unreadable"),
  "signed-out": t("photo.signedOut"),
  offline: t("join.offline"),
};

const SAVE_WORDS: Record<SaveProblem, string> = {
  ...READ_WORDS,
  "image-unreadable": t("clip.imageUnreadable"),
  "save-failed": t("photo.saveFailed"),
};

function AddLink() {
  const navigate = useNavigate();
  const { url: shared, image: sharedImage } = Route.useSearch();
  const [fromPhone] = useState(() => takeSharedAddress());
  const [stage, setStage] = useState<Stage>({ at: "paste" });
  const [url, setUrl] = useState(fromPhone ?? shared ?? "");

  // The details, editable (name and price - spec 4.1 #9), and the picture picked.
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [own, setOwn] = useState(false);

  // An address the phone shared does not wait for a tap; one from a link does. A second share
  // while this screen is open is read the same way.
  useEffect(() => {
    if (fromPhone && stage.at === "paste") void readAddress(fromPhone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromPhone]);
  useEffect(
    () =>
      onSharedAddress((address) => {
        setUrl(address);
        void readAddress(address);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function read() {
    return readAddress(url);
  }

  async function readAddress(address: string) {
    const trimmed = address.trim();
    if (!trimmed) return;
    setStage({ at: "reading" });
    const result = await readLink(trimmed);
    if (result.ok) {
      setTitle(result.page.title ?? "");
      setPrice(result.page.priceCents != null ? (result.page.priceCents / 100).toFixed(2) : "");
      // A picture the person pointed at (the extension's right-click) comes first and is chosen.
      const images = sharedImage
        ? [sharedImage, ...result.page.images.filter((i) => i !== sharedImage)]
        : result.page.images;
      setImage(images[0] ?? null);
      setStage({ at: "details", page: { ...result.page, images }, readProblem: null });
      return;
    }
    // Two problems are final: not an address, or a site that asked not to be clipped. The rest
    // fall through to the details screen with the link kept (G10).
    if (
      result.problem === "bad-url" ||
      result.problem === "opted-out" ||
      result.problem === "signed-out"
    ) {
      setStage({ at: "failed", problem: result.problem });
      return;
    }
    let domain = "";
    try {
      domain = new URL(trimmed).hostname.replace(/^www\./, "");
    } catch {
      /* the server would have said bad-url */
    }
    if (sharedImage) setImage(sharedImage);
    setStage({
      at: "details",
      page: {
        title: null,
        priceCents: null,
        currency: null,
        storeName: domain,
        images: sharedImage ? [sharedImage] : [],
        sourceUrl: trimmed,
        sourceDomain: domain,
        available: null,
      },
      readProblem: result.problem,
    });
  }

  async function save(page: PageRead) {
    if (!image) return;
    setStage({ at: "saving" });
    const cents = parsePrice(price);
    const result = await saveClip({
      url: page.sourceUrl,
      imageUrl: image,
      title: title.trim(),
      priceCents: cents,
      currency: cents != null ? (page.currency ?? "USD") : null,
      storeName: page.storeName,
      own,
      soldOut: page.available === false,
    });
    setStage(
      result.ok
        ? { at: "done", state: result.state, kind: result.kind }
        : { at: "failed", problem: result.problem },
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("clip.title")}</h1>

      {stage.at === "paste" || stage.at === "reading" ? (
        <>
          <p className="mt-3 text-base text-ink-soft">{t("clip.what")}</p>
          <p className="mt-1 text-sm text-ink-soft">{t("clip.worksWell")}</p>
          <label className="mt-6 block">
            <span className="text-sm text-ink-soft">{t("clip.field")}</span>
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={url}
              disabled={stage.at === "reading"}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void read();
              }}
              placeholder="https://"
              className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
            />
          </label>
          {stage.at === "reading" ? (
            <p role="status" className="mt-4 text-base text-ink">
              {t("clip.reading")}
            </p>
          ) : null}
          <div className="mt-6">
            <PrimaryButton
              onClick={() => void read()}
              disabled={stage.at === "reading" || !url.trim()}
            >
              {stage.at === "reading" ? t("loading") : t("clip.read")}
            </PrimaryButton>
          </div>
        </>
      ) : null}

      {stage.at === "details" ? (
        <>
          {stage.readProblem ? (
            <p
              role="status"
              className="mt-3 rounded-md border border-line bg-surface p-3 text-sm text-ink"
            >
              {READ_WORDS[stage.readProblem]} {t("clip.addByHand")}
            </p>
          ) : null}

          {stage.page.images.length > 1 ? (
            <div className="mt-6">
              <p className="text-sm text-ink-soft">{t("clip.pickImage")}</p>
              <ul
                className="mt-2 grid grid-cols-3 gap-2"
                role="listbox"
                aria-label={t("clip.pickImage")}
              >
                {stage.page.images.map((candidate) => (
                  <li key={candidate}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={image === candidate}
                      onClick={() => setImage(candidate)}
                      className={`block aspect-square w-full overflow-hidden rounded-sm border-2 bg-surface-2 ${image === candidate ? "border-ink" : "border-line"}`}
                    >
                      <img
                        src={candidate}
                        alt=""
                        className="size-full object-contain"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : image ? (
            <div className="mt-6 aspect-square w-full overflow-hidden rounded-md bg-surface-2">
              <img
                src={image}
                alt=""
                className="size-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <p className="mt-6 rounded-md border border-line bg-surface p-3 text-sm text-ink">
              {t("clip.noImage")}
            </p>
          )}

          <label className="mt-6 block">
            <span className="text-sm text-ink-soft">{t("clip.name")}</span>
            <input
              type="text"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
            />
          </label>
          <label className="mt-4 block">
            <span className="text-sm text-ink-soft">{t("clip.price")}</span>
            <input
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
            />
          </label>

          {/* Locked. Shown so the person knows what will be on the item, and not editable (spec 4.2). */}
          <dl className="mt-4 rounded-md border border-line bg-surface p-3">
            <dt className="text-sm text-ink-soft">{t("clip.source")}</dt>
            <dd className="mt-1 truncate text-base text-ink">
              {t("piece.from", { site: stage.page.sourceDomain })}
            </dd>
            <dd className="mt-1 text-xs text-ink-soft">{t("clip.sourceLocked")}</dd>
          </dl>

          <div className="mt-4">
            <Chip label={t("clip.own")} selected={own} onToggle={() => setOwn(!own)} />
            <p className="mt-1 text-sm text-ink-soft">{t("clip.ownWhy")}</p>
          </div>

          <div className="mt-6">
            <PrimaryButton onClick={() => void save(stage.page)} disabled={!image}>
              {t("clip.add")}
            </PrimaryButton>
          </div>
        </>
      ) : null}

      {stage.at === "saving" ? (
        <div className="mt-8" role="status">
          <p className="text-base text-ink">{t("clip.saving")}</p>
          <p className="mt-2 text-sm text-ink-soft">{t("photo.checkingWhy")}</p>
        </div>
      ) : null}

      {stage.at === "done" ? (
        <>
          <p role="status" className="mt-8 text-base text-ink">
            {stage.state === "clean"
              ? t(stage.kind === "product" ? "clip.doneProduct" : "clip.doneNonProduct")
              : stage.state === "review"
                ? t("photo.review")
                : stage.state === "blocked"
                  ? t("photo.blocked")
                  : t("clip.stillChecking")}
          </p>
          <div className="mt-8">
            <PrimaryButton
              onClick={() => void navigate({ to: own ? "/you/closet" : "/you/drawer" })}
            >
              {own ? t("photo.seeCloset") : t("clip.seeDrawer")}
            </PrimaryButton>
          </div>
        </>
      ) : null}

      {stage.at === "failed" ? (
        <>
          <p role="alert" className="mt-8 text-base text-ink">
            {SAVE_WORDS[stage.problem]}
          </p>
          <div className="mt-8">
            <PrimaryButton onClick={() => setStage({ at: "paste" })}>
              {t("clip.tryAnother")}
            </PrimaryButton>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** "49.99" or "49,99" or "$49" → cents; blank or nonsense → null (no price, a non-product). */
function parsePrice(text: string): number | null {
  let cleaned = text.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  if (/,\d{2}$/.test(cleaned) && !/\.\d{2}$/.test(cleaned))
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  else cleaned = cleaned.replace(/,/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
  return Math.round(value * 100);
}
