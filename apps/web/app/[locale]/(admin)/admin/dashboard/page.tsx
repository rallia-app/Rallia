import { AdminDashboardAlertsPreview } from '@/components/admin-dashboard-alerts-preview';
import { AdminDashboardKPIs } from '@/components/admin-dashboard-kpis';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.dashboard');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminDashboardPage() {
  const t = await getTranslations('admin.dashboard');

  return (
    <div className="flex flex-col w-full gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 mb-0">{t('description')}</p>
      </div>

      <AdminDashboardKPIs />

      <AdminDashboardAlertsPreview />
    </div>
  );
}
