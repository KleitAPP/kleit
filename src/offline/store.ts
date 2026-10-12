/**
 * The on-phone store for offline use (roadmap M8.5; spec 20.2 #2, 20.3 #3; design pack S106).
 *
 * Three boxes in one IndexedDB database:
 *   - `cache`  — the last good copy of a list or a set, keyed by name ("closet", "sets",
 *                "set:<id>"), with the time it was taken. Read only when the network is not there.
 *   - `blobs`  — closet thumbnails as bytes, keyed by item id, so the closet has pictures with no
 *                signal (a signed address from the server is useless offline).
 *   - `outbox` — edits made offline, in order, replayed by `src/offline/outbox.ts` when the
 *                network is back. Each is the same call the app would have made online.
 *
 * Everything here is best effort: a phone with no IndexedDB (private mode, a locked-down
 * browser) gets null back and the app behaves as it did before - online only. Nothing in here
 * is trusted by the server; the row policies decide what a replayed edit may do.
 *
 * Everything is the signed-in person's: every key is prefixed with their id (the same id the
 * offline stand-in uses, `kleit.lastSignedIn`), nothing is kept or read with nobody signed in,
 * and signing out deletes the whole database - so a shared or sold phone, switched to flight
 * mode, shows the next person nothing of the last (the app-code review, 2026-10-12).
 */

const DB_NAME = "kleit-offline";
const DB_VERSION = 1;
const OWNER_KEY = "kleit.lastSignedIn";

/** Whose store this is right now: the id the last good sign-in left behind, or nobody. */
function owner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function scoped(key: string): string | null {
  const me = owner();
  return me ? `${me}:${key}` : null;
}

type Box = "cache" | "blobs" | "outbox";

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
        if (!db.objectStoreNames.contains("outbox"))
          db.createObjectStore("outbox", { autoIncrement: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(
  box: Box,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(box, mode);
          const request = work(tx.objectStore(box));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export type Cached<T> = { at: number; value: T };

export async function cacheGet<T>(key: string): Promise<Cached<T> | null> {
  const k = scoped(key);
  if (!k) return null;
  const got = await run<Cached<T> | undefined>("cache", "readonly", (s) => s.get(k));
  return got ?? null;
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  const k = scoped(key);
  if (!k) return;
  await run("cache", "readwrite", (s) => s.put({ at: Date.now(), value }, k));
}

export async function blobGet(key: string): Promise<Blob | null> {
  const k = scoped(key);
  if (!k) return null;
  const got = await run<Blob | undefined>("blobs", "readonly", (s) => s.get(k));
  return got instanceof Blob ? got : null;
}

export async function blobPut(key: string, blob: Blob): Promise<void> {
  const k = scoped(key);
  if (!k) return;
  await run("blobs", "readwrite", (s) => s.put(blob, k));
}

/**
 * The whole store goes: on sign-out, so nothing of the person stays on the phone. The open
 * connection is closed first, or the browser would wait for it and never delete.
 */
export async function clearOffline(): Promise<void> {
  try {
    const db = await open();
    db?.close();
    opening = null;
    if (typeof indexedDB === "undefined") return;
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  } catch {
    // Nothing to clear, or nothing we may touch.
  }
}

/**
 * One edit made offline. The kinds are exactly the calls `src/sets/sets.ts` makes online. An
 * entry remembers whose it is and replays only for them.
 */
export type OutboxEntry = { owner?: string } & (
  | { kind: "save_set_layout"; setId: string; layout: unknown; at: number }
  | { kind: "place_item"; setId: string; slot: number; itemId: string; at: number }
  | { kind: "clear_slot"; setId: string; slot: number; at: number }
);

export async function outboxAdd(entry: OutboxEntry): Promise<boolean> {
  const me = owner();
  if (!me) return false;
  const key = await run<IDBValidKey>("outbox", "readwrite", (s) => s.add({ ...entry, owner: me }));
  return key !== null;
}

/** The signed-in person's own waiting edits, in order; anybody else's are dropped on sight. */
export async function outboxAll(): Promise<{ key: IDBValidKey; entry: OutboxEntry }[]> {
  const db = await open();
  const me = owner();
  if (!db || !me) return [];
  const strangers: IDBValidKey[] = [];
  const mine = await new Promise<{ key: IDBValidKey; entry: OutboxEntry }[]>((resolve) => {
    const out: { key: IDBValidKey; entry: OutboxEntry }[] = [];
    try {
      const tx = db.transaction("outbox", "readonly");
      const request = tx.objectStore("outbox").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        const entry = cursor.value as OutboxEntry;
        // An entry from before owners were stamped (2026-10-12) is taken as the signed-in
        // person's own: the server's rules decide what it may do, as for every replay.
        if (entry.owner === me || entry.owner === undefined) out.push({ key: cursor.key, entry });
        else strangers.push(cursor.key);
        cursor.continue();
      };
      request.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
  for (const key of strangers) await outboxRemove(key);
  return mine;
}

export async function outboxRemove(key: IDBValidKey): Promise<void> {
  await run("outbox", "readwrite", (s) => s.delete(key));
}

export async function outboxCount(): Promise<number> {
  return (await outboxAll()).length;
}
