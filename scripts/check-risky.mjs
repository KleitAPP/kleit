// The risky-search list, checked without a browser (M7.6): phrases trip it, clothes words do not.
import { isRiskySearch } from "../src/safety/risky.ts";
const yes = ["thinspo", "pro ana tips", "How to NOT eat", "thigh gap outfits", "purge wardrobe"];
const no = [
  "skinny jeans",
  "slim fit",
  "wool coat",
  "light blue dress",
  "an",
  "cut out top",
  "fasting",
];
let bad = 0;
for (const q of yes)
  if (!isRiskySearch(q)) {
    console.error(`should show help: "${q}"`);
    bad++;
  }
for (const q of no)
  if (isRiskySearch(q)) {
    console.error(`should NOT show help: "${q}"`);
    bad++;
  }
if (bad) process.exit(1);
console.log(
  `risky-search check OK: ${yes.length} phrases show the card, ${no.length} clothes searches do not`,
);
