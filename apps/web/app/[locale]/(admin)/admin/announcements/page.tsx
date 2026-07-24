import { AdminAnnouncementComposer } from '@/components/admin-announcement-composer';
import { requireAdminRole } from '@/lib/admin-rbac.server';
import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.announcements');
  return {
    title: t('titleMeta'),
    description: t('description'),
  };
}

export default async function AdminAnnouncementsPage() {
  await requireAdminRole(['super_admin']);
  const t = await getTranslations('admin.announcements');

  const supabase = await createClient();
  const { data: sportRows } = await supabase
    .from('sport')
    .select('id, name, display_name')
    .eq('is_active', true)
    .order('name', { ascending: true });

  const sports = (sportRows ?? []).map(s => ({ id: s.id, name: s.display_name ?? s.name }));

  return (
    <div className="flex w-full flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('description')}</p>
      </div>

      <AdminAnnouncementComposer sports={sports} />
    </div>
  );
}
