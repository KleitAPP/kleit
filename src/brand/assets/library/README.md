# The decoration library — records (roadmap M4.4; `claude/artwork-pack.md`)

The pictures the site serves live in `public/library/` (cutouts, drawn, backgrounds, thumbs); the
**records** that let them ship live here. `scripts/build-library.mjs` joins the two and fails the build
if any served file has no licence row, or any row that says "ship" has no file (artwork pack gap A9).
It writes `src/library/catalogue.json`, which is what the drawer reads — never the folder.

| Path | What it is |
|---|---|
| `packs.json` | the 14 packs: id, name, tier, one-line brief, what it holds, six palette swatches. `holo` was "celestial" (Comcast holds that mark) |
| `licence/cutout-licence-record.csv` | one row per museum cutout: collection, object title and date, source URL, CC0, trademark/likeness check |
| `licence/background-licence-record.csv` | the same for the 45 museum backgrounds |
| `licence/aesthetic-stickers-licence-record.csv` | 153 hand-authored SVG stickers: Kleit owns them outright; brand / character / person checks; a `claude_verdict` ("weak" rows keep their files but do not ship) |
| `licence/y2k-*.csv` | the three Y2K drawn batches; the realistic redraws take precedence over the test batch for the same id |
| `drawn-backgrounds.json` | the 25 drawn backgrounds (pack, title) |
| `svg/` | the SVG sources of every drawn asset and drawn background, for redrawing. Ids inside each are namespaced per asset — keep that if any are inlined together |

Rules the build enforces: every cutout is CC0 and passed the objects-ornament-and-nature check; every
drawn asset is Kleit's outright and passed the three checks; nothing ships on a "weak" or "fail"
verdict (that is how the two shoes stay out — decision 108: no drawn footwear).

Thumbnails (160 px) are stored here for the test site. Production serves sizes at delivery from one
stored original (artwork pack §7.4 #6) — item CL15.
