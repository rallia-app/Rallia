jest.mock('../supabase', () => ({
  supabase: { auth: { getSession: jest.fn() }, rpc: jest.fn() },
}));

import { supabase } from '../supabase';

import { isMilestone1000Reached } from './milestoneService';

const client = supabase as unknown as { auth: { getSession: jest.Mock }; rpc: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isMilestone1000Reached', () => {
  it('reports the crossing for a signed-in player', async () => {
    client.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'jwt' } },
      error: null,
    });
    client.rpc.mockResolvedValue({ data: true, error: null });

    await expect(isMilestone1000Reached()).resolves.toBe(true);
  });

  // The launch prompt polls this on every cold start, including resumes where
  // the token expired in the background — exactly where the 42501s came from.
  it('never calls the RPC when the session is gone', async () => {
    client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(isMilestone1000Reached()).rejects.toThrow('milestone_1000_reached');
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
