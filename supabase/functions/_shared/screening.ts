/**
 * What to do about what the scanner saw (spec 13.1 #3; gap T16; roadmap M2.5).
 *
 * This file is the whole safety decision, kept apart from the code that talks to AWS so it can be
 * tested without an account, a network or a photo. Every rule in it is a line of the spec.
 *
 * The rule that makes this app different from a general photo site: **a fashion catalogue is full
 * of swimwear and underwear**, and a scanner that treats those as adult content would block half
 * of what people came here to do (gap T16). So they are allowed - and kept out of anything we
 * put in front of people who did not ask for it.
 */

/** What the scanner said: a category name and how sure it was, 0-100. */
export type Label = { name: string; confidence: number };

export type Verdict = {
  /** `clean` is visible. `review` is hidden until a person looks. `blocked` never appears. */
  state: "clean" | "review" | "blocked";
  /** True when the image may be shown but never promoted - featured, editor picks, discovery. */
  keepOutOfFeatured: boolean;
  /** The labels that decided it, so a moderator is not guessing and an appeal has something to read. */
  because: string[];
};

/**
 * Below this we treat a label as noise. AWS's own default is 50; 60 is a little stricter because
 * a false "review" on a product photo costs a seller a day, and the categories that actually
 * matter come back with high confidence when they are really there.
 */
export const MIN_CONFIDENCE = 60;

/**
 * Each label is classified by the FIRST rule that matches, so the order of this list is the
 * decision. It is ordered most specific first, and it has to be.
 *
 * The test caught exactly why: AWS's category for non-explicit nudity is called
 * "Non-Explicit Nudity of Intimate parts and Kissing", which CONTAINS the word "explicit". A
 * plain substring check for "explicit" therefore blocked the very thing the spec says to send to
 * a person - an ambiguous fashion shot would have been destroyed outright with no appeal. Any
 * rule built on "does the name contain this word" has to answer the most specific question first.
 */
const RULES: { match: string; verdict: "blocked" | "review" | "quiet" }[] = [
  // Most specific first. "non-explicit" must be asked before "explicit".
  { match: "non-explicit nudity", verdict: "review" },

  // Never appears. No appeal path makes an explicit image showable here.
  { match: "explicit", verdict: "blocked" },

  // Hidden until a person looks. Nudity that is not explicit is genuinely ambiguous in fashion -
  // an editorial shot and a violation can carry the same labels - so it goes to a human rather
  // than being guessed at in either direction. Hate symbols too: the cost of showing one is far
  // higher than the cost of a person spending ten seconds on a false alarm.
  { match: "violence", verdict: "review" },
  { match: "visually disturbing", verdict: "review" },
  { match: "hate symbols", verdict: "review" },
  { match: "self-harm", verdict: "review" },

  // Allowed, but never promoted. Two different reasons sit here.
  //
  // Swimwear and underwear are the point of a clothes app (gap T16), and blocking them would be
  // absurd - but Kleit is 18+ with under-18s certainly slipping in, so they do not go in front of
  // someone who did not go looking.
  //
  // Drink, smoking, gambling and rude gestures appear constantly in fashion photography, in
  // editorial shots nobody would call unsafe. Hiding those would be censorship of ordinary
  // pictures; promoting them would be us choosing to put them in front of everyone.
  { match: "swimwear or underwear", verdict: "quiet" },
  { match: "drugs & tobacco", verdict: "quiet" },
  { match: "alcohol", verdict: "quiet" },
  { match: "gambling", verdict: "quiet" },
  { match: "rude gestures", verdict: "quiet" },
];

/** The first rule that matches, or undefined for a category we have never heard of. */
function classify(labelName: string): "blocked" | "review" | "quiet" | undefined {
  const name = labelName.trim().toLowerCase();
  return RULES.find((rule) => name.includes(rule.match))?.verdict;
}

/**
 * The decision.
 *
 * Note what is NOT here: there is no "if we could not tell, allow it". A caller that fails to
 * reach the scanner must not call this function at all - it must leave the image unscanned, and
 * unscanned is invisible (migration 010's read policy). That is the difference between this and
 * the launch check, which fails open on purpose: nobody is harmed by the app opening, and someone
 * can be harmed by a photo appearing.
 */
export function decide(labels: Label[]): Verdict {
  const seen = labels
    .filter((l) => l.confidence >= MIN_CONFIDENCE)
    .map((l) => ({ ...l, verdict: classify(l.name) }));

  const worst = (want: string) => seen.filter((l) => l.verdict === want).map((l) => l.name);

  const blocking = worst("blocked");
  if (blocking.length > 0) return { state: "blocked", keepOutOfFeatured: true, because: blocking };

  const reviewing = worst("review");
  if (reviewing.length > 0) return { state: "review", keepOutOfFeatured: true, because: reviewing };

  // A label we have never heard of. New categories get added to the taxonomy, and the honest
  // answer to "we do not know what this is" is a person, not a shrug.
  const unknown = seen.filter((l) => l.verdict === undefined).map((l) => l.name);
  if (unknown.length > 0) return { state: "review", keepOutOfFeatured: true, because: unknown };

  const quiet = worst("quiet");
  if (quiet.length > 0) return { state: "clean", keepOutOfFeatured: true, because: quiet };

  return { state: "clean", keepOutOfFeatured: false, because: [] };
}
