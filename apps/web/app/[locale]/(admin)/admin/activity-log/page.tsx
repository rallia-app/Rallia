import { AuditLogView } from '@/components/audit-log-view';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.audit');
  return {
    title: `${t('title')} - Rallia`,
    description: t('subtitle'),
  };
}

export default async function AdminActivityLogPage() {
  const t = await getTranslations('admin.audit');

  return (
    <div className="flex flex-col w-full gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 mb-0">{t('subtitle')}</p>
      </div>

      <AuditLogView />
    </div>
  );
}
