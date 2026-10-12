import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import { block, haveBlocked, haveMuted, mute, unblock, unmute } from "@/social/blocks";
import type { Person } from "@/social/follows";
import { ReportSheet } from "@/safety/ReportButton";

/**
 * The "…" on someone's profile (design pack S84): one sheet with Mute, Block and Block and
 * report, each one tap; Block shows the plain warning first (spec 10.4; G6). Three pills in a
 * row did not fit a phone beside Follow and Message.
 */
export function BlockButton({ them, me }: { them: Person; me: string | null }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [reporting, setReporting] = useState(false);
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

  const row = "flex min-h-12 w-full items-center text-left text-base text-ink";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("profile.more")}
        className="flex size-12 shrink-0 items-center justify-center rounded-pill border border-line bg-surface text-xl text-ink"
      >
        …
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t("profile.moreTitle", { name: them.username })}
      >
        <ul className="flex flex-col divide-y divide-line">
          {muted !== null ? (
            <li>
              <button
                type="button"
                className={row}
                onClick={() => {
                  setOpen(false);
                  void (muted ? unmute(them.user_id) : mute(them.user_id)).then(
                    (ok) => ok && setMuted(!muted),
                  );
                }}
              >
                <span className="flex flex-col">
                  <span>{muted ? t("mute.unmute") : t("mute.mute")}</span>
                  <span className="text-sm text-ink-soft">{t("mute.why")}</span>
                </span>
              </button>
            </li>
          ) : null}
          <li>
            <button
              type="button"
              className={row}
              onClick={() => {
                setOpen(false);
                if (blocked) void unblock(them.user_id).then((ok) => ok && setBlocked(false));
                else setConfirm(true);
              }}
            >
              {blocked ? t("block.unblock") : t("block.block")}
            </button>
          </li>
          {!blocked ? (
            <li>
              <button
                type="button"
                className={row}
                onClick={() => {
                  setOpen(false);
                  setReporting(true);
                }}
              >
                {t("block.andReport")}
              </button>
            </li>
          ) : null}
        </ul>
      </Sheet>
      {/* Block and report in one step (spec 10.4 #4): the report goes first, then the block. */}
      <ReportSheet
        type="profile"
        id={them.user_id}
        open={reporting}
        onOpenChange={(o) => {
          setReporting(o);
        }}
        onDone={() =>
          void block(them.user_id).then((ok) => {
            setBlocked(ok || blocked);
          })
        }
      />
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
