import { AdminCommunicationsView } from '@/components/admin-communications-view';
import { requireAdminRole } from '@/lib/admin-rbac.server';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.communications');
  return {
    title: t('titleMeta'),
    description: t('description'),
  };
}

export default async function AdminCommunicationsPage() {
  await requireAdminRole(['super_admin', 'moderator']);
  const t = await getTranslations('admin.communications');

  return (
    <div className="flex flex-col w-full gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">{t('description')}</p>
      </div>

      <AdminCommunicationsView />
    </div>
  );
}
