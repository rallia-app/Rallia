import { AdminOrganizationForm } from '@/components/admin-organization-form';
import { requireAdminRole } from '@/lib/admin-rbac.server';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.organizations.create');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminOrganizationCreatePage() {
  await requireAdminRole(['super_admin']);
  const t = await getTranslations('admin.organizations.create');

  return (
    <div className="flex flex-col w-full gap-8 h-full">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 mb-0">{t('description')}</p>
      </div>

      <AdminOrganizationForm />
    </div>
  );
}
