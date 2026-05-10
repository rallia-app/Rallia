import { getTranslations } from 'next-intl/server';

import { OverviewKpiStrip } from '@/components/admin/overview-kpi-strip';

export default async function AdminAnalyticsOverviewPage() {
  const t = await getTranslations('admin.analytics');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground m-0">{t('overviewHint')}</p>
      <OverviewKpiStrip />
    </div>
  );
}
