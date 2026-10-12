/**
 * A rough category for a piece, read from its name (spec 5.1 #9, #10, #13: shuffle, swipe and
 * Complete the look all need to know a boot from a blouse). Nothing in the catalogue records a
 * category - the clipper keeps what the store page says, and a store page says "Cropped Wool
 * Blazer" - so this reads the words. It is a guess for ranking, never a rule: a piece whose
 * name says nothing is simply "unknown" and still gets suggested, last.
 */
export type Category = "top" | "bottom" | "dress" | "outer" | "shoes" | "bag" | "accessory";

export const CATEGORIES: readonly Category[] = [
  "top",
  "bottom",
  "dress",
  "outer",
  "shoes",
  "bag",
  "accessory",
];

// In the order they are tried: the first rule that matches wins, so a "denim jacket" is outerwear
// before it is denim, "boot cut jeans" are trousers before they are boots, and a "shirt dress" is
// a dress before it is a shirt. "Dress" as a describing word ("dress shirt", "dress shoes") is
// taken out first.
const RULES: ReadonlyArray<readonly [Category, RegExp]> = [
  ["bottom", /\b(jeans|trousers?|pants|leggings?|joggers?|chinos|sweatpants|culottes|skorts?)\b/],
  [
    "outer",
    /\b(coats?|jackets?|blazers?|parkas?|trench|puffers?|anoraks?|overcoats?|cardigans?|windbreakers?|gilets?|bombers?|raincoats?|ponchos?|capes?|shackets?|fleeces?|outerwear)\b/,
  ],
  [
    "shoes",
    /\b(shoes?|sneakers?|trainers?|boots?|booties|heels?|pumps?|loafers?|sandals?|flats?|mules?|clogs?|oxfords?|brogues?|slides?|slippers?|espadrilles?|wedges?|stilettos?|footwear|flip[- ]?flops?|mary[- ]janes?|platforms?)\b/,
  ],
  [
    "bag",
    /\b(bags?|totes?|handbags?|purses?|clutch(es)?|backpacks?|satchels?|crossbody|wallets?|pouch(es)?|weekenders?|duffels?|duffles?|fanny packs?|bucket bags?)\b/,
  ],
  [
    "dress",
    /\b(dress(es)?|gowns?|jumpsuits?|rompers?|playsuits?|overalls?|dungarees|sundress(es)?|frocks?|kaftans?|caftans?)\b/,
  ],
  ["bottom", /\b(skirts?|shorts|cargos?|capris?|tights|bermudas?|flares?|bottoms?)\b/],
  [
    "top",
    /\b(tops?|tees?|t-?shirts?|shirts?|blouses?|sweaters?|jumpers?|sweatshirts?|hoodies?|knits?|tanks?|camisoles?|camis?|bodysuits?|polos?|turtlenecks?|pullovers?|crewnecks?|tunics?|crop|corsets?|bustiers?|henleys?|vests?)\b/,
  ],
  [
    "accessory",
    /\b(hats?|caps?|beanies?|scarf|scarves|belts?|sunglasses|glasses|necklaces?|earrings?|bracelets?|rings?|watch(es)?|gloves?|socks?|ties?|headbands?|hair ?clips?|claw clips?|berets?|bandanas?|jewel\w*|brooch(es)?|cuffs?|anklets?|chokers?|accessor(y|ies))\b/,
  ],
];

/** The category a name suggests, or null when it says nothing. */
export function categoryOf(title: string | null | undefined): Category | null {
  if (!title) return null;
  const words = title
    .toLowerCase()
    .replace(/\bdress (shirts?|shoes?|pants|trousers|socks)\b/g, "$1")
    .replace(/[^a-z0-9\s-]/g, " ");
  for (const [category, rule] of RULES) if (rule.test(words)) return category;
  return null;
}
