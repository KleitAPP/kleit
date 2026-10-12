import { t } from "@/i18n/en";

/**
 * Staff, stylist and brand accounts are labelled wherever their name shows (spec 11 #9; 23.3 #2;
 * migration 090). The label is a word, never a colour alone (design pack 8.3 #3), and it is the
 * server's: an admin sets it on /mod/users, nobody sets their own.
 */
export type AccountLabel = "none" | "staff" | "stylist" | "brand";

export const ACCOUNT_LABELS: readonly AccountLabel[] = ["none", "staff", "stylist", "brand"];

export function asAccountLabel(value: unknown): AccountLabel {
  return value === "staff" || value === "stylist" || value === "brand" ? value : "none";
}

/** The words for a label, or null for an ordinary account. */
export function labelText(label: AccountLabel | null | undefined): string | null {
  switch (label) {
    case "staff":
      return t("label.staff");
    case "stylist":
      return t("label.stylist");
    case "brand":
      return t("label.brand");
    default:
      return null;
  }
}
