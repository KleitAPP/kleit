import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";
import { myRoles } from "@/safety/moderation";

/**
 * S102 — the emergency switches (M7.3; spec 22.2; WA8). Admins only, through our own app, never
 * the dashboard. Each switch is a row in `app_settings`; the database and the Worker read them
 * live, so a flip bites within a second. Every flip is logged.
 */
export const Route = createFileRoute("/_app/mod_/switches")({
  head: () => ({ meta: [{ title: "Switches" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Switches,
});

const SWITCHES = [
  "maintenance_mode",
  "signups_open",
  "posting_open",
  "dms_open",
  "comments_open",
  "public_links_open",
] as const;
type Key = (typeof SWITCHES)[number];

function Switches() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [values, setValues] = useState<Record<string, boolean>>({});
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    const { data } = await supabase.from("app_settings").select("key, value");
    const v: Record<string, boolean> = {};
    for (const r of data ?? []) {
      if (r.key === "min_app_version") setVersion(String(r.value).replace(/"/g, ""));
      else v[r.key] = r.value === true || r.value === "true";
    }
    setValues(v);
  }
  useEffect(() => {
    void myRoles().then(async (r) => {
      const ok = r.includes("admin");
      setAllowed(ok);
      if (ok) await refresh();
    });
  }, []);

  // The log row needs a target id; for a switch that is the admin's own account.
  async function logged(reason: string) {
    const { data } = await supabase.auth.getUser();
    const me = data.user?.id;
    if (me)
      await supabase.rpc("log_private_view", { p_what: "switch", p_target: me, p_reason: reason });
  }

  async function flip(key: Key) {
    if (busy) return;
    setBusy(key);
    const next = !(values[key] ?? false);
    const { error } = await supabase.from("app_settings").update({ value: next }).eq("key", key);
    if (!error) {
      await supabase.rpc("log_private_view", {
        p_what: "switch",
        p_target: null,
        p_reason: `${key} → ${next}`,
      });
      await refresh();
    }
    setBusy(null);
  }

  async function saveVersion() {
    if (!/^\d+\.\d+\.\d+$/.test(version)) return;
    setBusy("min_app_version");
    const { error } = await supabase
      .from("app_settings")
      .update({ value: version })
      .eq("key", "min_app_version");
    if (!error)
      await supabase.rpc("log_private_view", {
        p_what: "switch",
        p_target: null,
        p_reason: `min_app_version → ${version}`,
      });
    setBusy(null);
  }

  if (allowed === null) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("mod.notHere")} />
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("switches.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("switches.why")}</p>
      <ul className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
        {SWITCHES.map((k) => {
          const on = values[k] ?? false;
          return (
            <li
              key={k}
              className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-base text-ink">{t(`switches.${k}`)}</p>
                <p className="text-sm text-ink-soft">{t(`switches.${k}.why`)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                disabled={busy !== null}
                onClick={() => void flip(k)}
                className={`min-h-11 shrink-0 rounded-pill border px-4 text-sm ${on ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink"}`}
              >
                {on ? t("switches.on") : t("switches.off")}
              </button>
            </li>
          );
        })}
      </ul>
      <label className="mt-4 block">
        <span className="text-sm text-ink-soft">{t("switches.min_app_version")}</span>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="min-h-12 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
          <button
            type="button"
            onClick={() => void saveVersion()}
            disabled={busy !== null}
            className="min-h-12 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
          >
            {t("switches.save")}
          </button>
        </div>
        <span className="text-sm text-ink-soft">{t("switches.min_app_version.why")}</span>
      </label>
    </div>
  );
}
