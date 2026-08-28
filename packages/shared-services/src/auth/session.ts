/**
 * Session readiness for calls that require the `authenticated` role.
 *
 * supabase-js resolves a request's token with
 * `getSession().data.session?.access_token ?? supabaseKey` and drops the error
 * getSession() hands back. So when a refresh fails — app backgrounded past
 * token expiry with auto-refresh stopped, or simply offline — the call still
 * goes out, carrying the anon key. Every RPC that revokes anon then answers
 * 42501 "permission denied", which reads like a missing grant instead of a
 * dead session, and functions that check auth.uid() see NULL.
 *
 * Asking getSession() first is what closes that hole: it is the same call the
 * client makes, so it surfaces the error the client swallows and leaves a
 * freshly refreshed token behind for the request that follows. It stays local
 * while the token is valid, unlike getUser(), which pays a network round trip
 * every time and still races the token the request ends up using.
 */

import type { Session } from '@supabase/supabase-js';

import { supabase } from '../supabase';

export class AuthSessionUnavailableError extends Error {
  constructor(operation: string) {
    super(`No usable session for ${operation}`);
    this.name = 'AuthSessionUnavailableError';
  }
}

/** True for the error `requireSession` throws, whatever realm it crossed. */
export function isAuthSessionUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { name?: unknown }).name === 'AuthSessionUnavailableError';
}

/**
 * The current session, or null when it is missing or no longer refreshable.
 * Never throws: callers use it to decide whether to make the call at all.
 */
export async function getUsableSession(): Promise<Session | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session?.access_token ? data.session : null;
  } catch {
    return null;
  }
}

/**
 * Guard an authenticated-only call. Throws AuthSessionUnavailableError rather
 * than letting supabase-js fall back to the anon key.
 */
export async function requireSession(operation: string): Promise<Session> {
  const session = await getUsableSession();
  if (!session) throw new AuthSessionUnavailableError(operation);
  return session;
}
