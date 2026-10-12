import { Bookmark, Heart, MessageCircle, MoreHorizontal } from "lucide-react";
import { t } from "@/i18n/en";

/**
 * A set in a feed, profile, collection or search result (design pack §8.2).
 * The image sits on surface-2 and is shown exactly as saved: nothing in the app theme
 * ever recolours a user's set (decision 107).
 */
export function SetCard({
  imageSrc,
  imageAlt,
  username,
  label,
  avatarSrc,
  caption,
  likes,
  comments,
  liked = false,
  onOpen,
  onLike,
  onComment,
  onSave,
  onMore,
}: {
  imageSrc: string;
  imageAlt: string;
  username: string;
  /** "Kleit staff", "Kleit stylist" or "Brand" (spec 11 #9); nothing for an ordinary account. */
  label?: string;
  avatarSrc?: string;
  caption?: string;
  likes?: number;
  comments?: number;
  liked?: boolean;
  onOpen?: () => void;
  onLike?: () => void;
  onComment?: () => void;
  onSave?: () => void;
  onMore?: () => void;
}) {
  const iconButton =
    "inline-flex min-h-12 min-w-12 items-center justify-center rounded-pill text-ink transition-colors duration-fast hover:bg-surface-2";
  return (
    <article className="overflow-hidden rounded-md bg-surface shadow-card">
      <button type="button" onClick={onOpen} className="block w-full" aria-label={imageAlt}>
        <div className="aspect-square w-full bg-surface-2">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={imageAlt}
              className="size-full object-contain"
              loading="lazy"
            />
          ) : null}
        </div>
      </button>
      <div className="flex items-center gap-2 px-3 pt-2">
        {avatarSrc ? (
          <img src={avatarSrc} alt="" className="size-8 rounded-pill bg-surface-2 object-cover" />
        ) : (
          <span aria-hidden="true" className="size-8 rounded-pill bg-surface-2" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
          {t("set.by", { username })}
          {label ? (
            <span className="ml-1 rounded-pill border border-ink px-2 py-0.5 text-xs text-ink">
              {label}
            </span>
          ) : null}
        </span>
        <button type="button" onClick={onMore} aria-label={t("set.options")} className={iconButton}>
          <MoreHorizontal className="size-5" aria-hidden="true" />
        </button>
      </div>
      {caption ? <p className="px-3 text-base text-ink">{caption}</p> : null}
      <div className="flex items-center px-1 pb-1">
        <button type="button" onClick={onLike} aria-label={t("set.like")} className={iconButton}>
          <Heart className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onComment}
          aria-label={t("set.comment")}
          className={iconButton}
        >
          <MessageCircle className="size-5" aria-hidden="true" />
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onSave} aria-label={t("set.save")} className={iconButton}>
          <Bookmark className="size-5" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
