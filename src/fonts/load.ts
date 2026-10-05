import { supabase } from "@/integrations/supabase/client";

import { fontById } from "@/fonts/catalogue";

/**
 * Loads a font into the page once, by id: a catalogue font from /fonts/, or a private upload
 * (`private:<path in the private-fonts bucket>`) through a signed address only its owner can
 * get. Returns the CSS family name to draw with, or null if the font could not be loaded.
 */
const loaded = new Map<string, Promise<string | null>>();

export function familyFor(id: string): string {
  return id.startsWith("private:") ? `kleit-private-${hash(id)}` : `kleit-${id}`;
}

function hash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function loadFont(id: string): Promise<string | null> {
  const existing = loaded.get(id);
  if (existing) return existing;
  const job = (async () => {
    if (typeof document === "undefined" || !("fonts" in document)) return null;
    const family = familyFor(id);
    let url: string | null = null;
    if (id.startsWith("private:")) {
      const path = id.slice("private:".length);
      const { data } = await supabase.storage.from("private-fonts").createSignedUrl(path, 60 * 60);
      url = data?.signedUrl ?? null;
    } else {
      url = fontById(id)?.file ?? null;
    }
    if (!url) return null;
    try {
      const face = new FontFace(family, `url(${url})`);
      await face.load();
      document.fonts.add(face);
      return family;
    } catch {
      return null;
    }
  })();
  loaded.set(id, job);
  return job;
}
