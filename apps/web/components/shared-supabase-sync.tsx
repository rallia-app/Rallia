'use client';

import { setSupabaseInstance } from '@rallia/shared-services';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/**
 * Replaces the shared supabase singleton with the web app's cookie-based browser client.
 *
 * Without this, shared hooks and services use a separate client that stores auth
 * tokens in localStorage — which never has the web session (stored in cookies).
 * Instead of syncing tokens between two clients, we just make them the same client.
 *
 * The swap is done synchronously during render via lazy useState initializer so
 * that any child component's mount-time data fetches see the cookie-aware client
 * immediately — useEffect-based wiring leaves a race window where children mount
 * (and fire fetches) before this component's effect runs.
 *
 * Browser-only on purpose. `setSupabaseInstance` writes a module-level variable,
 * which on the server is a per-process global shared across concurrent requests.
 * This is a client component, so without the guard the initializer also runs
 * during SSR and installs the anon client into that global — racing the
 * service-role client that `lib/web-join/complete.ts` installs for the duration
 * of a join. The two would clobber each other across requests: a join could lose
 * its privileges mid-await, or an SSR render could inherit RLS bypass.
 *
 * Render this once per authenticated shell, before any shared hooks execute.
 */
export function SharedSupabaseSync() {
  useState(() => {
    if (typeof window === 'undefined') return null;
    setSupabaseInstance(createClient());
    return null;
  });

  return null;
}
