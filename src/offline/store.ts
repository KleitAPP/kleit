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
 */

const DB_NAME = "kleit-offline";
const DB_VERSION = 1;

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
  const got = await run<Cached<T> | undefined>("cache", "readonly", (s) => s.get(key));
  return got ?? null;
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  await run("cache", "readwrite", (s) => s.put({ at: Date.now(), value }, key));
}

export async function blobGet(key: string): Promise<Blob | null> {
  const got = await run<Blob | undefined>("blobs", "readonly", (s) => s.get(key));
  return got instanceof Blob ? got : null;
}

export async function blobPut(key: string, blob: Blob): Promise<void> {
  await run("blobs", "readwrite", (s) => s.put(blob, key));
}

/** One edit made offline. The kinds are exactly the calls `src/sets/sets.ts` makes online. */
export type OutboxEntry =
  | { kind: "save_set_layout"; setId: string; layout: unknown; at: number }
  | { kind: "place_item"; setId: string; slot: number; itemId: string; at: number }
  | { kind: "clear_slot"; setId: string; slot: number; at: number };

export async function outboxAdd(entry: OutboxEntry): Promise<boolean> {
  const key = await run<IDBValidKey>("outbox", "readwrite", (s) => s.add(entry));
  return key !== null;
}

export async function outboxAll(): Promise<{ key: IDBValidKey; entry: OutboxEntry }[]> {
  const db = await open();
  if (!db) return [];
  return new Promise((resolve) => {
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
        out.push({ key: cursor.key, entry: cursor.value as OutboxEntry });
        cursor.continue();
      };
      request.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
}

export async function outboxRemove(key: IDBValidKey): Promise<void> {
  await run("outbox", "readwrite", (s) => s.delete(key));
}

export async function outboxCount(): Promise<number> {
  return (await run<number>("outbox", "readonly", (s) => s.count())) ?? 0;
}
