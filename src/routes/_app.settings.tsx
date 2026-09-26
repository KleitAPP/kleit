import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { t } from "@/i18n/en";

/**
 * S15 — Settings (design pack W16): a plain list, one level deep.
 *
 * Take a break and Delete account sit at the very bottom, below a separator, and Delete is the
 * only red row on the screen (design pack gap G14): the two look alike and sit together, and one
 * of them is undoable while the other is not. They are built at M1.12; until then they say so
 * rather than pretending.
 */
export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Settings,
});

function Settings() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">{t("settings.title")}</h1>

      <ul className="mt-6 overflow-hidden rounded-md border border-line bg-surface">
        <Row to="/settings/account" title={t("settings.account")} why={t("settings.accountWhy")} />
        <Row to="/settings/privacy" title={t("settings.privacy")} why={t("settings.privacyWhy")} />
        <Row to="/settings/devices" title={t("settings.devices")} why={t("settings.devicesWhy")} />
        <Row to="/settings/legal" title={t("settings.help")} />
        <Later title={t("settings.signInMethods")} />
        <Later title={t("settings.notifications")} />
        <Later title={t("settings.blocked")} />
      </ul>

      <button
        type="button"
        onClick={() => {
          void supabase.auth.signOut().then(() => navigate({ to: "/welcome", replace: true }));
        }}
        className="mt-6 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
      >
        {t("you.signOut")}
      </button>

      {/* The separator is the point: these two look alike and sit together, and only one of them
          can be undone (design pack G14). */}
      <hr className="mt-8 border-line" />
      <ul className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
        <Row to="/settings/break" title={t("settings.break")} />
        <Later title={t("settings.delete")} danger />
      </ul>
    </div>
  );
}

function Row({ to, title, why }: { to: string; title: string; why?: string }) {
  return (
    <li className="border-b border-line last:border-b-0">
      <Link to={to} className="flex min-h-12 flex-col justify-center px-4 py-3">
        <span className="text-base text-ink">{title}</span>
        {why ? <span className="text-sm text-ink-soft">{why}</span> : null}
      </Link>
    </li>
  );
}

/** A row that exists so the shape of Settings never changes under people, and says it is not built. */
function Later({ title, danger = false }: { title: string; danger?: boolean }) {
  return (
    <li className="flex min-h-12 flex-col justify-center border-b border-line px-4 py-3 last:border-b-0">
      <span className={danger ? "text-base text-danger" : "text-base text-ink-soft"}>{title}</span>
      <span className="text-sm text-ink-soft">{t("settings.notYet")}</span>
    </li>
  );
}
