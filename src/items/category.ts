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

// A product name ends with what the thing IS ("Cropped Wool Blazer", "Boot Socks", "Shoe Bag"),
// so the last word is read first; only a name whose last word says nothing ("… in Navy", "Two-
// piece Set") is read whole. Within a read, the first rule that matches wins, so a "denim jacket"
// is outerwear before it is denim and "boot cut jeans" are trousers before they are boots.
const RULES: ReadonlyArray<readonly [Category, RegExp]> = [
  ["bottom", /\b(jeans|trousers?|pants|leggings?|joggers?|chinos|sweatpants|culottes|skorts?)\b/],
  [
    "outer",
    /\b(coats?|jackets?|blazers?|parkas?|trench|puffers?|anoraks?|overcoats?|cardigans?|windbreakers?|gilets?|vests?|bombers?|raincoats?|ponchos?|capes?|shackets?|outerwear)\b/,
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
    /\b(tops?|tees?|t-?shirts?|shirts?|blouses?|sweaters?|jumpers?|sweatshirts?|hoodies?|tanks?|camisoles?|camis?|bodysuits?|polos?|turtlenecks?|pullovers?|crewnecks?|tunics?|crop|corsets?|bustiers?|henleys?)\b/,
  ],
  [
    "accessory",
    /\b(hats?|caps?|beanies?|scarf|scarves|belts?|sunglasses|glasses|necklaces?|earrings?|bracelets?|rings?|watch(es)?|gloves?|socks?|ties?|headbands?|hair ?clips?|claw clips?|berets?|bandanas?|jewel\w*|brooch(es)?|cuffs?|anklets?|chokers?|accessor(y|ies))\b/,
  ],
];

function firstRule(words: string): Category | null {
  for (const [category, rule] of RULES) if (rule.test(words)) return category;
  return null;
}

/** The category a name suggests, or null when it says nothing. */
export function categoryOf(title: string | null | undefined): Category | null {
  if (!title) return null;
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim();
  if (!words) return null;
  const last = words.split(/\s+/).pop() ?? "";
  return firstRule(last) ?? firstRule(words);
}
