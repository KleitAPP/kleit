import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import { block, haveBlocked, haveMuted, mute, unblock, unmute } from "@/social/blocks";
import type { Person } from "@/social/follows";

/** Block / Unblock on someone's profile, with the plain warning first (spec 10.4; G6). */
export function BlockButton({ them, me }: { them: Person; me: string | null }) {
  const navigate = useNavigate();
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [muted, setMuted] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void haveMuted(them.user_id).then((m) => !cancelled && setMuted(m));
    return () => {
      cancelled = true;
    };
  }, [them.user_id]);

  useEffect(() => {
    let cancelled = false;
    void haveBlocked(them.user_id).then((b) => !cancelled && setBlocked(b));
    return () => {
      cancelled = true;
    };
  }, [them.user_id]);

  if (!me || me === them.user_id || blocked === null) return null;

  return (
    <>
      {muted !== null ? (
        <button
          type="button"
          title={t("mute.why")}
          onClick={() =>
            muted
              ? void unmute(them.user_id).then((ok) => ok && setMuted(false))
              : void mute(them.user_id).then((ok) => ok && setMuted(true))
          }
          className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
        >
          {muted ? t("mute.unmute") : t("mute.mute")}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() =>
          blocked
            ? void unblock(them.user_id).then((ok) => ok && setBlocked(false))
            : setConfirm(true)
        }
        className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
      >
        {blocked ? t("block.unblock") : t("block.block")}
      </button>
      <Sheet
        open={confirm}
        onOpenChange={setConfirm}
        title={t("block.title", { name: them.username })}
        description={t("block.why")}
        action={
          <PrimaryButton
            onClick={() =>
              void block(them.user_id).then((ok) => {
                setConfirm(false);
                // Their profile is hidden from you now too; back to your own page.
                if (ok) void navigate({ to: "/you" });
              })
            }
          >
            {t("block.block")}
          </PrimaryButton>
        }
      >
        <p className="text-sm text-ink-soft">{t("block.signedOutNote")}</p>
      </Sheet>
    </>
  );
}
