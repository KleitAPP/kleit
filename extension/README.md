# Kleit browser extension (M9.1)

Clip from a computer: the Kleit button on any store page, or "Clip this picture to Kleit" on a
right-click, opens Kleit's own Clip a link screen with the page (and the picture) filled in. The
extension reads nothing from the page and holds no sign-in; the server reads the page, the
person picks and confirms, and the same screening runs as for every clip.

## Try it before it is in the stores

Chrome or Edge → `chrome://extensions` (`edge://extensions`) → Developer mode → **Load unpacked**
→ this folder. The gear (Options) sets which Kleit it opens: the test site until kleit.app exists.

## Publishing (M9.1's "Done when" asks for a submitted listing)

- Chrome Web Store: a developer account ($5 once, the owner's), a ZIP of this folder, the store
  listing's words (`docs/stores/listing.md` has the pitch), 1280×800 screenshots.
- Microsoft Edge Add-ons: free; the same ZIP.

Nothing in here needs a build step; the icons come from `scripts/build-icons.mjs`.
