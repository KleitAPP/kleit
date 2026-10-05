import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import { createTemplate, myTemplates, type TemplateRow } from "@/templates/templates";

/** My templates (M4.5): the ones you made, published or not; a new one starts empty. */
export const Route = createFileRoute("/_app/you_/templates")({
  head: () => ({
    meta: [{ title: "My templates" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: MyTemplates,
});

function MyTemplates() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void myTemplates().then((r) => !cancelled && setRows(r));
    return () => {
      cancelled = true;
    };
  }, []);

  async function make() {
    setBusy(true);
    const id = await createTemplate(t("template.new"));
    setBusy(false);
    if (id) void navigate({ to: "/template/$templateId/edit", params: { templateId: id } });
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("template.mine")}</h1>
      <div className="mt-4">
        <PrimaryButton onClick={() => void make()} disabled={busy}>
          {t("template.new")}
        </PrimaryButton>
      </div>
      {rows === null ? (
        <div className="kl-skeleton mt-4 h-24 w-full rounded-md bg-surface-2" />
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("template.none")} />
        </div>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-line last:border-b-0">
              <Link
                to="/template/$templateId/edit"
                params={{ templateId: r.id }}
                className="flex min-h-12 items-center justify-between px-4 py-3 text-base text-ink"
              >
                <span>
                  {r.name}
                  <span className="ml-2 text-sm text-ink-soft">
                    {t("library.pieces", { count: r.layout.slots.length })}
                  </span>
                </span>
                <span className="text-sm text-ink-soft">
                  {r.is_public ? t("template.published") : t("template.private")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
