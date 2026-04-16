import { AdminAnalyticsOverview } from '@/components/admin-analytics-overview';
import { requireAdminRole } from '@/lib/admin-rbac.server';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.analytics');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminAnalyticsPage() {
  await requireAdminRole(['super_admin', 'analyst']);
  const t = await getTranslations('admin.analytics');

  return (
    <div className="flex flex-col w-full gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 mb-0">{t('description')}</p>
      </div>

      <AdminAnalyticsOverview />
    </div>
  );
}
