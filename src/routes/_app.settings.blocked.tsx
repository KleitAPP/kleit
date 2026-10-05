import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";
import { blockedPeople, unblock, type Blocked } from "@/social/blocks";

/** Settings > Blocked accounts (spec 10.4 #4): the list, with Unblock. */
export const Route = createFileRoute("/_app/settings/blocked")({
  head: () => ({
    meta: [{ title: "Blocked accounts" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: BlockedAccounts,
});

function BlockedAccounts() {
  const [rows, setRows] = useState<Blocked[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void blockedPeople().then((r) => !cancelled && setRows(r));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("settings.blocked")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("block.signedOutNote")}</p>
      {rows === null ? (
        <div className="kl-skeleton mt-4 h-24 w-full rounded-md bg-surface-2" />
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("block.none")} />
        </div>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
          {rows.map((p) => (
            <li
              key={p.user_id}
              className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-base text-ink">
                  {p.display_name?.trim() || p.username}
                </p>
                <p className="truncate text-sm text-ink-soft">
                  @{p.username} · {t("block.blockedOn")}{" "}
                  {new Date(p.blocked_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  void unblock(p.user_id).then(
                    (ok) => ok && setRows(rows.filter((r) => r.user_id !== p.user_id)),
                  )
                }
                className="min-h-11 shrink-0 rounded-pill border border-line bg-surface px-4 text-sm font-medium text-ink"
              >
                {t("block.unblock")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
