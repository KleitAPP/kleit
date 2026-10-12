import { supabase } from "@/integrations/supabase/client";

/**
 * The weekly recap (S94; spec 11 #4; migration 089): one call for the card on Home and the
 * recap screen. The challenge that just closed (Kleit's picks first, then the top three by the
 * week's likes), the remix of the week, and the person's own week. Every row is read as the
 * caller, so what the server leaves out (a private remix, a set across a block) is simply not
 * here. `show` is true from the Friday close until Monday morning.
 */
export type RecapSet = {
  set_id: string;
  title: string;
  username: string;
  preview_image_id: string | null;
};
export type RecapEntry = RecapSet & { likes: number };
export type RecapContest = {
  id: string;
  title: string;
  closes_at: string;
  entries: number;
  picks: RecapSet[];
  top: RecapEntry[];
};
export type RecapRemix = RecapEntry & { remixed_from_label: string | null };
export type Recap = {
  show: boolean;
  contest: RecapContest | null;
  remix: RecapRemix | null;
  me: {
    sets_published: number;
    likes_received: number;
    new_followers: number;
    pieces_saved: number;
  };
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

function asSet(v: Record<string, unknown>): RecapSet {
  return {
    set_id: String(v["set_id"]),
    title: typeof v["title"] === "string" ? v["title"] : "",
    username: typeof v["username"] === "string" ? v["username"] : "",
    preview_image_id: typeof v["preview_image_id"] === "string" ? v["preview_image_id"] : null,
  };
}
const asEntry = (v: Record<string, unknown>): RecapEntry => ({
  ...asSet(v),
  likes: num(v["likes"]),
});
const asList = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    : [];

/** Null only when the call failed (offline, signed out); an empty week is still a recap. */
export async function weeklyRecap(): Promise<Recap | null> {
  const { data, error } = await supabase.rpc("weekly_recap");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const r = data as Record<string, unknown>;
  const c =
    r["contest"] && typeof r["contest"] === "object"
      ? (r["contest"] as Record<string, unknown>)
      : null;
  const x =
    r["remix"] && typeof r["remix"] === "object" ? (r["remix"] as Record<string, unknown>) : null;
  const me = r["me"] && typeof r["me"] === "object" ? (r["me"] as Record<string, unknown>) : {};
  return {
    show: r["show"] === true,
    contest: c
      ? {
          id: String(c["id"]),
          title: typeof c["title"] === "string" ? c["title"] : "",
          closes_at: String(c["closes_at"]),
          entries: num(c["entries"]),
          picks: asList(c["picks"]).map(asSet),
          top: asList(c["top"]).map(asEntry),
        }
      : null,
    remix: x
      ? {
          ...asEntry(x),
          remixed_from_label:
            typeof x["remixed_from_label"] === "string" ? x["remixed_from_label"] : null,
        }
      : null,
    me: {
      sets_published: num(me["sets_published"]),
      likes_received: num(me["likes_received"]),
      new_followers: num(me["new_followers"]),
      pieces_saved: num(me["pieces_saved"]),
    },
  };
}
