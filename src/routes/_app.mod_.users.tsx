import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";
import { myRoles } from "@/safety/moderation";
import { ACCOUNT_LABELS, asAccountLabel, labelText, type AccountLabel } from "@/social/labels";

/**
 * S100 — the user lookup (M7.3; spec 13.4 #9). Moderators only. Every lookup needs a reason
 * and is written to the audit log before anything is shown; suspend and lift are logged too.
 */
export const Route = createFileRoute("/_app/mod_/users")({
  head: () => ({
    meta: [{ title: "Look up a person" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: UserLookup,
});

type Found = {
  user_id: string;
  username: string;
  display_name: string;
  created_at: string;
  banned_at: string | null;
  deactivated_at: string | null;
  is_private: boolean;
  points: number;
  live_strikes: number;
  reports_about: number;
  sets_published: number;
  actions: { action: string; note: string; at: string }[];
};

function UserLookup() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [admin, setAdmin] = useState(false);
  const [label, setLabel] = useState<AccountLabel>("none");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [found, setFound] = useState<Found | null | "none">(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void myRoles().then((r) => {
      setAllowed(r.includes("admin") || r.includes("moderator"));
      setAdmin(r.includes("admin"));
    });
  }, []);

  async function look() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const { data, error } = await supabase.rpc("admin_user_lookup", {
      p_username: name,
      p_reason: reason,
    });
    setBusy(false);
    if (error) {
      setProblem(t("mod.lookupFailed"));
      return;
    }
    const row = (data ?? [])[0] as Found | undefined;
    setFound(row ?? "none");
    if (row) {
      const { data: p } = await supabase
        .from("profiles")
        .select("label")
        .eq("user_id", row.user_id)
        .maybeSingle();
      setLabel(asAccountLabel(p?.label));
    }
  }

  /** Staff, stylist or brand (spec 11 #9): one call, logged; the page re-reads afterwards. */
  async function relabel(next: AccountLabel) {
    if (found === null || found === "none" || busy || next === label) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_account_label", {
      p_username: found.username,
      p_label: next,
    });
    setBusy(false);
    if (!error) await look();
  }

  async function suspend(on: boolean) {
    if (found === null || found === "none" || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_suspended", {
      p_user: found.user_id,
      p_on: on,
      p_reason: reason,
    });
    setBusy(false);
    if (!error) await look();
  }

  if (allowed === null) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("mod.notHere")} />
      </div>
    );
  }
  const f = found;
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("mod.users")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("mod.usersWhy")}</p>
      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void look();
        }}
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("mod.username")}
          aria-label={t("mod.username")}
          className="min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
        />
        <input
          type="text"
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("mod.reason")}
          aria-label={t("mod.reason")}
          className="min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
        />
        <PrimaryButton
          onClick={() => void look()}
          disabled={busy || name.trim().length < 2 || reason.trim().length < 3}
        >
          {t("mod.lookUp")}
        </PrimaryButton>
        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}
      </form>

      {f === "none" ? (
        <p className="mt-4 text-sm text-ink-soft">{t("mod.nobody")}</p>
      ) : f ? (
        <div className="mt-4 rounded-md border border-line bg-surface p-4">
          <p className="text-base font-medium text-ink">
            {f.display_name?.trim() || f.username}{" "}
            <span className="text-ink-soft">@{f.username}</span>
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {t("mod.since", {
              date: new Date(f.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              }),
            })}
            {f.is_private ? ` · ${t("mod.private")}` : ""}
            {f.deactivated_at ? ` · ${t("mod.onBreak")}` : ""}
            {f.banned_at ? ` · ${t("mod.suspended")}` : ""}
            {labelText(label) ? ` · ${labelText(label)}` : ""}
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-2 text-sm text-ink">
            <li>{t("mod.setsN", { count: f.sets_published })}</li>
            <li>{t("points.count", { count: f.points })}</li>
            <li>{t("mod.strikesN", { count: f.live_strikes })}</li>
            <li>{t("mod.reportsAbout", { count: f.reports_about })}</li>
          </ul>
          {f.actions.length ? (
            <ul className="mt-3 flex flex-col gap-1">
              {f.actions.map((a, i) => (
                <li key={i} className="text-sm text-ink-soft">
                  {new Date(a.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ·{" "}
                  {a.action}
                  {a.note ? ` — ${a.note}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {admin ? (
            <div className="mt-3">
              <p className="text-sm text-ink-soft">{t("mod.label")}</p>
              <p className="text-sm text-ink-soft">{t("mod.labelWhy")}</p>
              <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label={t("mod.label")}>
                {ACCOUNT_LABELS.map((l) => (
                  <Chip
                    key={l}
                    label={labelText(l) ?? t("label.none")}
                    selected={label === l}
                    onToggle={() => void relabel(l)}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-3">
            {f.banned_at ? (
              <button
                type="button"
                onClick={() => void suspend(false)}
                className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
              >
                {t("mod.lift")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void suspend(true)}
                className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-danger"
              >
                {t("mod.act.ban")}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
