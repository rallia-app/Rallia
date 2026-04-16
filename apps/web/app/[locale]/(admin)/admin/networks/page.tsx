import { NetworksDataTable } from '@/components/networks-data-table';
import { requireAdminRole } from '@/lib/admin-rbac.server';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const tSidebar = await getTranslations('admin.sidebar');
  const tMod = await getTranslations('admin.moderation');
  return {
    title: `${tSidebar('networks')} - Rallia`,
    description: tMod('networksDescription'),
  };
}

export default async function AdminNetworksPage() {
  await requireAdminRole(['super_admin', 'moderator']);
  const tSidebar = await getTranslations('admin.sidebar');
  const tMod = await getTranslations('admin.moderation');

  return (
    <div className="flex flex-col w-full gap-8">
      <div>
        <h1 className="text-3xl font-bold">{tSidebar('networks')}</h1>
        <p className="text-muted-foreground mt-2 mb-0">{tMod('networksDescription')}</p>
      </div>

      <NetworksDataTable />
    </div>
  );
}
