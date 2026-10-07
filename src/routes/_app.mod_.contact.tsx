import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/kleit";
import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";
import { myRoles } from "@/safety/moderation";

/**
 * Messages from the contact form, for moderators (M7.5). The reply goes by email outside the
 * app (CL43: no mail sender yet); here a message is marked answered, or closed if nothing
 * needs doing, and the act is logged.
 */
export const Route = createFileRoute("/_app/mod_/contact")({
  head: () => ({
    meta: [{ title: "Messages" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: ContactInbox,
});

type Row = {
  id: string;
  request_ref: string;
  topic: "question" | "bug" | "account" | "safety" | "other";
  name: string;
  email: string;
  message: string;
  user_id: string | null;
  created_at: string;
};
type TopicKey = `contact.topic.${Row["topic"]}`;

function ContactInbox() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    const { data } = await supabase
      .from("contact_messages")
      .select("id, request_ref, topic, name, email, message, user_id, created_at")
      .eq("state", "open")
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

  async function resolve(r: Row, outcome: "answered" | "closed") {
    if (busy) return;
    setBusy(r.id);
    const { error } = await supabase.rpc("contact_resolve", {
      p_id: r.id,
      p_outcome: outcome,
      p_note: note[r.id] ?? "",
    });
    setBusy(null);
    if (!error) await refresh();
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
      <h1 className="font-display text-2xl text-ink">{t("contact.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("contact.why")}</p>
      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("mod.empty")} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md border border-line bg-surface p-3 shadow-card">
              <p className="text-sm text-ink-soft">
                {r.request_ref} · {t(`contact.topic.${r.topic}` as TopicKey)} ·{" "}
                {new Date(r.created_at).toLocaleDateString()}
                {r.user_id ? ` · ${t("contact.signedIn")}` : ""}
              </p>
              <p className="mt-1 text-base text-ink">
                {r.name} <span className="text-ink-soft">{r.email}</span>
              </p>
              <p className="mt-1 text-sm text-ink whitespace-pre-wrap">{r.message}</p>
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
                  onClick={() => void resolve(r, "answered")}
                  className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
                >
                  {t("contact.answered")}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void resolve(r, "closed")}
                  className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
                >
                  {t("contact.close")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
