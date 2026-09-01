import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AdminBugReportsTable, BugReportsFilters } from '@/components/admin-bug-reports-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { canPerformAction } from '@/lib/admin-rbac';
import type { AdminBugReport } from '@/lib/bug-reports';
import { requireAdminRole } from '@/lib/admin-rbac.server';
import { buildTableQuery } from '@/lib/supabase-table-query';
import { parseTableParams } from '@/lib/table-params';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.bugReports');
  return { title: `${t('title')} - Rallia`, description: t('subtitle') };
}

const STATUSES = ['new', 'reviewed', 'in_progress', 'resolved', 'closed'] as const;

type FeedbackRow = Omit<AdminBugReport, 'reporter'> & { player_id: string | null };

export default async function AdminBugReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await requireAdminRole(['super_admin', 'moderator']);
  const t = await getTranslations('admin.bugReports');
  const params = await searchParams;
  const adminDb = createServiceRoleClient();

  const tableParams = parseTableParams(params);
  if (!tableParams.sortBy) {
    tableParams.sortBy = 'created_at';
    tableParams.sortOrder = 'desc';
  }

  const query = adminDb
    .from('feedback')
    .select(
      `id, player_id, category, module, subject, message, metadata, status, admin_notes,
       app_version, device_info, screenshot_urls, upvote_count, visibility, hidden_at,
       created_at, updated_at`,
      { count: 'exact' }
    )
    .eq('category', 'bug');

  // Severity lives in the metadata JSON, and free-text search spans two columns,
  // so neither can go through buildTableQuery's column filters.
  const severity = tableParams.filters?.severity;
  if (severity) {
    query.eq('metadata->>severity', severity);
  }
  const search = tableParams.filters?.q;
  if (search) {
    // Drop the characters that delimit a PostgREST or() list, then escape the
    // LIKE wildcards so the rest of the term matches literally.
    const term = search
      .replace(/[(),"]/g, ' ')
      .replace(/[\\%_]/g, '\\$&')
      .trim();
    if (term) {
      query.or(`subject.ilike.%${term}%,message.ilike.%${term}%`);
    }
  }
  const visibility = tableParams.filters?.visibility;
  if (visibility === 'hidden') {
    query.not('hidden_at', 'is', null);
  } else if (visibility === 'public') {
    query.is('hidden_at', null);
  }

  let result: Awaited<ReturnType<typeof buildTableQuery<FeedbackRow>>> | null = null;
  let loadError: string | null = null;

  try {
    result = await buildTableQuery<FeedbackRow>(query, tableParams, {
      allowedSortFields: ['created_at', 'updated_at', 'upvote_count', 'status'],
      allowedFilterFields: ['status', 'module'],
    });
  } catch (error) {
    console.error('Error fetching bug reports:', error);
    loadError = t('loadError');
  }

  const rows = result?.data ?? [];

  // Resolve reporter names in one batch (feedback stores only player_id).
  const playerIds = Array.from(new Set(rows.map(r => r.player_id).filter((v): v is string => !!v)));
  const reporters = new Map<string, { name: string; email: string | null }>();
  if (playerIds.length > 0) {
    const { data: profiles } = await adminDb
      .from('profile')
      .select('id, first_name, last_name, display_name, email')
      .in('id', playerIds);
    for (const p of profiles ?? []) {
      reporters.set(p.id, {
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.display_name || p.id,
        email: p.email ?? null,
      });
    }
  }

  const reports: AdminBugReport[] = rows.map(({ player_id, ...row }) => ({
    ...row,
    reporter: player_id
      ? { id: player_id, ...(reporters.get(player_id) ?? { name: player_id, email: null }) }
      : null,
  }));

  // Status counts across every bug report, independent of the current filters.
  const countResults = await Promise.all(
    STATUSES.map(status =>
      adminDb
        .from('feedback')
        .select('id', { count: 'exact', head: true })
        .eq('category', 'bug')
        .eq('status', status)
    )
  );
  const counts = STATUSES.map((status, i) => ({ status, count: countResults[i].count ?? 0 }));

  return (
    <div className="flex flex-col w-full gap-6">
      <div>
        <h1 className="text-3xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {counts.map(({ status, count }) => (
          <Badge key={status} variant="outline" className="text-xs">
            {t(`status.${status}`)}: {count}
          </Badge>
        ))}
      </div>

      <BugReportsFilters />

      {loadError ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">{loadError}</CardContent>
        </Card>
      ) : (
        <AdminBugReportsTable
          reports={reports}
          currentPage={result?.page ?? 1}
          totalPages={result?.totalPages ?? 0}
          totalItems={result?.total ?? 0}
          pageSize={result?.pageSize ?? tableParams.pageSize}
          sortBy={tableParams.sortBy ?? undefined}
          sortOrder={tableParams.sortOrder}
          canTriage={canPerformAction(role, 'bug-reports:triage')}
        />
      )}
    </div>
  );
}
