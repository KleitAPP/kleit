import { supabase } from "@/integrations/supabase/client";

/**
 * S63 — My fonts: a person's own font files, in their own folder of the private-fonts bucket
 * (migration 011: owner reads, writes and deletes their folder; nobody else). The font's id on
 * a text layer is `private:<path>`; the editor loads it through a signed address, and the shared
 * page gets the words as a picture drawn by the server, so the file never leaves the account.
 */
export type MyFont = { id: string; name: string; path: string; bytes: number };

const ALLOWED = [
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
  "application/font-sfnt",
  "application/x-font-ttf",
  "application/x-font-otf",
  "",
];
export const FONT_MAX_BYTES = 5 * 1024 * 1024;

export async function myFonts(): Promise<MyFont[]> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return [];
  const { data } = await supabase.storage
    .from("private-fonts")
    .list(me, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
  return (data ?? [])
    .filter((f) => f.name && !f.name.startsWith("."))
    .map((f) => ({
      id: `private:${me}/${f.name}`,
      name: f.name.replace(/^[0-9a-z]+-/, "").replace(/\.(ttf|otf|woff2?)$/i, ""),
      path: `${me}/${f.name}`,
      bytes: (f.metadata as { size?: number } | null)?.size ?? 0,
    }));
}

export type UploadProblem = "signed-out" | "too-big" | "not-a-font" | "upload-failed";

export async function uploadFont(
  file: File,
): Promise<{ ok: true; font: MyFont } | { ok: false; problem: UploadProblem }> {
  const { data: who } = await supabase.auth.getUser();
  const me = who.user?.id;
  if (!me) return { ok: false, problem: "signed-out" };
  if (file.size > FONT_MAX_BYTES) return { ok: false, problem: "too-big" };
  const ext = (file.name.match(/\.(ttf|otf|woff2?)$/i)?.[1] ?? "").toLowerCase();
  if (!ext || !ALLOWED.includes(file.type)) return { ok: false, problem: "not-a-font" };
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const tag = String.fromCharCode(...head);
  const looksLikeFont =
    tag === "OTTO" ||
    tag === "true" ||
    tag === "wOFF" ||
    tag === "wOF2" ||
    (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0);
  if (!looksLikeFont) return { ok: false, problem: "not-a-font" };
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
  const path = `${me}/${Date.now().toString(36)}-${safeName}`;
  const contentType =
    ext === "otf"
      ? "font/otf"
      : ext === "woff"
        ? "font/woff"
        : ext === "woff2"
          ? "font/woff2"
          : "font/ttf";
  const { error } = await supabase.storage
    .from("private-fonts")
    .upload(path, file, { contentType, upsert: false });
  if (error) return { ok: false, problem: "upload-failed" };
  return {
    ok: true,
    font: {
      id: `private:${path}`,
      name: safeName.replace(/\.(ttf|otf|woff2?)$/i, ""),
      path,
      bytes: file.size,
    },
  };
}

export async function removeFont(path: string): Promise<boolean> {
  const { error } = await supabase.storage.from("private-fonts").remove([path]);
  return !error;
}
