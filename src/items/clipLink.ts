/**
 * Clipping a store link, from the app's side (roadmap M2.4; design pack S29-S33, G10).
 *
 * Two calls to `clip-url`, with the person in between: `readLink` shows them what the page says;
 * `saveClip` makes the item from what they confirmed. Both are thin - the server does the
 * fetching, the copying and the screening - and this file's job is to turn the server's answers
 * into the handful of situations the screen has words for.
 */
import { supabase } from "@/integrations/supabase/client";

export type PageRead = {
  title: string | null;
  priceCents: number | null;
  currency: string | null;
  storeName: string;
  images: string[];
  sourceUrl: string;
  sourceDomain: string;
  /** Whether the store still offers it (spec 4.8 #1): true, false, or null when the page did not say. */
  available: boolean | null;
};

export type ReadProblem =
  | "bad-url" // not a web address at all
  | "opted-out" // the site asked not to be clipped
  | "refused" // the store answered with a block
  | "timed-out" // the 4-second cap (G10)
  | "unreadable" // reached, but nothing usable on it
  | "signed-out"
  | "offline";

export type ReadResult = { ok: true; page: PageRead } | { ok: false; problem: ReadProblem };

export async function readLink(url: string): Promise<ReadResult> {
  try {
    const { data, error } = await supabase.functions.invoke("clip-url", {
      body: { action: "read", url },
    });
    if (error) {
      const problem = await problemFrom(error);
      // A save-only problem cannot come from a read; anything unexpected is "unreadable".
      return {
        ok: false,
        problem:
          problem === "image-unreadable" || problem === "save-failed" ? "unreadable" : problem,
      };
    }
    if (!data || typeof data !== "object") return { ok: false, problem: "unreadable" };
    const page = data as PageRead;
    return {
      ok: true,
      page: { ...page, images: page.images ?? [], available: page.available ?? null },
    };
  } catch {
    return { ok: false, problem: "offline" };
  }
}

export type SaveInput = {
  url: string;
  imageUrl: string;
  title: string;
  priceCents: number | null;
  currency: string | null;
  storeName: string;
  own: boolean;
  /** What the read said about stock; the server keeps a plain "sold out" and nothing else. */
  soldOut: boolean;
};

export type SaveProblem = ReadProblem | "image-unreadable" | "save-failed";

export type SaveResult =
  | {
      ok: true;
      itemId: string;
      kind: "product" | "non_product";
      state: "clean" | "review" | "blocked" | "checking";
    }
  | { ok: false; problem: SaveProblem };

export async function saveClip(input: SaveInput): Promise<SaveResult> {
  try {
    const { data, error } = await supabase.functions.invoke("clip-url", {
      body: { action: "save", ...input },
    });
    if (error) {
      const problem = await problemFrom(error);
      return { ok: false, problem };
    }
    const result = data as {
      itemId?: string;
      kind?: "product" | "non_product";
      state?: SaveResult extends { ok: true; state: infer S } ? S : never;
    };
    if (!result?.itemId) return { ok: false, problem: "save-failed" };
    return {
      ok: true,
      itemId: result.itemId,
      kind: result.kind ?? "non_product",
      state: result.state ?? "checking",
    };
  } catch {
    return { ok: false, problem: "offline" };
  }
}

/** The function answers with a `problem` word; anything else is a plain failure. */
async function problemFrom(error: unknown): Promise<SaveProblem> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = (await context.clone().json()) as { problem?: string };
      switch (body.problem) {
        case "bad-url":
        case "not-public":
          return "bad-url";
        case "opted-out":
          return "opted-out";
        case "refused":
          return "refused";
        case "timed-out":
          return "timed-out";
        case "signed-out":
          return "signed-out";
        case "image-unreadable":
        case "too-big":
          return "image-unreadable";
        case "not-a-page":
        case "unreachable":
        case "read-failed":
          return "unreadable";
        default:
          return "save-failed";
      }
    } catch {
      /* fall through */
    }
  }
  return "unreadable";
}
