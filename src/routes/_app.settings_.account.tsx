import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { t } from "@/i18n/en";
import { tidyUsername, usernameStatus } from "@/auth/profile";

/**
 * S16 — Account (design pack §2.1).
 * Your name, bio and username are editable here (the bio is screened on the server: no phone
 * numbers or addresses, migration 062; the username at most twice every 14 days, the old one
 * held 14 days for you and nobody else, no redirect - spec 3.6 #5, migration 001's rule).
 * Changing an email needs the code-to-the-new-address flow with an
 * alert to the old one (spec 3.6 #4), and the phone number needs Twilio (M1.11); neither is
 * built, so neither is offered. Showing a field you cannot change is honest; offering a button
 * that does nothing is not.
 */
export const Route = createFileRoute("/_app/settings_/account")({
  head: () => ({ meta: [{ title: "Account" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Account,
});

function Account() {
  const [email, setEmail] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "refused" | "failed">("idle");
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameNote, setRenameNote] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);

  /** Spec 3.6 #5: the database checks the shape, the reserved list, the holds and the 2-per-14-days rule. */
  async function rename() {
    if (!userId || renameBusy) return;
    const candidate = tidyUsername(newName);
    if (!candidate || candidate === username) return;
    setRenameBusy(true);
    setRenameNote(null);
    const status = await usernameStatus(candidate);
    if (status !== "free") {
      setRenameBusy(false);
      setRenameNote(
        status === null
          ? t("account.usernameFailed")
          : status === "taken"
            ? t("username.takenPlain", { name: candidate })
            : status === "reserved"
              ? t("username.reserved", { name: candidate })
              : t("username.characters"),
      );
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ username: candidate })
      .eq("user_id", userId);
    setRenameBusy(false);
    if (error) {
      const message = (error as { message?: string }).message ?? "";
      setRenameNote(
        message.includes("14 days") && message.includes("changes")
          ? t("account.usernameTooOften")
          : message.includes("held")
            ? t("account.usernameHeld")
            : t("account.usernameFailed"),
      );
      return;
    }
    setUsername(candidate);
    setNewName("");
    setRenaming(false);
    setRenameNote(t("account.usernameChanged", { name: candidate }));
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const me = data.user;
      if (!me) return;
      if (!cancelled) {
        setEmail(me.email ?? null);
        setUserId(me.id);
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, display_name, bio")
        .eq("user_id", me.id)
        .maybeSingle();
      if (!cancelled && profile) {
        setUsername(profile.username);
        setDisplayName(profile.display_name ?? "");
        setBio(profile.bio ?? "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!userId || saved === "saving") return;
    setSaved("saving");
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName.trim().slice(0, 50), bio: bio.trim().slice(0, 160) })
      .eq("user_id", userId);
    if (!error) setSaved("saved");
    else setSaved((error as { code?: string }).code === "P0006" ? "refused" : "failed");
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("account.title")}</h1>
      <form
        className="mt-6 rounded-md border border-line bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="block text-sm text-ink-soft">
          {t("account.displayName")}
          <input
            type="text"
            value={displayName}
            maxLength={50}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved("idle");
            }}
            className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        </label>
        <label className="mt-3 block text-sm text-ink-soft">
          {t("account.bio")}
          <textarea
            value={bio}
            maxLength={160}
            rows={3}
            onChange={(e) => {
              setBio(e.target.value);
              setSaved("idle");
            }}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink"
          />
        </label>
        <p className="mt-1 text-sm text-ink-soft">
          {t("account.bioRule", { count: 160 - bio.length })}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={saved === "saving"}
            className="min-h-12 rounded-pill bg-brand px-5 text-base font-medium text-brand-ink disabled:opacity-40"
          >
            {t("account.save")}
          </button>
          <span
            role="status"
            className={`text-sm ${saved === "refused" || saved === "failed" ? "text-danger" : "text-ink-soft"}`}
          >
            {saved === "saved"
              ? t("saved")
              : saved === "refused"
                ? t("screen.noContact")
                : saved === "failed"
                  ? t("notSaved")
                  : ""}
          </span>
        </div>
      </form>
      <dl className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
        <Field label={t("account.email")} value={email ?? ""} />
        <Field
          label={t("account.username")}
          value={username ? `@${username}` : ""}
          why={t("account.usernameRule")}
        />
        <div className="border-t border-line px-4 py-3">
          {renaming ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void rename();
              }}
            >
              <label className="block text-sm text-ink-soft">
                {t("account.newUsername")}
                <input
                  type="text"
                  value={newName}
                  maxLength={30}
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setRenameNote(null);
                  }}
                  className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
                />
              </label>
              <p className="text-sm text-ink-soft">{t("account.usernameWarning")}</p>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={
                    renameBusy || !tidyUsername(newName) || tidyUsername(newName) === username
                  }
                  className="min-h-12 rounded-pill bg-brand px-5 text-base font-medium text-brand-ink disabled:opacity-40"
                >
                  {renameBusy ? t("loading") : t("account.changeUsername")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(false);
                    setRenameNote(null);
                  }}
                  className="min-h-12 rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink"
                >
                  {t("break.cancel")}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setRenaming(true)}
              className="min-h-12 rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink"
            >
              {t("account.changeUsername")}
            </button>
          )}
          {renameNote ? (
            <p role="status" className="mt-2 text-sm text-ink">
              {renameNote}
            </p>
          ) : null}
        </div>
        <Field label={t("account.phone")} value={t("account.phoneNone")} />
      </dl>
    </div>
  );
}

function Field({ label, value, why }: { label: string; value: string; why?: string }) {
  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="mt-1 break-all text-base text-ink">{value}</dd>
      {why ? <p className="mt-1 text-sm text-ink-soft">{why}</p> : null}
    </div>
  );
}
