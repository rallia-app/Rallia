'use client';

import { useUtmCampaigns } from '@rallia/shared-hooks';
import { useState } from 'react';

import { CampaignListSection } from '@/components/admin/campaign-list-section';
import { LinkBuilder } from '@/components/admin/link-builder';
import { UtmFilterBar, type WindowOption } from '@/components/admin/utm-filter-bar';
import { UtmMonitoringSection } from '@/components/admin/utm-monitoring-section';

/**
 * Acquisition tab: shared time-window filter at the top, UTM monitoring as
 * the headline section, then link-management (build new tracked links +
 * manage the campaign catalog) below the visualization.
 *
 * The campaign catalog hook is owned here and passed to both LinkBuilder and
 * CampaignListSection so a create/archive in one updates the other without
 * a page refresh.
 */
export function AcquisitionTab() {
  const [window, setWindow] = useState<WindowOption>('30d');
  // Off by default — a forgotten open tab polling every 60s was the top driver
  // of Vercel Fluid Active CPU. Admins opt in via the filter bar toggle.
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [demo, setDemo] = useState<boolean>(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  // Bumped by the filter bar's "Refresh" button to force a one-off refetch
  // (the manual alternative to leaving auto-refresh on).
  const [refreshSignal, setRefreshSignal] = useState<number>(0);
  const posthogUrl = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.posthog.com';
  const isDev = process.env.NODE_ENV !== 'production';

  const { campaigns, loading: campaignsLoading, create, archive } = useUtmCampaigns();

  return (
    <div className="flex flex-col gap-4">
      <UtmFilterBar
        window={window}
        onWindowChange={setWindow}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        lastFetchedAt={lastFetchedAt}
        onRefresh={() => setRefreshSignal(n => n + 1)}
        posthogUrl={posthogUrl}
        demo={isDev ? demo : undefined}
        onDemoChange={isDev ? setDemo : undefined}
      />
      <UtmMonitoringSection
        window={window}
        autoRefresh={autoRefresh}
        demo={isDev && demo}
        onLastFetchedAt={setLastFetchedAt}
        refreshSignal={refreshSignal}
      />
      <LinkBuilder campaigns={campaigns} onCreate={create} />
      <CampaignListSection campaigns={campaigns} loading={campaignsLoading} onArchive={archive} />
    </div>
  );
}
