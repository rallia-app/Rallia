'use client';

import { useState } from 'react';

import { CampaignListSection } from '@/components/admin/campaign-list-section';
import { LinkBuilder } from '@/components/admin/link-builder';
import { UtmFilterBar, type WindowOption } from '@/components/admin/utm-filter-bar';
import { UtmMonitoringSection } from '@/components/admin/utm-monitoring-section';

/**
 * Acquisition tab: shared time-window filter at the top, UTM monitoring as
 * the headline section, then link-management (build new tracked links +
 * manage the campaign catalog) below the visualization.
 */
export function AcquisitionTab() {
  const [window, setWindow] = useState<WindowOption>('7d');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [demo, setDemo] = useState<boolean>(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const posthogUrl = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.posthog.com';
  // Demo toggle is dev-only; the route also enforces this server-side.
  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <div className="flex flex-col gap-4">
      <UtmFilterBar
        window={window}
        onWindowChange={setWindow}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        lastFetchedAt={lastFetchedAt}
        posthogUrl={posthogUrl}
        demo={isDev ? demo : undefined}
        onDemoChange={isDev ? setDemo : undefined}
      />
      <UtmMonitoringSection
        window={window}
        autoRefresh={autoRefresh}
        demo={isDev && demo}
        onLastFetchedAt={setLastFetchedAt}
      />
      <LinkBuilder />
      <CampaignListSection />
    </div>
  );
}
