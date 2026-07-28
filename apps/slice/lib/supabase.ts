// Server-only by construction: every consumer is a route handler.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only, deliberately. The env vars carry no NEXT_PUBLIC_ prefix so the
 * database URL never reaches the browser bundle — the browser talks to this
 * app's own API routes and nothing else.
 */

let anonClient: SupabaseClient | null = null;
let adminClient: SupabaseClient | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/** RLS-bound reads (sports, facility search, availability). */
export function getAnonClient(): SupabaseClient {
  anonClient ??= createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false },
  });
  return anonClient;
}

/** Service role, used only for the lead upsert. */
export function getAdminClient(): SupabaseClient {
  adminClient ??= createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } }
  );
  return adminClient;
}
