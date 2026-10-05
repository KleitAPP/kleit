/**
 * The Creative canvas document's rules, checked with no browser (roadmap M4.2; spec 6.1).
 *   bun scripts/check-canvas-doc.ts
 */
import {
  addAssetLayer,
  addLayer,
  changedLayers,
  cloneLayer,
  commit,
  emptyDoc,
  flip,
  guidesFor,
  historyOf,
  LAYER_CAP,
  layoutChanged,
  layoutOf,
  redo,
  removeLayer,
  reorder,
  setShape,
  snap,
  undo,
  UNDO_STEPS,
  updateLayer,
  type Doc,
} from "../src/canvas/doc";

let n = 0;
let failed = 0;
function check(ok: boolean, what: string, detail = "") {
  n += 1;
  console.log(`${ok ? "ok" : "not ok"} ${n} - ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
}

// A piece lands in the middle at a third of the width, on top.
let doc: Doc = emptyDoc("portrait");
const a = addLayer(doc, "a", "item-a", { w: 600, h: 900 });
check(
  a.ok && a.doc.layers["a"]!.w === 240 && a.doc.layers["a"]!.h === 360,
  "a new piece's longest side is a third of the canvas width",
  a.ok ? `${a.doc.layers["a"]!.w}x${a.doc.layers["a"]!.h}` : "refused",
);
doc = a.ok ? a.doc : doc;
check(
  doc.layers["a"]!.x === 420 && doc.layers["a"]!.y === 495,
  "and centred",
  `${doc.layers["a"]!.x},${doc.layers["a"]!.y}`,
);

// The cap: 150 in, the 151st refused (spec 6.1 #20).
let capped: Doc = emptyDoc("square");
for (let i = 0; i < LAYER_CAP; i++) {
  const r = addLayer(capped, `l${i}`, "item", { w: 100, h: 100 });
  if (r.ok) capped = r.doc;
}
check(capped.order.length === LAYER_CAP, `${LAYER_CAP} pieces go in`);
check(
  addLayer(capped, "one-more", "item", { w: 100, h: 100 }).ok === false,
  "the next one is refused",
);
check(cloneLayer(capped, "l0", "clone").ok === false, "and so is a clone at the cap");

// Clone keeps size and rotation, lands just above its source (spec 6.1 #4).
doc = updateLayer(doc, "a", { rotation: 30, w: 200, h: 300 });
const b = addLayer(doc, "b", "item-b", { w: 100, h: 100 });
doc = b.ok ? b.doc : doc;
const c = cloneLayer(doc, "a", "a2");
doc = c.ok ? c.doc : doc;
check(
  doc.layers["a2"]!.rotation === 30 && doc.layers["a2"]!.w === 200 && doc.layers["a2"]!.h === 300,
  "a clone keeps size and rotation",
);
check(doc.order.join(",") === "a,a2,b", "a clone sits just above its source", doc.order.join(","));

// Order (spec 6.1 #5).
check(reorder(doc, "a", "front").order.join(",") === "a2,b,a", "bring to front");
check(reorder(doc, "b", "back").order.join(",") === "a,b,a2", "send back one");
check(reorder(doc, "b", "bottom").order.join(",") === "b,a,a2", "send to bottom");
check(reorder(doc, "b", "forward").order.join(",") === "a,a2,b", "forward at the top stays put");

// Flip twice is the original (spec 6.1 #2).
check(
  flip(flip(doc, "a", "x"), "a", "x").layers["a"]!.flipX === false,
  "flip, flip: back to the original",
);
check(flip(doc, "a", "x").layers["a"]!.flipX === true, "one flip mirrors");

// Shape switch keeps the layout (spec 6.1 #11): same width, so nothing moves; a story is taller.
const story = setShape(doc, "story");
check(
  story.canvas.h === 1920 && story.layers["a"]!.x === doc.layers["a"]!.x,
  "switching to Story keeps every piece where it was",
);

// Snapping (spec 6.1 #15).
const lone = addLayer(emptyDoc("square"), "only", "item", { w: 100, h: 100 });
const guides = guidesFor(lone.ok ? lone.doc : doc, "only");
check(
  guides.vertical.includes(0) && guides.vertical.includes(540) && guides.vertical.includes(1080),
  "guides: canvas edges and centre",
);
check(
  guidesFor(doc, "b").vertical.includes(doc.layers["a"]!.x),
  "guides: another piece's left edge",
);
const s1 = snap({ x: 6, y: 300, w: 100, h: 100 }, guides);
check(s1.x === 0 && s1.snappedV === 0, "a piece 6 px from the left edge snaps to it", `${s1.x}`);
const s2 = snap({ x: 495, y: 300, w: 100, h: 100 }, guides);
check(
  s2.x === 490 && s2.snappedV === 540,
  "a piece whose centre is near the middle snaps its centre",
  `${s2.x}`,
);
const s3 = snap({ x: 200, y: 200, w: 100, h: 100 }, guides);
check(s3.x === 200 && s3.snappedV === null, "far from any guide, nothing snaps");

// Undo: a hundred steps and no more; redo until the next edit (spec 6.1 #9).
let h = historyOf(emptyDoc("square"));
for (let i = 0; i < UNDO_STEPS + 20; i++)
  h = commit(
    h,
    updateLayer(h.present, "none", {}) === h.present
      ? { ...h.present, caption: `c${i}` }
      : h.present,
  );
check(
  h.past.length === UNDO_STEPS,
  `the past holds ${UNDO_STEPS} steps, not more`,
  String(h.past.length),
);
for (let i = 0; i < UNDO_STEPS; i++) h = undo(h);
check(h.present.caption === "c19", "a hundred undos land a hundred steps back", h.present.caption);
check(undo(h).present === h.present, "the hundred-and-first undo does nothing");
h = redo(h);
check(h.present.caption === "c20", "redo goes forward one");
h = commit(h, { ...h.present, caption: "fresh" });
check(h.future.length === 0, "a new edit clears redo");
check(commit(h, h.present) === h, "committing the same document is not a step");

// What changed, for the saver.
const before = doc;
const after = removeLayer(updateLayer(doc, "a", { x: 1 }), "b");
const diff = changedLayers(before, after);
check(
  diff.changed.join(",") === "a" && diff.removed.join(",") === "b",
  "the saver sees one changed and one removed layer",
  `${diff.changed}/${diff.removed}`,
);
check(layoutChanged(before, after) === true, "removing a layer changes the layout (its order)");
check(
  layoutChanged(before, updateLayer(before, "a", { x: 5 })) === false,
  "moving a piece does not",
);

// Decorations (M4.4): in the layout, not in set_items; a change to one is a layout change.
const dec = addAssetLayer(doc, "d1", "aic-109313", { w: 716, h: 624 });
check(dec.ok && dec.doc.layers["d1"]!.kind === "asset", "a decoration is its own kind of layer");
check(
  dec.ok && dec.doc.layers["d1"]!.w === 360 && dec.doc.layers["d1"]!.h === 314,
  "placed a third of the canvas wide at its true shape",
  dec.ok ? `${dec.doc.layers["d1"]!.w}x${dec.doc.layers["d1"]!.h}` : "",
);
const decLayout = dec.ok ? layoutOf(dec.doc) : null;
check(
  !!decLayout?.decor?.["d1"] && decLayout.decor["d1"]!.asset === "aic-109313",
  "the layout carries it by catalogue id",
);
check(
  !!dec.ok && layoutChanged(dec.doc, updateLayer(dec.doc, "d1", { x: 9 })) === true,
  "moving a decoration changes the layout (there is no row to hold it)",
);
check(
  layoutChanged(doc, { ...doc, backgroundAsset: "coquette-170774" }) === true,
  "choosing a background picture changes the layout",
);

console.log(`1..${n}`);
if (failed) {
  console.error(`\nCanvas document check FAILED: ${failed} of ${n}`);
  process.exit(1);
}
console.log(`\nCanvas document check passed: all ${n} checks.`);
