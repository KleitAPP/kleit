import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/kleit";
import { supabase } from "@/integrations/supabase/client";
import { saveLayout, type QuickLayout } from "@/sets/sets";
import { swatchByHex } from "@/sets/swatches";
import { t } from "@/i18n/en";

/**
 * S50 — version history (design pack §2.3; spec 5.1 #7, guardrail 1).
 *
 * The last 20 saves, 30 days, owner only - the database enforces both (migration 017's
 * `save_set_layout` trims, and the read policy is the owner's). Restore does not delete
 * anything: it saves the old layout again, as a new version, so the history keeps the restore
 * too and nothing is ever lost by restoring.
 *
 * Only the layout is versioned - template, background, caption. The pieces in the slots are
 * rows, not layout, and stay as they are.
 */
export const Route = createFileRoute("/_app/set/$setId/history")({
  head: () => ({
    meta: [{ title: "Version history" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: History,
});

type Version = { id: string; layout: QuickLayout; saved_at: string };

function History() {
  const { setId } = Route.useParams();
  const navigate = useNavigate();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("set_versions")
        .select("id, layout, saved_at")
        .eq("set_id", setId)
        .order("saved_at", { ascending: false })
        .limit(20);
      if (!cancelled) setVersions((data ?? []) as unknown as Version[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [setId]);

  async function restore(version: Version) {
    setBusy(version.id);
    setProblem(null);
    const ok = await saveLayout(setId, version.layout);
    setBusy(null);
    if (!ok) {
      setProblem(t("history.restoreFailed"));
      return;
    }
    void navigate({ to: "/set/$setId/edit", params: { setId } });
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("history.title")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("history.what")}</p>

      {problem ? (
        <p role="alert" className="mt-4 text-base text-ink">
          {problem}
        </p>
      ) : null}

      {versions === null ? (
        <div className="mt-6" role="status" aria-label={t("loading")}>
          <div className="kl-skeleton h-12 w-full rounded-md bg-surface-2" />
        </div>
      ) : versions.length === 0 ? (
        <EmptyState line={t("history.empty")} />
      ) : (
        <ol className="mt-4 divide-y divide-line">
          {versions.map((v, i) => (
            <li key={v.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-base text-ink">
                  {i === 0 ? t("history.latest") : new Date(v.saved_at).toLocaleString()}
                </p>
                <p className="truncate text-sm text-ink-soft">
                  {[
                    swatchByHex(v.layout.background ?? "").name,
                    v.layout.caption?.trim() ? `“${v.layout.caption.trim()}”` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {i === 0 ? null : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void restore(v)}
                  className="shrink-0 rounded-pill border border-line bg-surface px-4 py-2 text-sm font-medium text-ink disabled:opacity-40"
                >
                  {busy === v.id ? t("loading") : t("history.restore")}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      <Link
        to="/set/$setId"
        params={{ setId }}
        className="mt-6 flex min-h-12 w-full items-center justify-center rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink"
      >
        {t("history.back")}
      </Link>
    </div>
  );
}
