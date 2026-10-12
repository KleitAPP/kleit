import { useEffect, useState } from "react";

import { t } from "@/i18n/en";
import { BlockButton } from "@/social/BlockButton";
import { MessageButton } from "@/social/MessageButton";
import {
  cancelRequest,
  follow,
  relationship,
  unfollow,
  type Person,
  type Relationship,
} from "@/social/follows";

/**
 * The one button on someone's profile (M5.1): Follow → Following (or Requested for a private
 * account), "Friends" when both ways, and the counts beside it. Tapping a state again undoes it.
 */
export function FollowButton({ them, me }: { them: Person; me: string | null }) {
  const [rel, setRel] = useState<Relationship | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void relationship(them.user_id).then((r) => !cancelled && setRel(r));
    return () => {
      cancelled = true;
    };
  }, [them.user_id]);

  if (!me || me === them.user_id || !rel) return null;

  async function tap() {
    if (!rel || busy) return;
    setBusy(true);
    if (rel.following) {
      if (await unfollow(them.user_id))
        setRel({ ...rel, following: false, followers: Math.max(0, rel.followers - 1) });
    } else if (rel.requested) {
      if (await cancelRequest(them.user_id)) setRel({ ...rel, requested: false });
    } else {
      const result = await follow(them);
      if (result === "following") setRel({ ...rel, following: true, followers: rel.followers + 1 });
      else if (result === "requested") setRel({ ...rel, requested: true });
    }
    setBusy(false);
  }

  const label = rel.following
    ? rel.followedBy
      ? t("profile.friends")
      : t("profile.following")
    : rel.requested
      ? t("profile.requested")
      : t("profile.follow");
  const undo = rel.following
    ? t("profile.unfollow")
    : rel.requested
      ? t("profile.cancelRequest")
      : null;

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void tap()}
          disabled={busy}
          aria-pressed={rel.following || rel.requested}
          aria-label={undo ? `${label} — ${undo}` : label}
          className={`min-h-12 rounded-pill px-5 text-base font-medium transition-colors duration-fast ${
            rel.following || rel.requested
              ? "border border-line bg-surface text-ink"
              : "bg-brand text-brand-ink"
          }`}
        >
          {label}
        </button>
        <MessageButton them={them} me={me} />
        <BlockButton them={them} me={me} />
      </div>
      <p className="text-sm text-ink-soft">
        {t("profile.followers", { count: rel.followers })} ·{" "}
        {t("profile.followingN", { count: rel.followingCount })}
        {rel.followedBy && !rel.following ? ` · ${t("profile.followsYou")}` : ""}
      </p>
      {them.is_private && !rel.following && !rel.requested ? (
        <p className="text-sm text-ink-soft">{t("profile.privateHint", { name: them.username })}</p>
      ) : null}
    </div>
  );
}
