'use client';

import { usePostHog } from 'posthog-js/react';
import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';
import { clearUtmCookie, readUtmCookie } from '@/lib/utm-cookie';

export function PostHogIdentify({ userId, email }: { userId: string; email?: string }) {
  const posthog = usePostHog();
  const identifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!posthog || !userId || identifiedRef.current === userId) return;
    posthog.identify(userId, { email });
    identifiedRef.current = userId;

    // Flush first-touch UTMs onto the now-identified user, then clear the
    // cookie so a future signup on the same device gets fresh attribution.
    const utm = readUtmCookie();
    if (!utm) return;
    posthog.setPersonProperties(utm);

    // Mirror the same UTMs onto profile.utm_* so the admin Acquisition tab can
    // join attribution to downstream Supabase data (matches, bookings, etc.).
    // The RPC is write-once, so re-running is a no-op if columns are already set.
    // Cast: `set_profile_utm` is added in 20260510170000_profile_utm_columns.sql;
    // `Database` types regenerate via `supabase gen types typescript --local`.
    const supabase = createClient();
    (
      supabase.rpc as unknown as (
        fn: 'set_profile_utm',
        args: { p_player_id: string; p_utm: Record<string, unknown> }
      ) => Promise<{ error: unknown }>
    )('set_profile_utm', {
      p_player_id: userId,
      p_utm: utm as unknown as Record<string, unknown>,
    })
      .then(({ error }) => {
        if (!error) clearUtmCookie();
      })
      .catch(() => {
        // Best-effort. Cookie stays so a later attempt can succeed.
      });
  }, [posthog, userId, email]);

  return null;
}
