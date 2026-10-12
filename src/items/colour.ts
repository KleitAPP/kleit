/**
 * A piece's colour, named (spec 4.4 #4, 9 #1, 21 #7). The naming itself is shared with the
 * server (`supabase/functions/_shared/colour.ts`): the phone names a closet photo on the canvas
 * before it leaves, the clipper names a store picture after it decodes it, and the two must
 * agree, so there is one rule. This file only reads the pixels off a canvas for it.
 */
import { t } from "@/i18n/en";

import {
  COLOUR_NAMES,
  COLOUR_SWATCHES,
  dominantColour,
  isColourName,
  type ColourName,
} from "../../supabase/functions/_shared/colour";

export { COLOUR_NAMES, COLOUR_SWATCHES, dominantColour, isColourName, type ColourName };

/** The name a canvas's pixels vote for; null when the canvas cannot be read. */
export function colourOfCanvas(canvas: HTMLCanvasElement): ColourName | null {
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || canvas.width === 0 || canvas.height === 0) return null;
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    return dominantColour(data.data, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

/** The same, from a file or blob: decoded small, since a vote needs no detail. */
export async function colourOfBlob(blob: Blob): Promise<ColourName | null> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return colourOfCanvas(canvas);
  } catch {
    return null;
  }
}

/** The word on screen for a colour name. */
export function colourLabel(name: ColourName): string {
  return t(`colour.${name}`);
}
