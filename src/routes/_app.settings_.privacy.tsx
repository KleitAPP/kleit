import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { Chip, PrimaryButton, Sheet, Toast } from "@/components/kleit";
import { t } from "@/i18n/en";
import { refreshPreview } from "@/sets/sets";

/**
 * S19 — Privacy (design pack §2.1; spec 3.6).
 *
 * Every switch here is a column on `profiles` that the database itself enforces, so turning one
 * on is not a request to the app to be discreet — a second account's read is refused by the row
 * policy whatever the app does.
 *
 * Two rules the first version got wrong, both found in testing:
 *  - a save that fails must SAY so. It used to put the switch back with no word of explanation,
 *    which reads as the app being haunted.
 *  - one switch at a time. The old handler captured the state as it was before the tap, so two
 *    fast taps on different switches could have the first one's failure undo the second one's
 *    success. Each row is now locked while its own save is in flight, and every state change goes
 *    through the updater form so it works from whatever the latest state is, not a stale copy.
 *
 * Two one-tap changes to every set at once (spec 7.1 #5, #10; migration 077): "make all my
 * sets link-only" and "Lock down". Each asks once, in plain words, because the second cannot be
 * undone in one tap - every link ever sent dies - and both are one server function, so there is
 * no half-done state. After a lock-down the chat pictures come down too, set by set.
 */
export const Route = createFileRoute("/_app/settings_/privacy")({
  head: () => ({ meta: [{ title: "Privacy" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Privacy,
});

/** Spec 10.2 #4: Everyone / Followers (default) / People I follow / No one. */
const DM_CHOICES = ["everyone", "followers", "following", "nobody"] as const;
type DmSetting = (typeof DM_CHOICES)[number];
/** Spec 11 #1 / gap C10: the default for new sets; each set can differ. */
const COMMENT_CHOICES = ["everyone", "following", "off"] as const;
type CommentsDefault = (typeof COMMENT_CHOICES)[number];
/** Spec 7.4 #4: who may mention you in a comment; "people I follow" by default. */
const MENTION_CHOICES = ["everyone", "following", "nobody"] as const;
type MentionSetting = (typeof MENTION_CHOICES)[number];

type Switches = {
  is_private: boolean;
  findable_by_email: boolean;
  findable_by_phone: boolean;
  suggestable: boolean;
};

const ROWS: { key: keyof Switches; title: string; why?: string }[] = [
  { key: "is_private", title: t("privacy.privateAccount"), why: t("privacy.privateWhy") },
  { key: "findable_by_email", title: t("privacy.findEmail") },
  { key: "findable_by_phone", title: t("privacy.findPhone") },
  { key: "suggestable", title: t("privacy.suggest") },
];

function Privacy() {
  const [now, setNow] = useState<Switches | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<keyof Switches | null>(null);
  const [dm, setDm] = useState<DmSetting | null>(null);
  const [commentsDefault, setCommentsDefault] = useState<CommentsDefault | null>(null);
  const [mention, setMention] = useState<MentionSetting | null>(null);
  const [bulk, setBulk] = useState<"linkOnly" | "lockDown" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function runBulk(which: "linkOnly" | "lockDown") {
    setBulkBusy(true);
    const { data, error } = await supabase.rpc(
      which === "lockDown" ? "lock_down" : "make_all_link_only",
    );
    setBulkBusy(false);
    setBulk(null);
    if (error || typeof data !== "number") {
      setNotice(t("privacy.bulkFailed"));
      return;
    }
    setNotice(
      t(which === "lockDown" ? "privacy.lockDownDone" : "privacy.linkOnlyDone", { count: data }),
    );
    if (which === "lockDown") {
      // The chat pictures of what was public come down with the links (spec 7.1 #8).
      const { data: who } = await supabase.auth.getUser();
      const me = who.user?.id;
      if (!me) return;
      const { data: mine } = await supabase
        .from("sets")
        .select("id")
        .eq("owner_id", me)
        .eq("status", "published")
        .not("preview_image_id", "is", null);
      for (const row of mine ?? []) refreshPreview(row.id);
    }
  }

  async function chooseComments(next: CommentsDefault) {
    if (commentsDefault === null) return;
    const before = commentsDefault;
    setCommentsDefault(next);
    setFailed(false);
    const { data } = await supabase.auth.getUser();
    const me = data.user?.id;
    const { error } = me
      ? await supabase.from("profiles").update({ comments_default: next }).eq("user_id", me)
      : { error: new Error("signed out") };
    if (error) {
      setCommentsDefault(before);
      setFailed(true);
    } else setSaved(true);
  }

  async function chooseMention(next: MentionSetting) {
    if (mention === null) return;
    const before = mention;
    setMention(next);
    setFailed(false);
    const { data } = await supabase.auth.getUser();
    const me = data.user?.id;
    const { error } = me
      ? await supabase.from("profiles").update({ mention_setting: next }).eq("user_id", me)
      : { error: new Error("signed out") };
    if (error) {
      setMention(before);
      setFailed(true);
    } else setSaved(true);
  }

  async function chooseDm(next: DmSetting) {
    if (dm === null) return;
    const before = dm;
    setDm(next);
    setFailed(false);
    const { data } = await supabase.auth.getUser();
    const me = data.user?.id;
    const { error } = me
      ? await supabase.from("profiles").update({ dm_setting: next }).eq("user_id", me)
      : { error: new Error("signed out") };
    if (error) {
      setDm(before);
      setFailed(true);
    } else setSaved(true);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.id;
      if (!me) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select(
          "is_private, findable_by_email, findable_by_phone, suggestable, dm_setting, comments_default, mention_setting",
        )
        .eq("user_id", me)
        .maybeSingle();
      if (!cancelled && profile) {
        const { dm_setting, comments_default, mention_setting, ...switches } = profile;
        setMention(
          (MENTION_CHOICES.find((c) => c === mention_setting) ?? "following") as MentionSetting,
        );
        setNow(switches);
        setCommentsDefault(
          (COMMENT_CHOICES.find((c) => c === comments_default) ?? "everyone") as CommentsDefault,
        );
        setDm((DM_CHOICES.find((c) => c === dm_setting) ?? "followers") as DmSetting);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function flip(key: keyof Switches) {
    if (!now || busy) return;
    setBusy(key);
    setFailed(false);
    // Move the switch at once; the database is the slow part, not the person. Every write to the
    // state goes through the updater form, so it flips whatever the latest value is rather than a
    // copy taken when the tap happened.
    const next: Switches = { ...now, [key]: !now[key] };
    setNow((live) => (live ? { ...live, [key]: !live[key] } : live));
    const { data } = await supabase.auth.getUser();
    const me = data.user?.id;
    if (!me) {
      setBusy(null);
      setFailed(true);
      setNow((live) => (live ? { ...live, [key]: !live[key] } : live));
      return;
    }
    // Written out rather than built from a variable, so the generated types still check that
    // each of these really is a column on profiles.
    const patch =
      key === "is_private"
        ? { is_private: next.is_private }
        : key === "findable_by_email"
          ? { findable_by_email: next.findable_by_email }
          : key === "findable_by_phone"
            ? { findable_by_phone: next.findable_by_phone }
            : { suggestable: next.suggestable };
    const { error } = await supabase.from("profiles").update(patch).eq("user_id", me);
    setBusy(null);
    if (error) {
      // Put that one switch back — not the whole set, which would wipe a save that did land.
      setNow((live) => (live ? { ...live, [key]: !live[key] } : live));
      setFailed(true);
      return;
    }
    setSaved(true);
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("privacy.title")}</h1>

      <ul className="mt-6 overflow-hidden rounded-md border border-line bg-surface">
        {ROWS.map(({ key, title, why }) => (
          <li key={key} className="border-b border-line last:border-b-0">
            <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-base text-ink">{title}</span>
                {why ? <span className="block text-sm text-ink-soft">{why}</span> : null}
              </span>
              <input
                type="checkbox"
                checked={now?.[key] ?? false}
                disabled={now === null || busy !== null}
                onChange={() => void flip(key)}
                className="size-6 shrink-0 accent-brand"
              />
            </label>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 text-base font-medium text-ink">{t("privacy.dm")}</h2>
      <p className="text-sm text-ink-soft">{t("privacy.dmWhy")}</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t("privacy.dm")}>
        {DM_CHOICES.map((c) => (
          <Chip
            key={c}
            label={t(`privacy.dm.${c}`)}
            selected={dm === c}
            onToggle={() => void chooseDm(c)}
          />
        ))}
      </div>

      <h2 className="mt-6 text-base font-medium text-ink">{t("privacy.commentsDefault")}</h2>
      <p className="text-sm text-ink-soft">{t("social.settingWhy")}</p>
      <div
        className="mt-2 flex flex-wrap gap-2"
        role="group"
        aria-label={t("privacy.commentsDefault")}
      >
        {COMMENT_CHOICES.map((c) => (
          <Chip
            key={c}
            label={t(`social.setting.${c}`)}
            selected={commentsDefault === c}
            onToggle={() => void chooseComments(c)}
          />
        ))}
      </div>

      <h2 className="mt-6 text-base font-medium text-ink">{t("privacy.mentions")}</h2>
      <p className="text-sm text-ink-soft">{t("privacy.mentionsWhy")}</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t("privacy.mentions")}>
        {MENTION_CHOICES.map((c) => (
          <Chip
            key={c}
            label={t(`privacy.mention.${c}`)}
            selected={mention === c}
            onToggle={() => void chooseMention(c)}
          />
        ))}
      </div>

      <h2 className="mt-8 text-base font-medium text-ink">{t("privacy.links")}</h2>
      <p className="text-sm text-ink-soft">{t("privacy.linksWhy")}</p>
      <div className="mt-2 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setBulk("linkOnly")}
          className="flex min-h-12 w-full items-center justify-between rounded-md border border-line bg-surface px-4 text-left text-base text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("privacy.linkOnly")}
        </button>
        <button
          type="button"
          onClick={() => setBulk("lockDown")}
          className="flex min-h-12 w-full flex-col items-start justify-center rounded-md border border-danger bg-surface px-4 py-2 text-left transition-colors duration-fast hover:bg-surface-2"
        >
          <span className="text-base font-medium text-danger">{t("privacy.lockDown")}</span>
          <span className="text-sm text-ink-soft">{t("privacy.lockDownHint")}</span>
        </button>
      </div>
      {notice ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-line bg-surface p-3 text-sm text-ink"
        >
          {notice}
        </p>
      ) : null}

      <Sheet
        open={bulk !== null}
        onOpenChange={(open) => {
          if (!open) setBulk(null);
        }}
        title={bulk === "lockDown" ? t("privacy.lockDown") : t("privacy.linkOnly")}
        description={
          bulk === "lockDown" ? t("privacy.lockDownWarning") : t("privacy.linkOnlyWarning")
        }
        action={
          <PrimaryButton
            onClick={() => {
              if (bulk) void runBulk(bulk);
            }}
            disabled={bulkBusy}
          >
            {bulk === "lockDown" ? t("privacy.lockDownConfirm") : t("privacy.linkOnlyConfirm")}
          </PrimaryButton>
        }
      />

      {saved ? (
        <Toast message={t("privacy.saved")} tone="positive" onDismiss={() => setSaved(false)} />
      ) : null}
      {failed ? (
        <Toast message={t("privacy.failed")} tone="danger" onDismiss={() => setFailed(false)} />
      ) : null}
    </div>
  );
}
