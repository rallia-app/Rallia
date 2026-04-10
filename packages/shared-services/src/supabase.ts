import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase credentials from environment variables
// These will be injected by the platform (React Native or Next.js)
function getSupabaseUrl() {
  return process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
}

function getSupabaseAnonKey() {
  return (
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  );
}

// Lazy-initialized Supabase client to avoid module-level errors during build
// when environment variables are not available (e.g., Next.js static page collection in CI)
let _supabaseInstance: SupabaseClient | null = null;

function getOrCreateClient(): SupabaseClient {
  if (!_supabaseInstance) {
    const url = getSupabaseUrl();
    const key = getSupabaseAnonKey();
    if (!url) {
      throw new Error(
        'Supabase URL is not configured. Set NEXT_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL.'
      );
    }
    _supabaseInstance = createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return _supabaseInstance;
}

// Exported as a getter so it is lazily initialized on first access, not at import time.
// This prevents build failures when env vars are unavailable during static analysis.
export { getOrCreateClient as getSupabase };

// For backward compatibility: `supabase` is a proxy that lazily initializes the client.
// Consumers can continue to use `import { supabase } from '../supabase'` unchanged.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getOrCreateClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    // Bind functions to the real client so `this` context is preserved
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});

/**
 * Replace the shared supabase singleton with an externally-created client.
 * On web, call this early with the cookie-based browser client so that all
 * shared hooks and services use the same auth session — no token syncing needed.
 */
export function setSupabaseInstance(client: SupabaseClient): void {
  _supabaseInstance = client;
}

// Platform-specific configuration helper
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const configureSupabaseStorage = (storage: any) => {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  // Recreate the client with the platform-specific storage
  _supabaseInstance = createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      storage: storage, // Set storage during client creation
    },
  });

  return _supabaseInstance;
};
