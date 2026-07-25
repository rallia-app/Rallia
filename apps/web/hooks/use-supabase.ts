'use client';

import { useMemo } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/types';

let browserClient: SupabaseClient<Database> | undefined;

/**
 * The one browser Supabase client, shared across every call site.
 *
 * Prefer this over ad-hoc `useMemo(() => createClient(), [])` (the org sidebar's
 * pattern): a single instance means one auth listener and one token refresh loop.
 * Always pass it to `useAuth({ client })` — that keeps the auth path independent of
 * whether SharedSupabaseSync has swapped the shared-services singleton yet.
 *
 * During SSR of client components a throwaway instance is returned instead of
 * caching, so the server never pins a client built without cookie access.
 */
export function useSupabase(): SupabaseClient<Database> {
  return useMemo(() => {
    if (typeof window === 'undefined') return createClient();
    if (!browserClient) browserClient = createClient();
    return browserClient;
  }, []);
}
