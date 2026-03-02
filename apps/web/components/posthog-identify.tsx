'use client';

import { useOrganization } from '@/components/organization-context';
import { usePostHog } from 'posthog-js/react';
import { useEffect, useRef } from 'react';

export function PostHogIdentify({ userId, email }: { userId: string; email: string }) {
  const posthog = usePostHog();
  const hasIdentified = useRef(false);
  const { selectedOrganization } = useOrganization();

  // Identify user once per session
  useEffect(() => {
    if (posthog && userId && !hasIdentified.current) {
      posthog.identify(userId, { email });
      hasIdentified.current = true;
    }
  }, [posthog, userId, email]);

  // Set organization group when org is selected/changed
  useEffect(() => {
    if (posthog && selectedOrganization) {
      posthog.group('organization', selectedOrganization.id, {
        name: selectedOrganization.name,
      });
    }
  }, [posthog, selectedOrganization]);

  return null;
}
