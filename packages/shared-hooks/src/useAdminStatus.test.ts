/**
 * Tests for the useAdminStatus module-level cache — the fix that replaced a
 * per-mount network auth.getUser() + admin select with one shared, TTL-cached
 * fetch. These pin the load-bearing behaviors: local-session resolution (no
 * getUser), permission merging, TTL caching, in-flight dedup, and cache
 * clearing.
 */

import { __adminStatusInternals, clearAdminStatusCache } from './useAdminStatus';

const { loadAdminStatus, cache, inflight } = __adminStatusInternals;

type MockClientCalls = { getSession: number; getUser: number; adminSelects: number };

function makeClient(opts: {
  userId?: string | null;
  adminRow?: { role: string; permissions: Record<string, unknown> | null } | null;
  adminError?: { message: string } | null;
}) {
  const calls: MockClientCalls = { getSession: 0, getUser: 0, adminSelects: 0 };
  const client = {
    auth: {
      getSession: async () => {
        calls.getSession++;
        return {
          data: { session: opts.userId ? { user: { id: opts.userId } } : null },
        };
      },
      getUser: async () => {
        calls.getUser++;
        throw new Error('getUser must not be called — it is a network round-trip');
      },
    },
    from: (table: string) => {
      expect(table).toBe('admin');
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              calls.adminSelects++;
              return { data: opts.adminRow ?? null, error: opts.adminError ?? null };
            },
          }),
        }),
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, calls };
}

beforeEach(() => {
  clearAdminStatusCache();
  inflight.clear();
});

describe('loadAdminStatus', () => {
  it('resolves the user via local getSession (never network getUser) and maps an admin row', async () => {
    const { client, calls } = makeClient({
      userId: 'u1',
      adminRow: { role: 'support', permissions: { users: { write: true } } },
    });

    const result = await loadAdminStatus(client, undefined, false);

    expect(calls.getUser).toBe(0);
    expect(calls.getSession).toBe(1);
    expect(result.adminId).toBe('u1');
    expect(result.role).toBe('support');
    // Shallow merge (parity with the original implementation): a custom
    // category replaces the role default wholesale; untouched categories keep
    // their defaults.
    expect(result.permissions?.users).toEqual({ write: true });
    expect(result.permissions?.analytics).toEqual({ read: true, export: false });
  });

  it('returns not-admin without querying the admin table when signed out', async () => {
    const { client, calls } = makeClient({ userId: null });

    const result = await loadAdminStatus(client, undefined, false);

    expect(result).toEqual({ adminId: null, role: null, permissions: null });
    expect(calls.adminSelects).toBe(0);
  });

  it('returns not-admin when no admin row exists', async () => {
    const { client } = makeClient({ userId: 'u1', adminRow: null });

    const result = await loadAdminStatus(client, undefined, false);

    expect(result).toEqual({ adminId: null, role: null, permissions: null });
  });

  it('serves repeat calls from cache within the TTL', async () => {
    const { client, calls } = makeClient({ userId: 'u1', adminRow: null });

    await loadAdminStatus(client, undefined, false);
    await loadAdminStatus(client, undefined, false);
    await loadAdminStatus(client, undefined, false);

    expect(calls.getSession).toBe(1);
    expect(calls.adminSelects).toBe(1);
  });

  it('collapses concurrent calls into one fetch (in-flight dedup)', async () => {
    const { client, calls } = makeClient({ userId: 'u1', adminRow: null });

    const [a, b, c] = await Promise.all([
      loadAdminStatus(client, undefined, false),
      loadAdminStatus(client, undefined, false),
      loadAdminStatus(client, undefined, false),
    ]);

    expect(calls.adminSelects).toBe(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('refetches after the cache is cleared', async () => {
    const { client, calls } = makeClient({ userId: 'u1', adminRow: null });

    await loadAdminStatus(client, undefined, false);
    clearAdminStatusCache();
    await loadAdminStatus(client, undefined, false);

    expect(calls.adminSelects).toBe(2);
  });

  it('force bypasses the cache', async () => {
    const { client, calls } = makeClient({ userId: 'u1', adminRow: null });

    await loadAdminStatus(client, undefined, false);
    await loadAdminStatus(client, undefined, true);

    expect(calls.adminSelects).toBe(2);
  });

  it('propagates admin query errors and does not poison the cache', async () => {
    const { client } = makeClient({ userId: 'u1', adminError: { message: 'boom' } });

    await expect(loadAdminStatus(client, undefined, false)).rejects.toThrow('boom');
    expect(cache.size).toBe(0);
    expect(inflight.size).toBe(0);
  });

  it('uses an explicit userId without touching auth at all', async () => {
    const { client, calls } = makeClient({
      userId: null,
      adminRow: { role: 'analyst', permissions: null },
    });

    const result = await loadAdminStatus(client, 'u2', false);

    expect(calls.getSession).toBe(0);
    expect(result.adminId).toBe('u2');
    expect(result.role).toBe('analyst');
  });
});
