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
 * Render this once in the admin layout, before any shared hooks execute.
 */
export function SharedSupabaseSync() {
  useState(() => {
    setSupabaseInstance(createClient());
    return null;
  });

  return null;
}
