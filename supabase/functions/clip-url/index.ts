/**
 * clip-url — paste a store link, get an item (roadmap M2.4; spec 4.1, 4.2, 4.3; decision 103).
 *
 * Two calls, because the person is in the middle:
 *
 *   `read`  - given an address, read the page and answer with what it says: name, price, site,
 *             pictures. Nothing is stored. The app shows this and lets the person pick a picture
 *             and fix the name or price (S30, S31, S32). Capped at 4 seconds (design pack G10):
 *             a slow store must not break the one-minute set. If the page cannot be read, the
 *             app opens the details screen with the fields empty and the person adds it by hand.
 *
 *   `song`  - given a Spotify, Apple Music or YouTube Music link, answer with the song's title,
 *             artist and cover for the set's song card (spec 11 #12). Nothing is stored; the
 *             person corrects the words and the set keeps them (migration 091 holds the rules).
 *
 *   `save`  - given the address, the chosen picture and the details as confirmed, make the item:
 *             copy the picture into OUR storage (the one stored original - spec 4.1 #8), write the
 *             clip record that ties that copy to this person's request (decision 103, the
 *             Polyvore rule), put the item in the person's drawer, and screen it. The source
 *             address is written once here, cleaned of tracking codes, and the database's own
 *             trigger stops anyone changing it afterwards (spec 4.2 #2).
 *
 * Two doors this function keeps shut, both because it fetches addresses people typed:
 *   - it never fetches a private or internal address, on any hop (`_shared/safe-fetch.ts`);
 *   - it never fetches from a site on the opt-out list (`optout_sites`), and says so plainly.
 *
 * And one rule about the picture: it is decoded and re-encoded here, never stored as it came,
 * so a stored copy never carries the page's metadata and is always a format the scanner reads.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decode, GIF, type Frame, type Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

import { safeFetch, SafeFetchError, parsePublicUrl } from "../_shared/safe-fetch.ts";
import { decodable } from "../_shared/image-size.ts";
import { sameSecret } from "../_shared/guest-door.ts";
import {
  readProductPage,
  cleanSourceUrl,
  domainOf,
  looksLikeAShell,
} from "../_shared/product-page.ts";
import { screenItem, ScreenFailure, awsKeysFromEnv } from "../_shared/screen.ts";
import {
  cleanSongUrl,
  oembedUrl,
  readOembed,
  readSongPage,
  songService,
  type SongRead,
} from "../_shared/song-page.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Design pack G10: the page read must fit inside a one-minute set. */
const PAGE_DEADLINE_MS = 4000;
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
/** The picture may take longer - the person is looking at "copying the picture" - but not for ever. */
const IMAGE_DEADLINE_MS = 8000;
const IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const IMAGE_LONGEST_SIDE = 2048;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return reply(405, { problem: "method" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply(500, { problem: "not-configured" });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return reply(400, { problem: "bad-request" });
  }
  const action = body["action"];
  const rawUrl = typeof body["url"] === "string" ? body["url"] : "";
  if (!rawUrl) return reply(400, { problem: "bad-request" });

  const server = createClient(url, serviceKey);

  // Who is asking. The read is allowed to the server itself too (the M2.1 store probe runs
  // through this same code from CI); the save never is - a clip is always somebody's.
  const authorization = request.headers.get("Authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "");
  const isServer =
    bearer.length > 0 && (sameSecret(bearer, serviceKey) || (await canActAsServer(url, bearer)));
  let me: string | null = null;
  if (!isServer) {
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authorization } },
    });
    const { data: who } = await asCaller.auth.getUser();
    me = who.user?.id ?? null;
    if (!me) return reply(401, { problem: "signed-out" });
  }

  if (action === "read") return readPage(server, rawUrl, false);
  if (action === "song") {
    if (!me) return reply(401, { problem: "signed-out" });
    return readSong(rawUrl);
  }
  // The M2.1 probe: the read plus a look at WHY a page came back thin. Server only, because the
  // diagnostics quote the page.
  if (action === "probe" && isServer) return readPage(server, rawUrl, true);
  if (action === "save") {
    if (!me) return reply(401, { problem: "signed-out" });
    // This function writes with the service key, so the database's refuse_if_banned triggers
    // never see a person. Ask here, before anything is fetched or stored (CL50).
    if (await isSuspended(server, me)) return reply(403, { problem: "suspended" });
    return saveClip(server, me, body);
  }
  return reply(400, { problem: "bad-request" });
});

// ---------------------------------------------------------------------------

/**
 * Is this key the server's? Not by looking at it - a project has more than one shape of secret
 * key - but by what it can do: read a table no person may read. A person's token gets a
 * permission error there; the anon key gets one too.
 */
async function canActAsServer(url: string, bearer: string): Promise<boolean> {
  try {
    const probe = createClient(url, bearer);
    const { error } = await probe.from("removed_image_fingerprints").select("image_hash").limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Banned or suspended (both set profiles.banned_at). A failed read refuses: fail closed. */
async function isSuspended(server: SupabaseClient, me: string): Promise<boolean> {
  const { data, error } = await server
    .from("profiles")
    .select("banned_at")
    .eq("user_id", me)
    .maybeSingle();
  if (error) return true;
  return data?.banned_at != null;
}

async function optedOut(server: SupabaseClient, hostname: string): Promise<boolean> {
  // The site itself and every parent: shop.brand.com is covered by brand.com.
  const parts = hostname
    .replace(/^www\./, "")
    .toLowerCase()
    .split(".");
  const candidates: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) candidates.push(parts.slice(i).join("."));
  const { data } = await server.from("optout_sites").select("domain").in("domain", candidates);
  return (data ?? []).length > 0;
}

async function readPage(
  server: SupabaseClient,
  rawUrl: string,
  diagnose: boolean,
): Promise<Response> {
  let pageUrl: URL;
  try {
    pageUrl = parsePublicUrl(rawUrl);
  } catch (problem) {
    return reply(422, { problem: problem instanceof SafeFetchError ? problem.problem : "bad-url" });
  }
  if (await optedOut(server, pageUrl.hostname)) return reply(422, { problem: "opted-out" });

  try {
    const page = await safeFetch(pageUrl.toString(), {
      deadlineMs: PAGE_DEADLINE_MS,
      maxBytes: PAGE_MAX_BYTES,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    });
    if (page.status >= 400) return reply(422, { problem: "refused", status: page.status });
    if (!page.contentType.includes("html")) return reply(422, { problem: "not-a-page" });
    const html = new TextDecoder("utf-8", { fatal: false }).decode(page.bytes);
    // A bot wall or an empty JavaScript shell is a refusal that did not say so.
    if (looksLikeAShell(html)) {
      return reply(422, {
        problem: "refused",
        status: page.status,
        ...(diagnose ? { diagnostics: diagnostics(html, page) } : {}),
      });
    }
    const read = readProductPage(html, page.url);
    const canonical = read.canonical ? safeCanonical(read.canonical, page.url) : null;
    const source = canonical ?? page.url;
    return reply(200, {
      title: read.title,
      priceCents: read.priceCents,
      currency: read.currency,
      storeName: read.storeName ?? domainOf(source),
      images: read.images,
      sourceUrl: cleanSourceUrl(source),
      sourceDomain: domainOf(source),
      // Why the read answered as it did, for the probe's table and for the log.
      finalUrl: page.url.toString(),
      ...(diagnose ? { diagnostics: diagnostics(html, page) } : {}),
    });
  } catch (problem) {
    if (problem instanceof SafeFetchError) return reply(422, { problem: problem.problem });
    console.error("[clip-url] read", problem instanceof Error ? problem.message : problem);
    return reply(502, { problem: "read-failed" });
  }
}

/** What the probe prints for a thin page: size, title tag, whether it looks like a bot wall, where "price" shows up. */
function diagnostics(
  html: string,
  page: { status: number; contentType: string; bytes: Uint8Array },
) {
  const titleTag = html.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i)?.[1]?.trim() ?? null;
  const botWall =
    /captcha|access denied|are you a human|bot detection|px-captcha|_incapsula_|akamai|cf-chl|challenge-platform|distil/i.test(
      html.slice(0, 20000),
    );
  const priceMentions = [...html.matchAll(/"price"\s*:\s*"?[\d.]+/gi)].slice(0, 3).map((m) => {
    const at = m.index ?? 0;
    return html.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, " ");
  });
  const metaCount = (html.match(/<meta\b/gi) ?? []).length;
  const ldCount = (html.match(/application\/ld\+json/gi) ?? []).length;
  return {
    status: page.status,
    contentType: page.contentType,
    bytes: page.bytes.length,
    titleTag,
    botWall,
    metaCount,
    ldCount,
    priceMentions,
  };
}

/** A canonical address is trusted only on the same site; a canonical pointing elsewhere is ignored. */
function safeCanonical(candidate: string, pageUrl: URL): URL | null {
  try {
    const url = parsePublicUrl(candidate);
    return domainOf(url) === domainOf(pageUrl) ? url : null;
  } catch {
    return null;
  }
}

async function saveClip(
  server: SupabaseClient,
  me: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const rawUrl = String(body["url"]);
  const imageUrl = typeof body["imageUrl"] === "string" ? body["imageUrl"] : "";
  const title = typeof body["title"] === "string" ? body["title"].trim().slice(0, 200) : "";
  const priceCents =
    typeof body["priceCents"] === "number" &&
    Number.isInteger(body["priceCents"]) &&
    body["priceCents"] >= 0
      ? body["priceCents"]
      : null;
  const currency =
    typeof body["currency"] === "string" && /^[A-Z]{3}$/.test(body["currency"])
      ? body["currency"]
      : null;
  const storeName =
    typeof body["storeName"] === "string" ? body["storeName"].trim().slice(0, 100) : "";
  const own = body["own"] === true;
  if (!imageUrl) return reply(400, { problem: "bad-request" });

  let pageUrl: URL;
  try {
    pageUrl = parsePublicUrl(rawUrl);
  } catch (problem) {
    return reply(422, { problem: problem instanceof SafeFetchError ? problem.problem : "bad-url" });
  }
  if (await optedOut(server, pageUrl.hostname)) return reply(422, { problem: "opted-out" });

  // The picture, through the same door as the page. Asked for as JPEG or PNG first, because
  // those are what the scanner can read; a site that only has WebP is a fallback case.
  let bytes: Uint8Array;
  try {
    const image = await safeFetch(imageUrl, {
      deadlineMs: IMAGE_DEADLINE_MS,
      maxBytes: IMAGE_MAX_BYTES,
      accept: "image/jpeg,image/png;q=0.9,image/*;q=0.5",
    });
    if (image.status >= 400) return reply(422, { problem: "image-unreadable" });
    if (!decodable(image.bytes)) return reply(422, { problem: "image-unreadable" });
    const decoded = await decode(image.bytes);
    let picture: Image | Frame;
    if (decoded instanceof GIF) {
      // No animations (owner's decision, 2026-10-01): a moving store picture is not clipped.
      if (decoded.length > 1) return reply(422, { problem: "animated" });
      const frame = decoded[0];
      if (!frame) return reply(422, { problem: "image-unreadable" });
      picture = frame;
    } else {
      picture = decoded;
    }
    const longest = Math.max(picture.width, picture.height);
    if (longest > IMAGE_LONGEST_SIDE) {
      const scale = IMAGE_LONGEST_SIDE / longest;
      picture.resize(Math.round(picture.width * scale), Math.round(picture.height * scale));
    }
    bytes = await picture.encodeJPEG(86);
  } catch (problem) {
    if (problem instanceof SafeFetchError)
      return reply(422, {
        problem: problem.problem === "not-public" ? "not-public" : "image-unreadable",
      });
    return reply(422, { problem: "image-unreadable" });
  }

  const imageId = `${me}/${crypto.randomUUID()}.jpg`;
  const stored = await server.storage
    .from("item-images")
    .upload(imageId, bytes, { contentType: "image/jpeg", upsert: false });
  if (stored.error) return reply(502, { problem: "store-failed" });

  const sourceUrl = cleanSourceUrl(pageUrl);
  const sourceDomain = domainOf(pageUrl);
  const kind = title && priceCents != null ? "product" : "non_product";

  // The item, the clip record, the drawer row. If any of the three fails the stored file must
  // not be left behind on its own: a picture with no clip record is exactly what decision 103
  // forbids, so it is removed again.
  const { data: item, error: itemError } = await server
    .from("items")
    .insert({
      owner_id: me,
      kind,
      title: title || null,
      price_cents: priceCents,
      price_currency: priceCents != null ? (currency ?? "USD") : null,
      price_checked_at: priceCents != null ? new Date().toISOString() : null,
      store_name: storeName || sourceDomain,
      source_url: sourceUrl,
      source_domain: sourceDomain,
      image_id: imageId,
      image_bucket: "item-images",
    })
    .select("id")
    .single();
  if (itemError || !item) {
    await server.storage.from("item-images").remove([imageId]);
    console.error("[clip-url] item", itemError?.message);
    return reply(502, { problem: "save-failed" });
  }

  const record = await server.from("clip_records").insert({
    user_id: me,
    item_id: item.id,
    image_id: imageId,
    source_url: sourceUrl,
    trigger: "paste_link",
  });
  if (record.error) {
    // No record, no image: undo the lot rather than keep a copy nobody asked for.
    await server.from("items").delete().eq("id", item.id);
    await server.storage.from("item-images").remove([imageId]);
    console.error("[clip-url] clip_record", record.error.message);
    return reply(502, { problem: "save-failed" });
  }

  await server.from("drawer_items").insert({ user_id: me, item_id: item.id, origin: "clipped" });
  if (own) await server.from("closet_items").insert({ user_id: me, item_id: item.id });

  // Screened here and now, so the person usually gets the answer while they are still looking.
  // If this does not finish, the sweeper does (migration 014).
  await server.rpc("count_scan_attempt", { p_item_id: item.id });
  try {
    const verdict = await screenItem(
      server,
      { id: item.id, image_id: imageId, image_bucket: "item-images" },
      awsKeysFromEnv(),
    );
    return reply(200, { itemId: item.id, kind, state: verdict.state });
  } catch (problem) {
    if (!(problem instanceof ScreenFailure)) console.error("[clip-url] screen", problem);
    return reply(200, { itemId: item.id, kind, state: "checking" });
  }
}

// ---------------------------------------------------------------------------

/**
 * The song card (spec 11 #12): one of the three services, read through the same door as a
 * store page. The oEmbed answer first where there is one; the page's own tags fill what it
 * leaves out (Spotify's oEmbed has no artist; Apple Music has no oEmbed at all).
 */
async function readSong(rawUrl: string): Promise<Response> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return reply(422, { problem: "bad-url" });
  }
  const service = songService(url);
  if (!service) return reply(422, { problem: "not-a-service" });
  const clean = cleanSongUrl(url, service);
  if (!clean) return reply(422, { problem: "not-a-song" });
  const song: SongRead = { service, url: clean, title: null, artist: null, cover: null };

  const oembed = oembedUrl(clean, service);
  if (oembed) {
    try {
      const answer = await safeFetch(oembed, {
        deadlineMs: PAGE_DEADLINE_MS,
        maxBytes: 200_000,
        accept: "application/json",
      });
      if (answer.status === 200) {
        const json = JSON.parse(new TextDecoder().decode(answer.bytes)) as unknown;
        Object.assign(song, readOembed(json, service));
      }
    } catch (problem) {
      if (!(problem instanceof SafeFetchError)) console.error("[clip-url] song oembed", problem);
    }
  }
  if (!song.title || !song.artist) {
    try {
      const page = await safeFetch(clean, {
        deadlineMs: PAGE_DEADLINE_MS,
        maxBytes: PAGE_MAX_BYTES,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      });
      if (page.status === 200 && page.contentType.includes("html")) {
        const html = new TextDecoder("utf-8", { fatal: false }).decode(page.bytes);
        const read = readSongPage(html, service);
        song.title = song.title ?? read.title ?? null;
        song.artist = song.artist ?? read.artist ?? null;
        song.cover = song.cover ?? read.cover ?? null;
      }
    } catch (problem) {
      if (!(problem instanceof SafeFetchError)) console.error("[clip-url] song page", problem);
    }
  }
  if (!song.title) return reply(422, { problem: "unreadable", song });
  return reply(200, { song });
}
