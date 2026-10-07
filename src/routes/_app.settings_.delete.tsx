import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";

/**
 * S24 — Delete account (spec 3.7; design pack G14). The one red line in Settings. Says plainly
 * what goes and what stays, asks once, hides everything at once, and gives seven days to undo
 * from this same screen (or the screen a sign-in lands on while a deletion is pending).
 */
export const Route = createFileRoute("/_app/settings_/delete")({
  head: () => ({
    meta: [{ title: "Delete account" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: DeleteAccount,
});

function DeleteAccount() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const { data } = await supabase
      .from("account_deletions")
      .select("state, final_at")
      .maybeSingle();
    setPending(data?.state === "pending" ? data.final_at : null);
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function ask() {
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("request_account_deletion");
    setBusy(false);
    setConfirm(false);
    if (!error) setPending(String(data));
  }
  async function undo() {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("cancel_account_deletion");
    setBusy(false);
    if (!error) setPending(null);
  }

  if (pending === undefined) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  const when = pending
    ? new Date(pending).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("delete.title")}</h1>
      {pending ? (
        <div className="mt-4 rounded-md border border-ink bg-surface p-4">
          <p className="text-base text-ink">{t("delete.pending", { date: when })}</p>
          <p className="mt-1 text-sm text-ink-soft">{t("delete.pendingWhy")}</p>
          <div className="mt-3">
            <PrimaryButton onClick={() => void undo()} disabled={busy}>
              {t("delete.undo")}
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-base text-ink">{t("delete.what")}</p>
          <ul className="mt-3 flex flex-col gap-1 text-sm text-ink">
            <li>· {t("delete.goes")}</li>
            <li>· {t("delete.stays")}</li>
            <li>· {t("delete.grace")}</li>
          </ul>
          <p className="mt-3 text-sm text-ink-soft">{t("delete.breakInstead")}</p>
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="mt-6 min-h-12 w-full rounded-pill border border-danger bg-surface px-5 text-base font-medium text-danger"
          >
            {t("delete.title")}
          </button>
        </>
      )}
      <Sheet
        open={confirm}
        onOpenChange={setConfirm}
        title={t("delete.confirmTitle")}
        description={t("delete.confirmWhy")}
        action={
          <PrimaryButton onClick={() => void ask()} disabled={busy}>
            {busy ? t("loading") : t("delete.confirm")}
          </PrimaryButton>
        }
      >
        <p className="text-sm text-ink-soft">{t("delete.confirmNote")}</p>
      </Sheet>
      {pending ? (
        <button
          type="button"
          onClick={() =>
            void supabase.auth.signOut().then(() => navigate({ to: "/welcome", replace: true }))
          }
          className="mt-6 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base text-ink"
        >
          {t("you.signOut")}
        </button>
      ) : null}
    </div>
  );
}
