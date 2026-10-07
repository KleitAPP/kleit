/**
 * S103 — risky searches (M7.6; spec 9 #8, 13.2 #3; gap T11). A fashion app meets eating-
 * disorder language more than most. When a search looks like it is reaching for that, the
 * help card goes above the results - never instead of them, because "skinny jeans" is a cut
 * and a search for "purge" might be a wardrobe. The list is phrases, not single words, so
 * ordinary clothes words never trip it.
 */
const RISKY = [
  "thinspo",
  "thinspiration",
  "pro ana",
  "proana",
  "pro mia",
  "promia",
  "meanspo",
  "bonespo",
  "thigh gap",
  "ana tips",
  "ana diet",
  "mia tips",
  "ed tips",
  "fasting tips",
  "how to not eat",
  "stop eating",
  "lose weight fast",
  "collarbones",
  "hip bones showing",
  "ribs showing",
  "ana buddy",
  "fat burning",
  "starve",
  "starving",
  "purge",
  "purging",
  "laxative",
  "diet pills",
  "calorie",
  "calories",
  "body check",
  "self harm",
  "self-harm",
  "cutting scars",
  "kill myself",
  "suicide",
];

export function isRiskySearch(q: string): boolean {
  const s = q.toLowerCase().replace(/\s+/g, " ").trim();
  if (s.length < 3) return false;
  return RISKY.some((p) => s.includes(p));
}
