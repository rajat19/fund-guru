import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

// Imported after fake-indexeddb/auto so the module sees a working indexedDB.
import {
  DEFAULT_TTL_MS,
  clearLocalCache,
  getLocalCache,
  readLocalCache,
  setLocalCache,
} from '@/utils/cache';

const KEY = 'test-key';

beforeEach(() => {
  // Fresh database per test — entries are keyed by name, so leaking state
  // between tests would make TTL assertions order-dependent.
  globalThis.indexedDB = new IDBFactory();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('round-trip', () => {
  it('stores and returns a value', async () => {
    await setLocalCache(KEY, [{ id: 'a' }]);
    expect(await getLocalCache<Array<{ id: string }>>(KEY)).toEqual([{ id: 'a' }]);
  });

  it('reports a miss for an unknown key', async () => {
    const result = await readLocalCache(KEY);
    expect(result.data).toBeNull();
    expect(result.reason).toBe('miss');
  });

  it('preserves nested structure', async () => {
    const payload = { funds: [{ returns: { oneYear: 12.5 }, nested: { deep: true } }] };
    await setLocalCache(KEY, payload);
    expect(await getLocalCache(KEY)).toEqual(payload);
  });
});

describe('TTL', () => {
  // This is the bug being guarded against: the previous cache had no expiry, so
  // a browser that loaded the app once served that snapshot forever.
  it('returns a value that is within the TTL', async () => {
    await setLocalCache(KEY, ['fresh']);
    const result = await readLocalCache<string[]>(KEY, DEFAULT_TTL_MS);
    expect(result.reason).toBe('hit');
    expect(result.data).toEqual(['fresh']);
  });

  it('defaults to a multi-day TTL, since syncs are manual and infrequent', () => {
    // A short TTL would make every visitor re-download an identical file.
    expect(DEFAULT_TTL_MS).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('discards a value older than the TTL', async () => {
    await setLocalCache(KEY, ['stale']);

    // Advance wall-clock past the TTL rather than waiting.
    const written = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(written + DEFAULT_TTL_MS + 1000);

    const result = await readLocalCache<string[]>(KEY, DEFAULT_TTL_MS);
    expect(result.data).toBeNull();
    expect(result.reason).toBe('expired');
    // The age is still reported, so callers can log how stale it was.
    expect(result.ageMs).toBeGreaterThan(DEFAULT_TTL_MS);
  });

  it('honours a caller-supplied TTL', async () => {
    await setLocalCache(KEY, ['x']);
    const written = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(written + 5000);

    expect((await readLocalCache(KEY, 1000)).reason).toBe('expired');
    expect((await readLocalCache(KEY, 60_000)).reason).toBe('hit');
  });

  it('reports age on a hit', async () => {
    await setLocalCache(KEY, ['x']);
    const written = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(written + 1000);

    const result = await readLocalCache(KEY, DEFAULT_TTL_MS);
    expect(result.ageMs).toBeGreaterThanOrEqual(1000);
  });
});

describe('dataset version', () => {
  // Freshness is decided by comparing which dataset build the cache holds
  // against what is published, not by the clock — the TTL is only a backstop.
  // That is what makes a multi-day TTL safe.
  it('round-trips the version tag', async () => {
    await setLocalCache(KEY, ['funds'], '2026-08-14T00:00:00.000Z');
    const result = await readLocalCache<string[]>(KEY);

    expect(result.reason).toBe('hit');
    expect(result.version).toBe('2026-08-14T00:00:00.000Z');
  });

  it('reports null version for entries written without one', async () => {
    await setLocalCache(KEY, ['funds']);
    expect((await readLocalCache(KEY)).version).toBeNull();
  });

  it('still reports the version of an expired entry', async () => {
    // The caller needs this to decide whether re-fetching would even help.
    await setLocalCache(KEY, ['funds'], 'build-1');
    const written = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(written + DEFAULT_TTL_MS + 1);

    const result = await readLocalCache(KEY);
    expect(result.reason).toBe('expired');
    expect(result.version).toBe('build-1');
  });
});

describe('schema versioning', () => {
  it('rejects a raw pre-envelope value rather than trusting it', async () => {
    // Entries written by the old implementation are bare arrays with no
    // timestamp, so their age is unknowable and they must not be served.
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('FundGuruDB', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('cache');
      request.onsuccess = () => {
        const tx = request.result.transaction('cache', 'readwrite');
        tx.objectStore('cache').put(['legacy', 'array'], KEY);
        tx.oncomplete = () => resolve();
      };
    });

    const result = await readLocalCache(KEY);
    expect(result.data).toBeNull();
    expect(result.reason).toBe('stale-schema');
  });
});

describe('clearLocalCache', () => {
  it('removes a single key and leaves others alone', async () => {
    await setLocalCache('a', [1]);
    await setLocalCache('b', [2]);

    await clearLocalCache('a');

    expect(await getLocalCache('a')).toBeNull();
    expect(await getLocalCache('b')).toEqual([2]);
  });

  it('clears everything when no key is given', async () => {
    await setLocalCache('a', [1]);
    await setLocalCache('b', [2]);

    await clearLocalCache();

    expect(await getLocalCache('a')).toBeNull();
    expect(await getLocalCache('b')).toBeNull();
  });

  it('is a no-op for a key that was never written', async () => {
    await expect(clearLocalCache('never-written')).resolves.toBeUndefined();
  });
});

describe('resilience', () => {
  it('treats an unavailable IndexedDB as a miss rather than throwing', async () => {
    const original = globalThis.indexedDB;
    // Cast rather than @ts-expect-error: the directive is only *required* under
    // strict mode, so it reads as unused under a looser config and becomes an
    // error itself.
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined;

    try {
      const result = await readLocalCache(KEY);
      expect(result.reason).toBe('unavailable');
      // Writes must also stay silent — a broken cache is not a fatal error.
      await expect(setLocalCache(KEY, [1])).resolves.toBeUndefined();
    } finally {
      globalThis.indexedDB = original;
    }
  });
});
