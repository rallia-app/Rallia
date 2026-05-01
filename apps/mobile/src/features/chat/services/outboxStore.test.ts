/**
 * Tests for outboxStore — exercises the real AsyncStorage-backed
 * implementation via the official AsyncStorage mock.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  upsertRow,
  removeRow,
  listAll,
  listByConversation,
  clearAll,
  OutboxRow,
} from './outboxStore';

jest.mock('@rallia/shared-services', () => ({
  Logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

function makeRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    tmpId: `tmp-${Math.random().toString(36).slice(2)}`,
    conversationId: 'conv-1',
    senderId: 'sender-1',
    userId: 'user-1',
    content: 'hello',
    attachments: [],
    status: 'sending',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(async () => {
  await clearAll();
  jest.clearAllMocks();
});

describe('outboxStore — basic CRUD', () => {
  it('starts empty', async () => {
    expect(await listAll()).toEqual([]);
  });

  it('upsert inserts a new row', async () => {
    const row = makeRow({ tmpId: 'tmp-abc' });
    await upsertRow(row);
    expect(await listAll()).toEqual([row]);
  });

  it('upsert updates an existing row', async () => {
    const row = makeRow({ tmpId: 'tmp-upd' });
    await upsertRow(row);
    const updated = { ...row, status: 'failed' as const };
    await upsertRow(updated);
    const all = await listAll();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('failed');
  });

  it('removeRow deletes the correct row', async () => {
    const a = makeRow({ tmpId: 'tmp-a' });
    const b = makeRow({ tmpId: 'tmp-b' });
    await upsertRow(a);
    await upsertRow(b);
    await removeRow('tmp-a');
    const all = await listAll();
    expect(all).toHaveLength(1);
    expect(all[0].tmpId).toBe('tmp-b');
  });

  it('listByConversation filters correctly', async () => {
    const c1 = makeRow({ tmpId: 'tmp-c1', conversationId: 'conv-1' });
    const c2 = makeRow({ tmpId: 'tmp-c2', conversationId: 'conv-2' });
    await upsertRow(c1);
    await upsertRow(c2);
    expect(await listByConversation('conv-1')).toEqual([c1]);
    expect(await listByConversation('conv-2')).toEqual([c2]);
  });

  it('supports content: null (attachment-only messages)', async () => {
    const row = makeRow({ tmpId: 'tmp-null-content', content: null });
    await upsertRow(row);
    const all = await listAll();
    expect(all[0].content).toBeNull();
  });
});

describe('outboxStore — serial write queue (race condition fix)', () => {
  it('concurrent upserts do not clobber each other', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow({ tmpId: `tmp-race-${i}` }));

    // Fire all upserts simultaneously
    await Promise.all(rows.map(r => upsertRow(r)));

    const all = await listAll();
    expect(all).toHaveLength(10);

    const ids = new Set(all.map(r => r.tmpId));
    rows.forEach(r => expect(ids.has(r.tmpId)).toBe(true));
  });

  it('concurrent removeRow calls leave remaining rows intact', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeRow({ tmpId: `tmp-rem-${i}` }));
    for (const r of rows) await upsertRow(r);

    // Remove all simultaneously
    await Promise.all(rows.map(r => removeRow(r.tmpId)));

    expect(await listAll()).toHaveLength(0);
  });

  it('interleaved upsert + remove are both applied correctly', async () => {
    const a = makeRow({ tmpId: 'tmp-ia' });
    const b = makeRow({ tmpId: 'tmp-ib' });

    await Promise.all([upsertRow(a), upsertRow(b), removeRow('tmp-ia')]);

    const all = await listAll();
    expect(all.some(r => r.tmpId === 'tmp-ia')).toBe(false);
    expect(all.some(r => r.tmpId === 'tmp-ib')).toBe(true);
  });
});

describe('outboxStore — error handling', () => {
  it('surfaces AsyncStorage write errors to callers', async () => {
    const row = makeRow();
    // Make setItem fail on next call
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    await expect(upsertRow(row)).rejects.toThrow('disk full');
  });

  it('queue continues working after a failed write', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('transient'));

    const row1 = makeRow({ tmpId: 'tmp-fail' });
    const row2 = makeRow({ tmpId: 'tmp-ok' });

    await upsertRow(row1).catch(() => {}); // absorb the error
    await upsertRow(row2); // must succeed

    expect(await listAll()).toContainEqual(expect.objectContaining({ tmpId: 'tmp-ok' }));
  });
});
