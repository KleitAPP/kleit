/**
 * Checks the image-screening decision against spec 13.1 #3 and gap T16 (roadmap M2.5).
 *
 * Runs on every push. This is the table that decides whether a photo is visible, and a change to
 * it that nobody notices is the worst kind of change in the whole app - in one direction people
 * see something they should not, in the other a seller's ordinary product shot vanishes.
 */
import { decide, MIN_CONFIDENCE, type Label } from "../supabase/functions/_shared/screening.ts";

const cases: { name: string; labels: Label[]; state: string; featured: boolean }[] = [
  {
    name: "a plain product shot with nothing flagged is visible and can be featured",
    labels: [],
    state: "clean",
    featured: true,
  },
  {
    name: "a bikini on a product page is allowed (gap T16) but never featured",
    labels: [{ name: "Swimwear or Underwear", confidence: 96 }],
    state: "clean",
    featured: false,
  },
  {
    name: "a lingerie shot is allowed but never featured",
    labels: [{ name: "Swimwear or Underwear", confidence: 88 }, { name: "Female Swimwear Or Underwear", confidence: 85 }],
    state: "clean",
    featured: false,
  },
  {
    name: "explicit content is blocked outright",
    labels: [{ name: "Explicit", confidence: 91 }],
    state: "blocked",
    featured: false,
  },
  {
    name: "explicit wins even when swimwear is also seen",
    labels: [{ name: "Swimwear or Underwear", confidence: 99 }, { name: "Explicit Nudity", confidence: 72 }],
    state: "blocked",
    featured: false,
  },
  {
    name: "non-explicit nudity goes to a person, not a guess",
    labels: [{ name: "Non-Explicit Nudity of Intimate parts and Kissing", confidence: 77 }],
    state: "review",
    featured: false,
  },
  {
    name: "violence is hidden and queued",
    labels: [{ name: "Violence", confidence: 80 }],
    state: "review",
    featured: false,
  },
  {
    name: "a hate symbol is hidden and queued",
    labels: [{ name: "Hate Symbols", confidence: 65 }],
    state: "review",
    featured: false,
  },
  {
    name: "a cigarette in an editorial shot is allowed but not featured",
    labels: [{ name: "Drugs & Tobacco", confidence: 84 }],
    state: "clean",
    featured: false,
  },
  {
    name: "a glass of wine in a shot is allowed but not featured",
    labels: [{ name: "Alcohol", confidence: 90 }],
    state: "clean",
    featured: false,
  },
  {
    name: "a category we have never heard of goes to a person",
    labels: [{ name: "Something AWS Added Last Tuesday", confidence: 95 }],
    state: "review",
    featured: false,
  },
  {
    name: "a low-confidence guess is ignored",
    labels: [{ name: "Explicit", confidence: MIN_CONFIDENCE - 1 }],
    state: "clean",
    featured: true,
  },
  {
    name: "a label exactly at the threshold counts",
    labels: [{ name: "Explicit", confidence: MIN_CONFIDENCE }],
    state: "blocked",
    featured: false,
  },
];

let failed = 0;
for (const c of cases) {
  const v = decide(c.labels);
  const okState = v.state === c.state;
  const okFeatured = !v.keepOutOfFeatured === c.featured;
  const ok = okState && okFeatured;
  if (!ok) failed++;
  console.log(
    `${ok ? "✓" : "✗"} ${c.name}` +
      (ok ? "" : ` — got ${v.state}, featurable=${!v.keepOutOfFeatured}; wanted ${c.state}, featurable=${c.featured}`),
  );
}

// Anything that is not plainly clean must carry its reason, or a moderator is guessing and an
// appeal has nothing to answer.
const reasoned = decide([{ name: "Violence", confidence: 80 }]);
if (reasoned.because.length === 0) {
  console.log("✗ a decision that hides something must say which label did it");
  failed++;
} else {
  console.log("✓ a decision that hides something says which label did it");
}

if (failed > 0) {
  console.error(`\nScreening check FAILED: ${failed} of ${cases.length + 1}`);
  process.exit(1);
}
console.log(`\nScreening check passed: all ${cases.length + 1} cases.`);
