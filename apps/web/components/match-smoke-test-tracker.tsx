'use client';

import { useEffect } from 'react';

import { matchSmokeTestViewed } from '@/lib/analytics';

export function MatchSmokeTestTracker() {
  useEffect(() => {
    matchSmokeTestViewed();
  }, []);

  return null;
}
