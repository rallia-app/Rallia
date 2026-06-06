import { AdminEmailsView } from '@/components/admin-emails-view';
import { requireAdminRole } from '@/lib/admin-rbac.server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.emails');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminEmailsPage() {
  await requireAdminRole(['super_admin']);
  const t = await getTranslations('admin.emails');

  // Active sports power the segment builder's sport filter.
  const { data: sports } = await createServiceRoleClient()
    .from('sport')
    .select('id, display_name')
    .eq('is_active', true)
    .order('display_name');

  return (
    <div className="flex flex-col w-full gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">{t('description')}</p>
      </div>

      <AdminEmailsView sports={sports ?? []} />
    </div>
  );
}
