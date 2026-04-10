'use client';

import { createClient } from '@/lib/supabase/client';
import { setSupabaseInstance } from '@rallia/shared-services';
import { useEffect, useMemo } from 'react';

/**
 * Replaces the shared supabase singleton with the web app's cookie-based browser client.
 *
 * Without this, shared hooks and services use a separate client that stores auth
 * tokens in localStorage — which never has the web session (stored in cookies).
 * Instead of syncing tokens between two clients, we just make them the same client.
 *
 * Render this once in the admin layout, before any shared hooks execute.
 */
export function SharedSupabaseSync() {
  const webClient = useMemo(() => createClient(), []);

  useEffect(() => {
    setSupabaseInstance(webClient);
  }, [webClient]);

  return null;
}
