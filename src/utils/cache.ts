/**
 * IndexedDB cache for the fund universe.
 *
 * Entries carry a written-at timestamp and the dataset build they came from.
 * Without a TTL, a browser that loaded the app once would keep serving that
 * snapshot forever, which is fatal for an app about current fund data; without
 * the build identity, there would be no way to tell "same data, just older" from
 * "actually superseded".
 *
 * There is no hand-maintained schema version. The dataset's `generatedAt`
 * changes on every sync, which already invalidates every client.
 */

const DB_NAME = 'FundGuruDB';
const DB_VERSION = 1;
const STORE = 'cache';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Backstop expiry, not a freshness mechanism.
 *
 * Syncs are manual and infrequent, so expiring after a few hours would make
 * every visitor re-download an identical file for nothing. Correctness comes
 * from the version check instead: the cache records which dataset build it holds
 * (`version` below), and a background revalidation replaces it as soon as a new
 * build is published — see `revalidateFunds` in firebaseService.
 *
 * So the TTL only needs to catch the pathological case where revalidation never
 * succeeds. Seven days is generous for that and costs nothing in the normal path.
 */
export const DEFAULT_TTL_MS = 7 * DAY_MS;

export const FUNDS_CACHE_KEY = 'all_mutual_funds';

interface CacheEnvelope<T> {
  cachedAt: number;
  /**
   * Identity of the upstream build this entry came from (for funds, the
   * dataset's `generatedAt`). Lets a reader tell "same data, just older" from
   * "actually superseded" without re-downloading the payload.
   */
  version?: string;
  data: T;
}

/**
 * Shape guard only — there is deliberately no schema version.
 *
 * Cache validity comes from `version`, which holds the dataset's `generatedAt`
 * and therefore changes on every sync. A separate version number would have to
 * be bumped by hand and told us nothing `generatedAt` does not already.
 *
 * Entries written by older builds carry an extra `schemaVersion` field, which is
 * simply ignored.
 */
const isEnvelope = <T>(value: unknown): value is CacheEnvelope<T> =>
  typeof value === 'object' && value !== null && 'cachedAt' in value && 'data' in value;

const openDb = (): Promise<IDBDatabase | null> =>
  new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };

    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

export interface CacheReadResult<T> {
  data: T | null;
  /** Age in ms of what was found, even when it was too old to return. */
  ageMs: number | null;
  /** Upstream build identity of the entry, when it recorded one. */
  version: string | null;
  reason: 'hit' | 'miss' | 'expired' | 'stale-schema' | 'unavailable';
}

/**
 * Reads a cache entry, returning why it missed so callers can log or decide to
 * fall back. Never rejects — a broken cache is a miss, not an error.
 */
export const readLocalCache = async <T>(
  key: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<CacheReadResult<T>> => {
  const db = await openDb();
  if (!db || !db.objectStoreNames.contains(STORE)) {
    return { data: null, ageMs: null, version: null, reason: 'unavailable' };
  }

  const raw = await new Promise<unknown>((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  if (raw == null) return { data: null, ageMs: null, version: null, reason: 'miss' };

  // Entries written before envelopes existed are treated as stale rather than
  // trusted, since we cannot tell how old they are.
  if (!isEnvelope<T>(raw)) {
    return { data: null, ageMs: null, version: null, reason: 'stale-schema' };
  }

  const version = raw.version ?? null;
  const ageMs = Date.now() - raw.cachedAt;
  if (ageMs > ttlMs) return { data: null, ageMs, version, reason: 'expired' };

  return { data: raw.data, ageMs, version, reason: 'hit' };
};

/** Back-compat convenience: the value if fresh, null otherwise. */
export const getLocalCache = async <T>(
  key: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T | null> => (await readLocalCache<T>(key, ttlMs)).data;

export const setLocalCache = async <T>(
  key: string,
  data: T,
  version?: string,
): Promise<void> => {
  const db = await openDb();
  if (!db || !db.objectStoreNames.contains(STORE)) return;

  const envelope: CacheEnvelope<T> = {
    cachedAt: Date.now(),
    version,
    data,
  };

  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(envelope, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
};

export const clearLocalCache = async (key?: string): Promise<void> => {
  const db = await openDb();
  if (!db || !db.objectStoreNames.contains(STORE)) return;

  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      if (key) store.delete(key);
      else store.clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
};
