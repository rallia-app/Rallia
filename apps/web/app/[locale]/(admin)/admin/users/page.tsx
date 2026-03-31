import { AdminsDataTable, type TransformedAdmin } from '@/components/admins-data-table';
import {
  PlayersDataTable,
  PlayersFilters,
  type TransformedPlayer,
} from '@/components/players-data-table';
import { UrlTabs } from '@/components/url-tabs';
import { Card, CardContent } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { UserInvitationButton } from '@/components/user-invitation-button';
import { buildTableQuery } from '@/lib/supabase-table-query';
import { parseTableParams } from '@/lib/table-params';
import { createClient } from '@/lib/supabase/server';
import { Users } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { isSuperAdmin } from '@/lib/supabase/check-admin';
import { redirect } from 'next/navigation';

interface AdminWithProfile {
  id: string;
  role: 'super_admin' | 'moderator' | 'support';
  assigned_at: string;
  notes: string | null;
  profile: {
    first_name: string;
    last_name: string | null;
    display_name: string | null;
    is_active: boolean;
    created_at: string;
  } | null;
}

interface PlayerWithProfile {
  id: string;
  gender: string | null;
  playing_hand: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  reputation_score: number;
  last_seen_at: string | null;
  created_at: string;
  profile: {
    first_name: string;
    last_name: string | null;
    display_name: string | null;
    email: string;
    phone: string | null;
    is_active: boolean;
    account_status: string | null;
    onboarding_completed: boolean | null;
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.users');
  return {
    title: t('titleMeta'),
    description: t('descriptionMeta'),
  };
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('admin.users');
  const supabase = await createClient();
  const params = await searchParams;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/admin/sign-in');
  }

  const userIsSuperAdmin = await isSuperAdmin(user.id);

  const activeTab = (params.tab as string) || 'admins';
  const tableParams = parseTableParams(params);
  tableParams.pageSize = 12;

  // --- Admins data ---
  let adminsResult: {
    data: TransformedAdmin[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } | null = null;
  let adminsError: string | null = null;

  if (activeTab === 'admins') {
    if (!tableParams.sortBy) {
      tableParams.sortBy = 'assigned_at';
      tableParams.sortOrder = 'desc';
    }

    try {
      const query = supabase.from('admin').select(
        `
          id,
          role,
          assigned_at,
          notes,
          profile (
            first_name,
            last_name,
            display_name,
            is_active,
            created_at
          )
        `,
        { count: 'exact' }
      );

      const result = await buildTableQuery<AdminWithProfile>(query, tableParams, {
        allowedSortFields: ['role', 'assigned_at'],
        allowedFilterFields: ['role'],
      });

      adminsResult = {
        ...result,
        data: result.data.map(admin => ({
          id: admin.id,
          role: admin.role,
          assigned_at: admin.assigned_at,
          first_name: admin.profile?.first_name || null,
          last_name: admin.profile?.last_name || null,
          display_name: admin.profile?.display_name || null,
          is_active: admin.profile?.is_active ?? true,
          created_at: admin.profile?.created_at || admin.assigned_at,
          email: '',
        })),
      };
    } catch (error) {
      console.error('Error fetching admins:', error);
      adminsError = t('table.error');
    }
  }

  // --- Players data ---
  let playersResult: {
    data: TransformedPlayer[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } | null = null;
  let playersError: string | null = null;

  if (activeTab === 'players') {
    if (!tableParams.sortBy) {
      tableParams.sortBy = 'created_at';
      tableParams.sortOrder = 'desc';
    }

    try {
      const query = supabase.from('player').select(
        `
          id,
          gender,
          playing_hand,
          city,
          province,
          country,
          reputation_score,
          last_seen_at,
          created_at,
          profile!inner (
            first_name,
            last_name,
            display_name,
            email,
            phone,
            is_active,
            account_status,
            onboarding_completed
          )
        `,
        { count: 'exact' }
      );

      // Apply joined-field filters manually (buildTableQuery can't filter on joined tables)
      const nameFilter = tableParams.filters?.name_like;
      if (nameFilter) {
        query.or(`first_name.ilike.%${nameFilter}%,last_name.ilike.%${nameFilter}%`, {
          referencedTable: 'profile',
        });
        // Remove from tableParams so buildTableQuery doesn't try to apply it
        delete tableParams.filters.name_like;
      }

      const statusFilter = tableParams.filters?.account_status;
      if (statusFilter) {
        query.eq(
          'profile.account_status',
          statusFilter as 'active' | 'suspended' | 'deleted' | 'pending_verification'
        );
        delete tableParams.filters.account_status;
      }

      const result = await buildTableQuery<PlayerWithProfile>(query, tableParams, {
        allowedSortFields: ['reputation_score', 'last_seen_at', 'created_at'],
        allowedFilterFields: ['gender'],
      });

      playersResult = {
        ...result,
        data: result.data.map(player => ({
          id: player.id,
          first_name: player.profile?.first_name || null,
          last_name: player.profile?.last_name || null,
          display_name: player.profile?.display_name || null,
          email: player.profile?.email || '',
          phone: player.profile?.phone || null,
          gender: player.gender,
          playing_hand: player.playing_hand,
          city: player.city,
          province: player.province,
          country: player.country,
          reputation_score: player.reputation_score,
          is_active: player.profile?.is_active ?? true,
          account_status: player.profile?.account_status || null,
          onboarding_completed: player.profile?.onboarding_completed || null,
          last_seen_at: player.last_seen_at,
          created_at: player.created_at,
        })),
      };
    } catch (error) {
      console.error('Error fetching players:', error);
      playersError = t('players.table.error');
    }
  }

  const tabs = [
    { value: 'admins', label: t('tabs.admins') },
    { value: 'players', label: t('tabs.players') },
    { value: 'organizationMembers', label: t('tabs.organizationMembers') },
  ];

  return (
    <div className="flex flex-col w-full gap-8 h-full">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground mt-2 mb-0">{t('description')}</p>
        </div>
        {userIsSuperAdmin && <UserInvitationButton />}
      </div>

      <UrlTabs tabs={tabs} activeTab={activeTab}>
        <TabsContent value="admins" className="mt-6">
          {adminsError ? (
            <Card className="overflow-hidden">
              <CardContent className="pt-6">
                <p className="text-destructive m-0">{adminsError}</p>
              </CardContent>
            </Card>
          ) : adminsResult ? (
            <AdminsDataTable
              admins={adminsResult.data}
              currentPage={adminsResult.page}
              totalPages={adminsResult.totalPages}
              totalItems={adminsResult.total}
              pageSize={adminsResult.pageSize}
              sortBy={tableParams.sortBy ?? undefined}
              sortOrder={tableParams.sortOrder ?? undefined}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="organizationMembers" className="mt-6">
          <Card className="overflow-hidden">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground m-0">{t('tabs.comingSoon')}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="players" className="mt-6">
          <div className="flex flex-col gap-3">
            <PlayersFilters />
            {playersError ? (
              <Card className="overflow-hidden">
                <CardContent className="pt-6">
                  <p className="text-destructive m-0">{playersError}</p>
                </CardContent>
              </Card>
            ) : playersResult ? (
              <PlayersDataTable
                players={playersResult.data}
                currentPage={playersResult.page}
                totalPages={playersResult.totalPages}
                totalItems={playersResult.total}
                pageSize={playersResult.pageSize}
                sortBy={tableParams.sortBy ?? undefined}
                sortOrder={tableParams.sortOrder ?? undefined}
              />
            ) : null}
          </div>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
