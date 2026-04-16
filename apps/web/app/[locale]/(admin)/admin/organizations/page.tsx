import { AdminOrganizationsHeader } from '@/components/admin-organizations-header';
import {
  OrganizationsDataTable,
  OrganizationsFilters,
} from '@/components/organizations-data-table';
import { canPerformAction } from '@/lib/admin-rbac';
import { buildTableQuery } from '@/lib/supabase-table-query';
import { getAdminRole } from '@/lib/supabase/check-admin';
import { createClient } from '@/lib/supabase/server';
import { parseTableParams } from '@/lib/table-params';
import type { AdminRole } from '@rallia/shared-hooks';
import { Tables } from '@/types';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

type Organization = Tables<'organization'>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.organizations');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('admin.organizations');
  const supabase = await createClient();
  const params = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const adminRole = user ? ((await getAdminRole(user.id)) as AdminRole) : null;
  const canCreate = adminRole ? canPerformAction(adminRole, 'organizations:create') : false;

  const tableParams = parseTableParams(params);

  let result;
  let fetchError: string | null = null;

  try {
    const query = supabase.from('organization').select(
      `
      id,
      name,
      email,
      phone,
      website,
      nature,
      slug,
      is_active,
      created_at,
      owner_id
    `,
      { count: 'exact' }
    );

    result = await buildTableQuery<Organization>(query, tableParams, {
      allowedSortFields: ['name', 'email', 'created_at', 'is_active', 'nature'],
      allowedFilterFields: ['name_like', 'nature', 'is_active'],
    });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    fetchError = t('table.error');
  }

  return (
    <div className="flex flex-col w-full gap-4 h-full">
      <AdminOrganizationsHeader
        title={t('title')}
        description={t('description')}
        createButtonLabel={t('createButton')}
        canCreate={canCreate}
      />

      <div className="flex flex-col gap-3">
        <OrganizationsFilters />

        {fetchError ? (
          <div className="grow overflow-hidden">
            <p className="text-destructive m-0">{fetchError}</p>
          </div>
        ) : result ? (
          <OrganizationsDataTable
            organizations={result.data}
            currentPage={result.page}
            totalPages={result.totalPages}
            totalItems={result.total}
            pageSize={result.pageSize}
            sortBy={tableParams.sortBy ?? undefined}
            sortOrder={tableParams.sortOrder ?? undefined}
          />
        ) : null}
      </div>
    </div>
  );
}
