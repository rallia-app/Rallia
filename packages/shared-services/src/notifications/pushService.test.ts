/**
 * Push Service tests.
 *
 * registerPushToken writes the Expo token onto an existing player row. The row
 * is created during onboarding, so a registration fired at auth time can match
 * zero rows — and PostgREST reports that as a success, not an error. These
 * tests pin the zero-row branch, since silently treating it as registered is
 * what left ~32% of players unpushable.
 */

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { supabase } from '../supabase';

import { registerPushToken } from './pushService';

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

describe('registerPushToken', () => {
  it('reports missing_player_row when the update matches no rows', async () => {
    const { chainProxy } = chain({ data: [], error: null });
    mockFrom.mockReturnValue(chainProxy);

    await expect(registerPushToken('user-1', 'ExponentPushToken[abc]')).resolves.toEqual({
      status: 'missing_player_row',
    });
  });

  it('reports registered when a row was written', async () => {
    const { chainProxy } = chain({ data: [{ id: 'user-1' }], error: null });
    mockFrom.mockReturnValue(chainProxy);

    await expect(registerPushToken('user-1', 'ExponentPushToken[abc]')).resolves.toEqual({
      status: 'registered',
    });
  });

  it('selects the id so the affected row count is observable', async () => {
    const { chainProxy, proxy } = chain({ data: [{ id: 'user-1' }], error: null });
    mockFrom.mockReturnValue(chainProxy);

    await registerPushToken('user-1', 'ExponentPushToken[abc]');

    expect(mockFrom).toHaveBeenCalledWith('player');
    expect(proxy.update).toHaveBeenCalledWith({
      expo_push_token: 'ExponentPushToken[abc]',
      push_notifications_enabled: true,
    });
    expect(proxy.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(proxy.select).toHaveBeenCalledWith('id');
  });

  it('throws on a real database error', async () => {
    const { chainProxy } = chain({ data: null, error: { message: 'permission denied' } });
    mockFrom.mockReturnValue(chainProxy);

    await expect(registerPushToken('user-1', 'ExponentPushToken[abc]')).rejects.toThrow(
      'Failed to register push token: permission denied'
    );
  });

  it('treats a null data payload as missing_player_row rather than success', async () => {
    const { chainProxy } = chain({ data: null, error: null });
    mockFrom.mockReturnValue(chainProxy);

    await expect(registerPushToken('user-1', 'ExponentPushToken[abc]')).resolves.toEqual({
      status: 'missing_player_row',
    });
  });
});
