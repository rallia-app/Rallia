/**
 * Email send guards.
 *
 * Helpers used by every Resend send site to skip sending to addresses that
 * should never receive real email — most importantly the `@fake-rallia.com`
 * seed accounts. These are deterministic test/demo users created by
 * `supabase/seed.sql`; routing email to them either bounces or, worse, lands
 * in real-looking inboxes (some seed addresses can resolve through wildcard
 * MX), so we drop the request before it leaves the function.
 */

const FAKE_SEED_DOMAIN = '@fake-rallia.com';

/** Returns true if `email` belongs to a seeded fake user. */
export function isFakeSeedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(FAKE_SEED_DOMAIN);
}
