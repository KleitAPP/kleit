/**
 * A sample document for the text tool's backings (spec 21 #6; /dev/canvas-text): every backing
 * in light words and in dark, over a loud picture drawn here so the page needs no file and no
 * account. Fixed colours on purpose - this is artwork on the canvas, not the app's theme (L14).
 */
import { addTextLayer, emptyDoc, type Doc } from "@/canvas/doc";

import { TEXT_BACKS, type TextBack } from "../../supabase/functions/_shared/text-back";

const BACKS: readonly TextBack[] = TEXT_BACKS;

export function loudPicture(w: number, h: number): HTMLImageElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#f2b6c6");
  g.addColorStop(0.5, "#2b2b2b");
  g.addColorStop(1, "#ffe08a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 18;
  for (let x = -h; x < w + h; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + h, h);
    ctx.stroke();
  }
  const img = new Image();
  img.src = c.toDataURL("image/png");
  return img;
}

export function sampleDoc(): Doc {
  let doc = emptyDoc("portrait", "#F4EFE6");
  const w = doc.canvas.w;
  BACKS.forEach((back, i) => {
    for (const [j, colour] of ["#FFFFFF", "#161513"].entries()) {
      const id = `t-${back}-${j}`;
      const added = addTextLayer(doc, id, {
        text: `${back} words`,
        font: "playfair",
        size: 72,
        colour,
        align: "center",
        back,
      });
      if (!added.ok) continue;
      doc = added.doc;
      const layer = doc.layers[id]!;
      doc.layers[id] = {
        ...layer,
        w: Math.round(w * 0.42),
        x: Math.round(j === 0 ? w * 0.05 : w * 0.53),
        y: 140 + i * 300,
        rotation: i === 3 ? -8 : 0,
      };
    }
  });
  return doc;
}
