import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";
import { myRoles, whyItFailed } from "@/safety/moderation";

/**
 * Takedown requests for moderators (M7.4; spec 13.3 #3–#4; 10.5 #2, #4): TAKE IT DOWN first (48
 * hours), then copyright, impersonation and trademark (72). To remove a picture, paste the item
 * id from the link the sender gave; the picture, its fingerprint and every identical copy go
 * together. An impersonation or trademark claim is acted on through the people tools (a label,
 * a rename, a suspension) and then resolved here, which records the decision; an ID photo opens
 * through the id-photo function - a two-minute address, only for a moderator (migration 108).
 */
export const Route = createFileRoute("/_app/mod_/takedowns")({
  head: () => ({
    meta: [{ title: "Takedowns" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Takedowns,
});

type Row = {
  id: string;
  request_ref: string;
  kind: "intimate" | "copyright" | "impersonation" | "trademark";
  id_paths: string[];
  name: string;
  email: string;
  urls: string[];
  details: string;
  work: string;
  signature: string;
  created_at: string;
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function Takedowns() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [item, setItem] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Record<string, string>>({});

  async function refresh() {
    const { data } = await supabase
      .from("takedown_requests")
      .select(
        "id, request_ref, kind, name, email, urls, details, work, signature, id_paths, created_at",
      )
      .eq("state", "open")
      .order("kind")
      .order("created_at");
    setRows((data ?? []) as Row[]);
  }
  useEffect(() => {
    void myRoles().then(async (r) => {
      const ok = r.includes("admin") || r.includes("moderator");
      setAllowed(ok);
      if (ok) await refresh();
    });
  }, []);

  /** Opens one ID photo in a new tab: the function signs a two-minute address for a moderator. */
  async function openPhoto(path: string) {
    const { data, error } = await supabase.functions.invoke<{ url?: string }>(
      `id-photo?path=${encodeURIComponent(path)}`,
      { method: "GET" },
    );
    if (error || !data?.url) {
      setFailure({ ...failure, photo: t("takedowns.photoFailed") });
      return;
    }
    window.open(data.url, "_blank", "noopener");
  }

  async function resolve(r: Row, outcome: "removed" | "rejected") {
    if (busy) return;
    setBusy(r.id);
    const guess = item[r.id]?.trim() || r.urls.map((u) => UUID.exec(u)?.[0]).find(Boolean) || "";
    const { error } = await supabase.rpc("takedown_resolve", {
      p_id: r.id,
      p_outcome: outcome,
      p_note: note[r.id] ?? "",
      ...(outcome === "removed" && guess ? { p_item: guess } : {}),
    });
    setBusy(null);
    const problem = whyItFailed(error);
    setFailure({ ...failure, [r.id]: problem ?? "" });
    if (!problem || problem === t("mod.err.done")) await refresh();
  }

  if (allowed === null) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("mod.notHere")} />
      </div>
    );
  }
  const hoursLeft = (r: Row) => {
    const due = Date.parse(r.created_at) + (r.kind === "intimate" ? 48 : 72) * 3600 * 1000;
    return Math.round((due - Date.now()) / 3600 / 1000);
  };
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("takedowns.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("takedowns.why")}</p>
      {failure["photo"] ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {failure["photo"]}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("mod.empty")} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {rows.map((r) => {
            const left = hoursLeft(r);
            return (
              <li key={r.id} className="rounded-md border border-line bg-surface p-3 shadow-card">
                <p className="text-sm text-ink-soft">
                  {r.request_ref} · {t(`takedowns.${r.kind}`)} ·{" "}
                  <span className={left < 6 ? "font-medium text-danger" : ""}>
                    {t("takedowns.due", { count: left })}
                  </span>
                </p>
                <p className="mt-1 text-base text-ink">
                  {r.name} <span className="text-ink-soft">{r.email}</span>
                </p>
                <ul className="mt-1 text-sm text-ink">
                  {r.urls.map((u) => (
                    <li key={u} className="break-all">
                      {u}
                    </li>
                  ))}
                </ul>
                {r.details ? <p className="mt-1 text-sm text-ink-soft">“{r.details}”</p> : null}
                {r.work ? (
                  <p className="mt-1 text-sm text-ink-soft">
                    {t("takedowns.work")}: {r.work}
                  </p>
                ) : null}
                {r.signature ? (
                  <p className="mt-1 text-sm text-ink-soft">
                    {t("takedowns.signed")}: {r.signature}
                  </p>
                ) : null}
                {r.id_paths.length > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-ink-soft">{t("takedowns.idPhotos")}</span>
                    {r.id_paths.map((path, n) => (
                      <button
                        key={path}
                        type="button"
                        onClick={() => void openPhoto(path)}
                        className="underline underline-offset-2 text-ink"
                      >
                        {t("takedowns.idPhoto", { count: n + 1 })}
                      </button>
                    ))}
                  </div>
                ) : null}
                {r.kind === "impersonation" || r.kind === "trademark" ? (
                  <p className="mt-1 text-sm text-ink-soft">{t("takedowns.claimHow")}</p>
                ) : null}
                <input
                  type="text"
                  value={item[r.id] ?? ""}
                  onChange={(e) => setItem({ ...item, [r.id]: e.target.value })}
                  placeholder={t("takedowns.itemId")}
                  aria-label={t("takedowns.itemId")}
                  className="mt-2 min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink"
                />
                <input
                  type="text"
                  value={note[r.id] ?? ""}
                  maxLength={500}
                  onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
                  placeholder={t("mod.note")}
                  aria-label={t("mod.note")}
                  className="mt-2 min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void resolve(r, "removed")}
                    className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
                  >
                    {r.kind === "impersonation" || r.kind === "trademark"
                      ? t("takedowns.acted")
                      : t("takedowns.remove")}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void resolve(r, "rejected")}
                    className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
                  >
                    {t("takedowns.reject")}
                  </button>
                </div>
                {failure[r.id] ? (
                  <p role="alert" className="mt-2 text-sm font-medium text-danger">
                    {failure[r.id]}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
