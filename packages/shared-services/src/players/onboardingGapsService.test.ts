jest.mock('../supabase', () => ({
  supabase: { auth: { getSession: jest.fn() }, rpc: jest.fn() },
}));

import { supabase } from '../supabase';

import { getOnboardingGaps } from './onboardingGapsService';

const client = supabase as unknown as { auth: { getSession: jest.Mock }; rpc: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getOnboardingGaps', () => {
  it('returns the gap codes for a signed-in player', async () => {
    client.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'jwt' } },
      error: null,
    });
    client.rpc.mockResolvedValue({ data: ['postal_code'], error: null });

    await expect(getOnboardingGaps()).resolves.toEqual(['postal_code']);
  });

  // Without the guard supabase-js sends the anon key, and the RPC — which
  // revokes anon — answers 42501, reading as a missing grant.
  it('never calls the RPC when the session is gone', async () => {
    client.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthApiError', message: 'Invalid Refresh Token' },
    });

    await expect(getOnboardingGaps()).rejects.toThrow('get_onboarding_gaps');
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
