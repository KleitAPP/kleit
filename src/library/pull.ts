/**
 * Pulling a decoration of our own (spec 13.3 #6; migration 118). The asset is fingerprinted
 * the way every uploaded photo is - the same dHash the server computes - so that a copy of it
 * can never come back as somebody's photo. A cutout is transparent and a screenshot of it lands
 * on some background, so it is hashed flat on white and flat on black, and both go on the list.
 */
import { supabase } from "@/integrations/supabase/client";

import { fingerprint } from "../../supabase/functions/_shared/fingerprint";

import { libraryUrl } from "./library";

const SIDE = 256;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

/** The asset's fingerprints (one or two); empty when the picture could not be read. */
export async function assetFingerprints(file: string): Promise<string[]> {
  try {
    const img = await loadImage(libraryUrl(file));
    const w0 = img.naturalWidth || SIDE;
    const h0 = img.naturalHeight || SIDE;
    const k = Math.min(1, SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    const hashes = new Set<string>();
    for (const background of ["#ffffff", "#000000"]) {
      context.fillStyle = background;
      context.fillRect(0, 0, w, h);
      context.drawImage(img, 0, 0, w, h);
      const data = context.getImageData(0, 0, w, h);
      hashes.add(fingerprint(new Uint8Array(data.data.buffer), w, h));
    }
    return [...hashes];
  } catch {
    return [];
  }
}

/** Pulls the asset: how many sets lost their chat picture, or the problem in plain words. */
export async function pullAsset(
  id: string,
  hashes: string[],
  reason: string,
): Promise<{ sets: number } | { problem: "admins" | "reason" | "other" }> {
  const { data, error } = await supabase.rpc("pull_library_asset", {
    p_asset: id,
    p_hashes: hashes,
    p_reason: reason,
  });
  if (error) {
    const m = error.message ?? "";
    if (/admins only/i.test(m)) return { problem: "admins" };
    if (/reason is required/i.test(m)) return { problem: "reason" };
    return { problem: "other" };
  }
  return { sets: typeof data === "number" ? data : 0 };
}

export async function restoreAsset(id: string): Promise<boolean> {
  const { error } = await supabase.rpc("restore_library_asset", { p_asset: id });
  return !error;
}

export type Pulled = { asset_id: string; reason: string; pulled_at: string };

export async function pulledList(): Promise<Pulled[]> {
  const { data } = await supabase
    .from("pulled_library_assets")
    .select("asset_id, reason, pulled_at")
    .order("pulled_at", { ascending: false });
  return (data ?? []) as Pulled[];
}
