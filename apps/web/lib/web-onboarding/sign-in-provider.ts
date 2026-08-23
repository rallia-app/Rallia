import type { User } from '@supabase/supabase-js';

/** The sign-in methods the app offers; `other` covers anything it cannot name. */
export type SignInProvider = 'google' | 'apple' | 'facebook' | 'email' | 'other';

const KNOWN: SignInProvider[] = ['google', 'apple', 'facebook', 'email'];

/**
 * The method the user most recently signed in with, so the hand-off page can tell them
 * to do the same in the app. Identities carry their own last sign-in time; the
 * app_metadata provider is only the first one ever used and stays as the fallback.
 */
export function signInProviderOf(user: Pick<User, 'app_metadata' | 'identities'>): SignInProvider {
  const latest = [...(user.identities ?? [])].sort(
    (a, b) => Date.parse(b.last_sign_in_at ?? '') - Date.parse(a.last_sign_in_at ?? '')
  )[0];
  const raw = latest?.provider ?? user.app_metadata?.provider ?? '';
  return (KNOWN as string[]).includes(raw) ? (raw as SignInProvider) : 'other';
}
