import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { betaOnly } from "@/auth/beta";
import { EmptyState, PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";
import { siteUrl } from "@/lib/site";
import { myRoles } from "@/safety/moderation";

/**
 * Beta invites (S111's other half; migration 087). Admins mint codes with a label, a number of
 * uses and an end date, hand out the link (`/welcome?invite=CODE`, which keeps the code so
 * nobody types it) or the code itself, and switch a code off if it gets out. Who used which
 * code is listed. The codes only bite while the `beta_only` switch is on.
 */
export const Route = createFileRoute("/_app/mod_/invites")({
  head: () => ({
    meta: [{ title: "Beta invites" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Invites,
});

type Row = {
  code: string;
  label: string;
  uses_left: number;
  expires_at: string | null;
  disabled_at: string | null;
  created_at: string;
  used_by: string[];
};

function Invites() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [on, setOn] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [fresh, setFresh] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [count, setCount] = useState(1);
  const [uses, setUses] = useState(1);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function refresh() {
    const [{ data }, isOn] = await Promise.all([supabase.rpc("admin_beta_invites"), betaOnly()]);
    setRows((data ?? []) as Row[]);
    setOn(isOn);
  }
  useEffect(() => {
    let cancelled = false;
    void myRoles().then(async (r) => {
      const ok = r.includes("admin");
      if (cancelled) return;
      setAllowed(ok);
      if (ok) await refresh();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function mint() {
    if (busy) return;
    setBusy(true);
    const { data } = await supabase.rpc("mint_beta_invites", {
      p_label: label.trim(),
      p_count: count,
      p_uses: uses,
      p_days: days,
    });
    setFresh((data ?? []) as string[]);
    await refresh();
    setBusy(false);
  }

  async function switchOff(code: string) {
    if (busy) return;
    setBusy(true);
    await supabase.rpc("disable_beta_invite", { p_code: code });
    await refresh();
    setBusy(false);
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(siteUrl(`/welcome?invite=${code}`));
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* no clipboard: the code is on the screen to copy by hand */
    }
  }

  if (allowed === null) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("mod.notHere")} />
      </div>
    );
  }

  const clamp = (v: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("invites.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("invites.why")}</p>
      <p
        className={`mt-2 rounded-md border px-3 py-2 text-sm ${on ? "border-ink text-ink" : "border-line text-ink-soft"}`}
      >
        {on ? t("invites.switchOn") : t("invites.switchOff")}{" "}
        {!on ? (
          <Link to="/mod/switches" className="underline underline-offset-2">
            {t("mod.switches")}
          </Link>
        ) : null}
      </p>

      <form
        className="mt-4 flex flex-col gap-2 rounded-md border border-line bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void mint();
        }}
      >
        <p className="text-base font-medium text-ink">{t("invites.mint")}</p>
        <label className="block">
          <span className="text-sm text-ink-soft">{t("invites.label")}</span>
          <input
            type="text"
            value={label}
            maxLength={80}
            placeholder={t("invites.labelPlaceholder")}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="block">
            <span className="text-sm text-ink-soft">{t("invites.count")}</span>
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(clamp(Number(e.target.value), 1, 50, 1))}
              className="mt-1 min-h-12 w-24 rounded-md border border-line bg-surface px-3 text-base text-ink"
            />
          </label>
          <label className="block">
            <span className="text-sm text-ink-soft">{t("invites.uses")}</span>
            <input
              type="number"
              min={1}
              max={500}
              value={uses}
              onChange={(e) => setUses(clamp(Number(e.target.value), 1, 500, 1))}
              className="mt-1 min-h-12 w-24 rounded-md border border-line bg-surface px-3 text-base text-ink"
            />
          </label>
          <label className="block">
            <span className="text-sm text-ink-soft">{t("invites.days")}</span>
            <input
              type="number"
              min={0}
              max={365}
              value={days}
              onChange={(e) => setDays(clamp(Number(e.target.value), 0, 365, 30))}
              className="mt-1 min-h-12 w-24 rounded-md border border-line bg-surface px-3 text-base text-ink"
            />
          </label>
        </div>
        <PrimaryButton onClick={() => void mint()} disabled={busy}>
          {t("invites.mintGo")}
        </PrimaryButton>
      </form>

      {fresh.length > 0 ? (
        <div className="mt-4 rounded-md border border-ink bg-surface p-3">
          <p className="text-sm text-ink-soft">{t("invites.fresh")}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {fresh.map((code) => (
              <li key={code} className="flex items-center justify-between gap-2">
                <span className="font-mono text-lg tracking-widest text-ink">{code}</span>
                <button
                  type="button"
                  onClick={() => void copy(code)}
                  className="min-h-11 rounded-pill border border-line bg-surface px-3 text-sm text-ink"
                >
                  {copied === code ? t("invites.copied") : t("invites.copyLink")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">{t("invites.none")}</p>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-md border border-line bg-surface">
          {rows.map((r) => {
            const ended = !!r.expires_at && Date.parse(r.expires_at) <= Date.now();
            const dead = !!r.disabled_at || ended || r.uses_left <= 0;
            const state = r.disabled_at
              ? t("invites.offDone")
              : ended
                ? t("invites.expired")
                : r.uses_left <= 0
                  ? t("invites.spent")
                  : t("invites.usesLeft", { count: r.uses_left });
            return (
              <li key={r.code} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`font-mono text-base tracking-widest ${dead ? "text-ink-soft line-through" : "text-ink"}`}
                  >
                    {r.code}
                  </span>
                  <span className="text-sm text-ink-soft">{state}</span>
                </div>
                {r.label ? <p className="mt-1 text-sm text-ink">{r.label}</p> : null}
                {r.used_by.length > 0 ? (
                  <p className="mt-1 text-sm text-ink-soft">
                    {t("invites.usedBy")} {r.used_by.map((u) => `@${u}`).join(", ")}
                  </p>
                ) : null}
                {!dead ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void copy(r.code)}
                      className="min-h-11 rounded-pill border border-line bg-surface px-3 text-sm text-ink"
                    >
                      {copied === r.code ? t("invites.copied") : t("invites.copyLink")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void switchOff(r.code)}
                      className="min-h-11 rounded-pill border border-line bg-surface px-3 text-sm text-danger"
                    >
                      {t("invites.off")}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
