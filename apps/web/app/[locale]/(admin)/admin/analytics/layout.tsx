import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { requireAdminRole } from '@/lib/admin-rbac.server';
import { AnalyticsTabsNav } from '@/components/admin/analytics-tabs-nav';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.analytics');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminAnalyticsLayout({ children }: { children: ReactNode }) {
  // Single role gate for all analytics tabs — child pages don't need to repeat it.
  await requireAdminRole(['super_admin', 'analyst']);
  const t = await getTranslations('admin.analytics');

  return (
    <div className="flex flex-col w-full gap-6">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 mb-0">{t('description')}</p>
      </div>
      <AnalyticsTabsNav />
      {children}
    </div>
  );
}
