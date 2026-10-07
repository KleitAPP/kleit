import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";
import { myRoles } from "@/safety/moderation";

/**
 * The log (spec 13.4 #9): every moderator act (`moderation_actions`, moderators read) and every
 * admin view of private data with its reason (`admin_audit_log`, admins read). Read-only; nothing
 * here can be changed by anyone. A moderator who is not an admin sees the first list only.
 */
export const Route = createFileRoute("/_app/mod_/log")({
  head: () => ({ meta: [{ title: "The log" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: ModLog,
});

type Action = {
  id: string;
  moderator_id: string | null;
  target_type: string;
  target_id: string;
  action: string;
  note: string;
  created_at: string;
};
type Audit = {
  id: number;
  admin_id: string | null;
  what: string;
  target_id: string | null;
  reason: string;
  created_at: string;
};
type ActionKey =
  `mod.action.${"dismiss" | "remove" | "strike" | "ban" | "unban" | "restore" | "overturn" | "uphold"}`;
type AuditKey = `mod.audit.${"dm_evidence" | "user_lookup" | "switch" | "ban" | "unban"}`;

function ModLog() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [admin, setAdmin] = useState(false);
  const [actions, setActions] = useState<Action[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    void myRoles().then(async (r) => {
      const ok = r.includes("admin") || r.includes("moderator");
      setAllowed(ok);
      setAdmin(r.includes("admin"));
      if (!ok) return;
      const [{ data: a }, { data: b }] = await Promise.all([
        supabase
          .from("moderation_actions")
          .select("id, moderator_id, target_type, target_id, action, note, created_at")
          .order("created_at", { ascending: false })
          .limit(200),
        r.includes("admin")
          ? supabase
              .from("admin_audit_log")
              .select("id, admin_id, what, target_id, reason, created_at")
              .order("created_at", { ascending: false })
              .limit(200)
          : Promise.resolve({ data: [] as Audit[] }),
      ]);
      setActions((a ?? []) as Action[]);
      setAudit((b ?? []) as Audit[]);
      const ids = [
        ...new Set(
          [...(a ?? []).map((x) => x.moderator_id), ...(b ?? []).map((x) => x.admin_id)].filter(
            (x): x is string => !!x,
          ),
        ),
      ];
      if (ids.length) {
        const { data: people } = await supabase
          .from("profiles")
          .select("user_id, username")
          .in("user_id", ids);
        setNames(Object.fromEntries((people ?? []).map((p) => [p.user_id, p.username])));
      }
    });
  }, []);

  if (allowed === null) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("mod.notHere")} />
      </div>
    );
  }
  const when = (iso: string) => new Date(iso).toLocaleString();
  const who = (id: string | null) => (id ? `@${names[id] ?? "…"}` : t("mod.server"));
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("mod.log")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("mod.logWhy")}</p>

      <h2 className="mt-6 font-display text-xl text-ink">{t("mod.logActions")}</h2>
      {actions.length === 0 ? (
        <div className="mt-2">
          <EmptyState line={t("mod.empty")} />
        </div>
      ) : (
        <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
          {actions.map((x) => (
            <li key={x.id} className="border-b border-line px-4 py-3 last:border-b-0">
              <p className="text-base text-ink">
                {who(x.moderator_id)} · {t(`mod.action.${x.action}` as ActionKey)} · {x.target_type}
              </p>
              <p className="text-sm text-ink-soft">
                {when(x.created_at)}
                {x.note ? ` · ${x.note}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {admin ? (
        <>
          <h2 className="mt-6 font-display text-xl text-ink">{t("mod.logAudit")}</h2>
          {audit.length === 0 ? (
            <div className="mt-2">
              <EmptyState line={t("mod.empty")} />
            </div>
          ) : (
            <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
              {audit.map((x) => (
                <li key={x.id} className="border-b border-line px-4 py-3 last:border-b-0">
                  <p className="text-base text-ink">
                    {who(x.admin_id)} · {t(`mod.audit.${x.what}` as AuditKey)}
                  </p>
                  <p className="text-sm text-ink-soft">
                    {when(x.created_at)}
                    {x.reason ? ` · ${x.reason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
