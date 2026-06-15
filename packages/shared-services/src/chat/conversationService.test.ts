/**
 * Conversation Service tests.
 *
 * getTournamentChat is a thin read-by-tournament_id wrapper (the conversation
 * itself is created and synced by DB triggers, migration 20260613100100).
 * We test param marshalling, the not-found → null path, and error → null.
 */

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { getTournamentChat } from './conversationService';
import { supabase } from '../supabase';

const mockFrom = supabase.from as jest.Mock;

beforeEach(() => {
  mockFrom.mockReset();
});

function chain(result: { data: unknown; error: unknown }) {
  const proxy: Record<string, jest.Mock> = {};
  const handler = {
    get(_target: unknown, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      if (!proxy[prop]) {
        proxy[prop] = jest.fn(() => chainProxy);
      }
      return proxy[prop];
    },
  };
  const chainProxy = new Proxy({}, handler) as Record<string, jest.Mock>;
  return { chainProxy, proxy };
}

describe('getTournamentChat', () => {
  it('queries conversation by tournament_id and returns the row', async () => {
    const row = { id: 'conv-1', conversation_type: 'tournament', tournament_id: 't-1' };
    const { chainProxy, proxy } = chain({ data: row, error: null });
    mockFrom.mockReturnValue(chainProxy);

    const result = await getTournamentChat('t-1');

    expect(mockFrom).toHaveBeenCalledWith('conversation');
    expect(proxy.eq).toHaveBeenCalledWith('tournament_id', 't-1');
    expect(result).toEqual(row);
  });

  it('returns null when no chat exists (PGRST116)', async () => {
    const { chainProxy } = chain({ data: null, error: { code: 'PGRST116' } });
    mockFrom.mockReturnValue(chainProxy);

    await expect(getTournamentChat('t-1')).resolves.toBeNull();
  });

  it('returns null (not throw) on unexpected errors', async () => {
    const { chainProxy } = chain({ data: null, error: { code: '500', message: 'boom' } });
    mockFrom.mockReturnValue(chainProxy);

    await expect(getTournamentChat('t-1')).resolves.toBeNull();
  });
});
