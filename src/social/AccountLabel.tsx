import { t } from "@/i18n/en";

import { labelText, type AccountLabel } from "./labels";

/** The label as a small chip beside a name: "Kleit staff", "Kleit stylist" or "Brand". */
export function AccountLabelChip({
  label,
  className = "",
}: {
  label: AccountLabel | null | undefined;
  className?: string;
}) {
  const text = labelText(label);
  if (!text) return null;
  return (
    <span
      className={`inline-block rounded-pill border border-ink px-2 py-0.5 text-xs text-ink ${className}`}
      title={t("label.why")}
    >
      {text}
    </span>
  );
}
