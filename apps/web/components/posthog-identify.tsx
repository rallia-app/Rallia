'use client';

import { usePostHog } from 'posthog-js/react';
import { useEffect, useRef } from 'react';

export function PostHogIdentify({ userId, email }: { userId: string; email?: string }) {
  const posthog = usePostHog();
  const identifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (posthog && userId && identifiedRef.current !== userId) {
      posthog.identify(userId, { email });
      identifiedRef.current = userId;
    }
  }, [posthog, userId, email]);

  return null;
}
