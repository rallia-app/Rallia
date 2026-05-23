'use client';

import { useMatchStats, useUserStats, useUtmSignupStats } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';

import { KpiCard } from '@/components/admin/kpi-card';

/**
 * Cross-domain KPI strip rendered on the Overview tab. Each card links into
 * the relevant focused tab so admins can dive deeper.
 */
export function OverviewKpiStrip() {
  const t = useTranslations('admin.analytics');
  const { stats: userStats, loading: usersLoading } = useUserStats();
  const { stats: matchStats, loading: matchesLoading } = useMatchStats();
  // 1-day window matches the "today" framing on the overview cards.
  const { stats: utmSignups, loading: utmLoading } = useUtmSignupStats(1);

  const utmSignupsTotal = utmSignups.reduce((acc, row) => acc + row.signups, 0);
  const topCampaign = [...utmSignups].sort((a, b) => b.signups - a.signups)[0]?.campaign ?? null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <KpiCard
        label={t('activeToday')}
        value={userStats?.activeToday ?? null}
        loading={usersLoading}
        href="/admin/analytics/users"
      />
      <KpiCard
        label={t('newWeek')}
        value={userStats?.newWeek ?? null}
        loading={usersLoading}
        href="/admin/analytics/users"
      />
      <KpiCard
        label={t('matches')}
        value={matchStats?.totalMatches ?? null}
        loading={matchesLoading}
        href="/admin/analytics/matches"
      />
      <KpiCard
        label={t('utm.signupsToday')}
        value={utmLoading ? null : utmSignupsTotal}
        loading={utmLoading}
        href="/admin/analytics/acquisition"
      />
      <KpiCard
        label={t('utm.topCampaign')}
        value={topCampaign ?? '—'}
        loading={utmLoading}
        href="/admin/analytics/acquisition"
      />
    </div>
  );
}
