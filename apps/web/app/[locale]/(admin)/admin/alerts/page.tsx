import { AdminAlertsView } from '@/components/admin-alerts-view';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.alerts');
  return {
    title: `${t('title')} - Rallia`,
    description: t('title'),
  };
}

export default async function AdminAlertsPage() {
  const t = await getTranslations('admin.alerts');

  return (
    <div className="flex flex-col w-full gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
      </div>

      <AdminAlertsView />
    </div>
  );
}
