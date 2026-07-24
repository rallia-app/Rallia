import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AdminBroadcastsView } from '@/components/admin-broadcasts-view';
import { requireAdminRole } from '@/lib/admin-rbac.server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.broadcasts');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminBroadcastsPage() {
  await requireAdminRole(['super_admin', 'moderator']);
  const t = await getTranslations('admin.broadcasts');

  // Active sports power the email segment builder's sport filter.
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

      <AdminBroadcastsView sports={sports ?? []} />
    </div>
  );
}
