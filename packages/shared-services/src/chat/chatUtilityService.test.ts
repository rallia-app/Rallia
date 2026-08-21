/**
 * Chat utility service tests.
 *
 * getTotalUnreadCount powers the chat tab badge and must hit the dedicated
 * get_total_unread_count RPC (not the full conversation list), and degrade to
 * 0 instead of throwing.
 */

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { getTotalUnreadCount } from './chatUtilityService';
import { supabase } from '../supabase';

const mockRpc = supabase.rpc as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe('getTotalUnreadCount', () => {
  it('calls the dedicated RPC with the player id and returns the count', async () => {
    mockRpc.mockResolvedValue({ data: 7, error: null });

    await expect(getTotalUnreadCount('player-1')).resolves.toBe(7);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_total_unread_count', { p_player_id: 'player-1' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns 0 when the RPC returns null', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await expect(getTotalUnreadCount('player-1')).resolves.toBe(0);
  });

  it('returns 0 and does not throw when the RPC errors', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(getTotalUnreadCount('player-1')).resolves.toBe(0);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
