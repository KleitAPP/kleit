import { useEffect, useState } from "react";

import { KleitMark } from "@/brand/KleitMark";

import { avatarSrc } from "./avatar";

/**
 * A person's photo in a circle, or the mark when they have none - or when the picture gate says
 * no (an unscanned photo, a hidden account): the image fails to load and the mark comes back.
 */
export function Avatar({
  itemId,
  size = 64,
  className = "",
}: {
  itemId: string | null | undefined;
  /** Pixels. The mark inside is drawn a little under half the size. */
  size?: number;
  className?: string;
}) {
  const src = avatarSrc(itemId);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-pill bg-surface-2 text-ink ${className}`}
      style={{ width: size, height: size }}
    >
      {src && !broken ? (
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <KleitMark size={Math.round(size * 0.44)} />
      )}
    </span>
  );
}
