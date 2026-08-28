jest.mock('../supabase', () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

import { supabase } from '../supabase';

import {
  AuthSessionUnavailableError,
  getUsableSession,
  isAuthSessionUnavailable,
  requireSession,
} from './session';

const mockGetSession = (supabase as unknown as { auth: { getSession: jest.Mock } }).auth.getSession;

const SESSION = { access_token: 'jwt', user: { id: 'p1' } };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getUsableSession', () => {
  it('returns the session when one is live', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    await expect(getUsableSession()).resolves.toBe(SESSION);
  });

  it('returns null when the refresh failed — the case supabase-js swallows', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthApiError', message: 'Invalid Refresh Token' },
    });
    await expect(getUsableSession()).resolves.toBeNull();
  });

  it('returns null when signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(getUsableSession()).resolves.toBeNull();
  });

  it('returns null when the session carries no access token', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'p1' } } }, error: null });
    await expect(getUsableSession()).resolves.toBeNull();
  });

  it('returns null instead of throwing when the storage read blows up', async () => {
    mockGetSession.mockRejectedValue(new Error('AsyncStorage unavailable'));
    await expect(getUsableSession()).resolves.toBeNull();
  });
});

describe('requireSession', () => {
  it('resolves to the session when one is live', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    await expect(requireSession('get_onboarding_gaps')).resolves.toBe(SESSION);
  });

  it('throws a named error naming the operation, so no anon call goes out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(requireSession('get_onboarding_gaps')).rejects.toThrow(
      AuthSessionUnavailableError
    );
    await expect(requireSession('get_onboarding_gaps')).rejects.toThrow('get_onboarding_gaps');
  });
});

describe('isAuthSessionUnavailable', () => {
  it('matches the thrown error', () => {
    expect(isAuthSessionUnavailable(new AuthSessionUnavailableError('rpc'))).toBe(true);
  });

  it('matches across a realm boundary, where instanceof would not', () => {
    expect(isAuthSessionUnavailable({ name: 'AuthSessionUnavailableError' })).toBe(true);
  });

  it('leaves real failures alone', () => {
    expect(isAuthSessionUnavailable(new Error('boom'))).toBe(false);
    expect(isAuthSessionUnavailable({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isAuthSessionUnavailable(null)).toBe(false);
  });
});
