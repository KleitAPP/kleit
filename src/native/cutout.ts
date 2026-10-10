import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * The phone's own cutout (roadmap M8.3; spec 4.4 #6). One door for both platforms: the native
 * side (android/…/CutoutPlugin.java, ios/…/CutoutPlugin.swift) takes the prepared JPEG and
 * answers with a grey PNG the same size - white where the piece is, black where the background
 * is. Here that becomes a MASK canvas (opaque = keep) that the web eraser starts from, so the
 * same two brushes fix whatever the model got wrong, and nothing is ever sent to a server.
 *
 * On the web, or when the phone cannot do it (no Play services, model not downloaded yet, iOS
 * under 17, no subject found), `nativeMask` answers null and the eraser starts from "keep all"
 * exactly as before.
 */
type CutoutPlugin = {
  available(): Promise<{ available: boolean }>;
  mask(options: {
    jpegBase64: string;
  }): Promise<{ maskBase64: string; width: number; height: number }>;
};

const Cutout = registerPlugin<CutoutPlugin>("Cutout");

/** Is there a native cutout on this device? False on the web. */
export async function nativeCutoutAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Cutout")) return false;
  try {
    return (await Cutout.available()).available;
  } catch {
    return false;
  }
}

/**
 * The starting mask for a prepared photo, from the phone. Soft edges from the model's own
 * confidence: below 35% gone, above 65% kept, a blend between - a hard cut at 50% leaves jagged
 * hems. Null when it cannot be done.
 */
export async function nativeMask(source: HTMLCanvasElement): Promise<HTMLCanvasElement | null> {
  if (!(await nativeCutoutAvailable())) return null;
  try {
    const jpeg = await new Promise<Blob | null>((resolve) =>
      source.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!jpeg) return null;
    const { maskBase64, width, height } = await Cutout.mask({ jpegBase64: await toBase64(jpeg) });
    if (width !== source.width || height !== source.height) return null;

    const grey = await loadImage(`data:image/png;base64,${maskBase64}`);
    const mask = document.createElement("canvas");
    mask.width = width;
    mask.height = height;
    const g = mask.getContext("2d");
    if (!g) return null;
    g.drawImage(grey, 0, 0, width, height);
    const pixels = g.getImageData(0, 0, width, height);
    const d = pixels.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i]! / 255; // red = the model's confidence
      const a = v <= 0.35 ? 0 : v >= 0.65 ? 1 : (v - 0.35) / 0.3;
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = Math.round(a * 255);
    }
    g.putImageData(pixels, 0, 0);
    return mask;
  } catch {
    return null;
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("mask image unreadable"));
    image.src = src;
  });
}
