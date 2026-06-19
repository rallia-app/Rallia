'use client';

import { useEffect, useMemo, useState } from 'react';

import { MarketingSignOutButton } from './marketing-sign-out-button';

import { createClient } from '@/lib/supabase/client';

export function MarketingHeaderSession({ className }: { className?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  if (!hasSession) return null;

  return <MarketingSignOutButton className={className} />;
}
