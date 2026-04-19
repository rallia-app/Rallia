import { AdminReferralContestsHeader } from '@/components/admin-referral-contests-header';
import { ReferralContestsDataTable } from '@/components/referral-contests-data-table';
import { canPerformAction } from '@/lib/admin-rbac';
import { getAdminRole } from '@/lib/supabase/check-admin';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import type { AdminRole } from '@rallia/shared-hooks';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.referralContests');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminReferralContestsPage() {
  const t = await getTranslations('admin.referralContests');
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const adminRole = user ? ((await getAdminRole(user.id)) as AdminRole) : null;
  const canCreate = adminRole ? canPerformAction(adminRole, 'referral-contests:create') : false;

  const adminDb = createServiceRoleClient();
  const { data: contests, error } = await adminDb
    .from('referral_contest')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="flex flex-col w-full gap-4 h-full">
      <AdminReferralContestsHeader
        title={t('title')}
        description={t('description')}
        createButtonLabel={t('createButton')}
        canCreate={canCreate}
      />

      {error ? (
        <p className="text-destructive">{t('table.error')}</p>
      ) : (
        <ReferralContestsDataTable contests={contests ?? []} />
      )}
    </div>
  );
}
