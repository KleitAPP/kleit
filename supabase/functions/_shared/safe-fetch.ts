/**
 * Fetching a page or an image that a person handed us the address of (roadmap M2.4; security
 * plan #17).
 *
 * A server that fetches whatever address it is given is a server that can be pointed at itself:
 * at the metadata service of the machine it runs on, at a database on a private address, at a
 * neighbour on the same network. That is the whole of what this file guards against, and the
 * rules are few and blunt:
 *
 *   - http or https only, on the default ports;
 *   - the host must resolve to a public address - never loopback, private, link-local, or the
 *     cloud metadata range - and that is checked on EVERY hop of a redirect, because the first
 *     address being fine says nothing about where it sends you next;
 *   - at most a few redirects, a hard deadline, and a hard cap on how many bytes are read.
 *
 * Everything else about the page is somebody else's problem. This is the door.
 */

export type FetchProblem =
  | "bad-url"
  | "not-public"
  | "too-many-redirects"
  | "timed-out"
  | "unreachable"
  | "refused"
  | "too-big";

export class SafeFetchError extends Error {
  constructor(
    public readonly problem: FetchProblem,
    detail?: string,
  ) {
    super(detail ?? problem);
  }
}

/** Only ever these. `URL` accepts `javascript:` and `file:` just as happily. */
export function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SafeFetchError("bad-url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SafeFetchError("bad-url");
  if (url.port && url.port !== "80" && url.port !== "443") throw new SafeFetchError("bad-url");
  if (url.username || url.password) throw new SafeFetchError("bad-url");
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new SafeFetchError("not-public");
  }
  return url;
}

/**
 * The sixteen bytes of an IPv6 address, or null when the text is not one. Written out in full
 * so that every spelling of the same address is judged the same: `::ffff:127.0.0.1` and
 * `::ffff:7f00:1` are one address (the URL parser writes the second), and a zone id or a
 * shortened run of zeros changes nothing.
 */
function ipv6Bytes(text: string): number[] | null {
  let v6 = text.toLowerCase();
  const zone = v6.indexOf("%");
  if (zone >= 0) v6 = v6.slice(0, zone);
  // A dotted IPv4 at the end becomes its two groups.
  const dotted = v6.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const parts = dotted.slice(2, 6).map(Number);
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    v6 = `${dotted[1]}${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }
  const halves = v6.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const n = parseInt(group, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

/** True for any address a server must not be pointed at. IPv4 and IPv6. */
export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const b = ipv6Bytes(ip);
    if (!b) return true; // not an address we can read: not one we will connect to
    const v4 = (at: number) => `${b[at]}.${b[at + 1]}.${b[at + 2]}.${b[at + 3]}`;
    const zerosTo = (n: number) => b.slice(0, n).every((x) => x === 0);
    if (zerosTo(15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
    if (zerosTo(10) && b[10] === 0xff && b[11] === 0xff) return isPrivateAddress(v4(12)); // ::ffff:a.b.c.d
    if (zerosTo(12)) return true; // ::a.b.c.d, the old IPv4-compatible form
    if (
      b[0] === 0 &&
      b[1] === 0x64 &&
      b[2] === 0xff &&
      b[3] === 0x9b &&
      b.slice(4, 12).every((x) => x === 0)
    )
      return isPrivateAddress(v4(12)); // 64:ff9b::/96, NAT64
    if (b[0] === 0x20 && b[1] === 0x02) return isPrivateAddress(v4(2)); // 2002::/16, 6to4
    if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true; // fe80::/10 link-local
    if ((b[0]! & 0xfe) === 0xfc) return true; // fc00::/7 unique local
    if (b[0] === 0xff) return true; // ff00::/8 multicast
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, and the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  // A literal address needs no lookup.
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) {
    if (isPrivateAddress(hostname.replace(/^\[|\]$/g, ""))) throw new SafeFetchError("not-public");
    return;
  }
  // Reached through globalThis so this file also type-checks in the web build, where there is
  // no Deno; the lookup itself only ever runs in the edge function.
  const dns = (
    globalThis as unknown as {
      Deno?: { resolveDns(h: string, k: "A" | "AAAA"): Promise<string[]> };
    }
  ).Deno;
  if (!dns) throw new SafeFetchError("unreachable", "no resolver");
  let addresses: string[] = [];
  try {
    const [a, aaaa] = await Promise.allSettled([
      dns.resolveDns(hostname, "A"),
      dns.resolveDns(hostname, "AAAA"),
    ]);
    if (a.status === "fulfilled") addresses = addresses.concat(a.value);
    if (aaaa.status === "fulfilled") addresses = addresses.concat(aaaa.value);
  } catch {
    throw new SafeFetchError("unreachable");
  }
  if (addresses.length === 0) throw new SafeFetchError("unreachable");
  // ALL of them must be public. A name that answers with one public and one private address
  // is exactly the trick this exists to stop.
  if (addresses.some(isPrivateAddress)) throw new SafeFetchError("not-public");
}

export type SafeResponse = {
  url: URL;
  status: number;
  contentType: string;
  bytes: Uint8Array;
};

/**
 * Fetch with every hop checked, a deadline, and a byte cap. Redirects are followed by hand so
 * that each new address goes through the same door as the first.
 */
export async function safeFetch(
  raw: string,
  options: { deadlineMs: number; maxBytes: number; accept: string; maxRedirects?: number },
): Promise<SafeResponse> {
  const started = Date.now();
  let url = parsePublicUrl(raw);
  const maxRedirects = options.maxRedirects ?? 5;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHost(url.hostname);

    const remaining = options.deadlineMs - (Date.now() - started);
    if (remaining <= 0) throw new SafeFetchError("timed-out");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          // A real browser's shape. Some stores answer a bare fetch with a bot page; that is
          // still their call, and the probe at M2.1 records who does.
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          Accept: options.accept,
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } catch (problem) {
      clearTimeout(timer);
      if (problem instanceof DOMException && problem.name === "AbortError")
        throw new SafeFetchError("timed-out");
      throw new SafeFetchError(
        "unreachable",
        problem instanceof Error ? problem.message : undefined,
      );
    }

    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timer);
      await response.body?.cancel();
      const to = response.headers.get("location");
      if (!to) throw new SafeFetchError("unreachable");
      url = parsePublicUrl(new URL(to, url).toString());
      continue;
    }

    if (response.status === 401 || response.status === 403 || response.status === 429) {
      clearTimeout(timer);
      await response.body?.cancel();
      throw new SafeFetchError("refused", String(response.status));
    }

    // Read up to the cap and not a byte more; a page that is bigger is cut, not refused, because
    // the metadata we want is in the head.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let cut = false;
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        if (total + value.length > options.maxBytes) {
          chunks.push(value.subarray(0, options.maxBytes - total));
          total = options.maxBytes;
          cut = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
        total += value.length;
      }
    } catch (problem) {
      clearTimeout(timer);
      if (problem instanceof DOMException && problem.name === "AbortError")
        throw new SafeFetchError("timed-out");
      throw new SafeFetchError("unreachable");
    }
    clearTimeout(timer);

    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    // For an image, a cut file is a broken file. For HTML, a cut file is fine.
    if (cut && !options.accept.startsWith("text/html")) throw new SafeFetchError("too-big");

    return {
      url,
      status: response.status,
      contentType: (response.headers.get("content-type") ?? "").toLowerCase(),
      bytes,
    };
  }
  throw new SafeFetchError("too-many-redirects");
}
