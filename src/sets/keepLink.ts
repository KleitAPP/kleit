/**
 * The shape of a "Keep it" link from the brand mini editor (roadmap M9.2): /keep?pieces=<ids>.
 * On its own, with no imports, because the phone's link router reads it too and must not pull
 * the whole sets module in behind it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The four slots of a Quick set. */
export const KEEP_MAX = 4;

/**
 * The ids a keep link may carry: one to four uuids, comma-separated, each once. Anything else
 * (a path, a stray word, a fifth id) makes the whole link nothing - a stranger's link does not
 * get to be half right.
 */
export function safeKeep(text: string | undefined | null): string[] | null {
  if (!text || text.length > KEEP_MAX * 37) return null;
  const ids = text.toLowerCase().split(",");
  if (ids.length < 1 || ids.length > KEEP_MAX) return null;
  if (!ids.every((id) => UUID.test(id))) return null;
  if (new Set(ids).size !== ids.length) return null;
  return ids;
}
