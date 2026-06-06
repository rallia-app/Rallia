import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { requireAdminRole } from '@/lib/admin-rbac.server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';
import type { Tables } from '@/types';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

const PAGE_SIZE = 50;

type RecipientStatus = 'sent' | 'failed' | 'bounced' | 'complained';

const RECIPIENT_STATUS_STYLES: Record<RecipientStatus, string> = {
  sent: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-900',
  failed:
    'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900',
  bounced:
    'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',
  complained:
    'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900',
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.emails');
  return { title: t('detail.titleMeta') };
}

interface AudienceMeta {
  source?: string;
  count?: number;
  filters?: {
    sportId?: string | null;
    city?: string | null;
    locale?: string | null;
    activeWithinDays?: number | null;
    onlySubscribers?: boolean;
  };
}

export default async function AdminEmailDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdminRole(['super_admin']);
  const { id, locale } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const t = await getTranslations('admin.emails');
  const db = createServiceRoleClient();

  const { data: broadcast } = await db
    .from('email_broadcast')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!broadcast) notFound();

  const b = broadcast as Tables<'email_broadcast'>;
  const audience = (b.audience ?? {}) as AudienceMeta;

  // Per-status counts (indexed by broadcast_id) + this page of recipients.
  const statusCount = async (status: RecipientStatus): Promise<number> => {
    const { count } = await db
      .from('email_broadcast_recipient')
      .select('*', { count: 'exact', head: true })
      .eq('broadcast_id', id)
      .eq('status', status);
    return count ?? 0;
  };

  const stampedCount = async (
    column: 'delivered_at' | 'opened_at' | 'clicked_at'
  ): Promise<number> => {
    const { count } = await db
      .from('email_broadcast_recipient')
      .select('*', { count: 'exact', head: true })
      .eq('broadcast_id', id)
      .not(column, 'is', null);
    return count ?? 0;
  };

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const [
    sent,
    failed,
    bounced,
    complained,
    delivered,
    opened,
    clicked,
    recipientsResult,
    sportRow,
  ] = await Promise.all([
    statusCount('sent'),
    statusCount('failed'),
    statusCount('bounced'),
    statusCount('complained'),
    stampedCount('delivered_at'),
    stampedCount('opened_at'),
    stampedCount('clicked_at'),
    db
      .from('email_broadcast_recipient')
      .select('id, email, user_id, status, sent_at, delivered_at, opened_at, clicked_at', {
        count: 'exact',
      })
      .eq('broadcast_id', id)
      .order('sent_at', { ascending: false })
      .range(from, to),
    audience.filters?.sportId
      ? db.from('sport').select('display_name').eq('id', audience.filters.sportId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const recipients = recipientsResult.data ?? [];
  const totalRecipients = recipientsResult.count ?? b.recipients_total;
  const totalPages = Math.max(1, Math.ceil(totalRecipients / PAGE_SIZE));
  const sportName = (sportRow.data as { display_name?: string } | null)?.display_name ?? null;

  // Rates are over Sent (emails Resend accepted) for a stable denominator that
  // never goes undefined even before delivered events arrive.
  const openRate = sent > 0 ? Math.round((opened / sent) * 100) : 0;
  const clickRate = sent > 0 ? Math.round((clicked / sent) * 100) : 0;

  const stats: { key: string; label: string; value: number; sub?: string }[] = [
    { key: 'recipients', label: t('detail.stat.recipients'), value: b.recipients_total },
    { key: 'sent', label: t('detail.stat.sent'), value: sent },
    { key: 'delivered', label: t('detail.stat.delivered'), value: delivered },
    { key: 'opened', label: t('detail.stat.opened'), value: opened, sub: `${openRate}%` },
    { key: 'clicked', label: t('detail.stat.clicked'), value: clicked, sub: `${clickRate}%` },
    { key: 'failed', label: t('detail.stat.failed'), value: failed },
    { key: 'bounced', label: t('detail.stat.bounced'), value: bounced },
    { key: 'complained', label: t('detail.stat.complained'), value: complained },
  ];

  // Compact, human summary of the audience filters for a segment send.
  const audienceChips: string[] = [];
  if (audience.source === 'segment' && audience.filters) {
    const f = audience.filters;
    if (sportName) audienceChips.push(sportName);
    if (f.locale) audienceChips.push(f.locale);
    if (f.city) audienceChips.push(f.city);
    if (f.activeWithinDays)
      audienceChips.push(t('detail.activeChip', { days: f.activeWithinDays }));
    if (f.onlySubscribers) audienceChips.push(t('recipients.segment.onlySubscribers'));
  }

  return (
    <div className="flex flex-col w-full gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/emails"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          <ArrowLeft className="size-4" />
          {t('detail.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">{b.subject}</h1>
          <Badge variant="secondary">{t(`status.${b.status}` as 'status.sent')}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {new Date(b.created_at).toLocaleString(locale)} ·{' '}
          {audience.source === 'segment' ? t('history.audienceSegment') : t('history.audienceList')}
          {audienceChips.length > 0 && ` · ${audienceChips.join(' · ')}`}
        </p>
      </div>

      {/* Funnel stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map(s => (
          <Card key={s.key}>
            <CardContent className="pt-6">
              <p className="text-2xl font-bold">
                {s.value}
                {s.sub && (
                  <span className="ml-1.5 text-sm font-normal text-muted-foreground">{s.sub}</span>
                )}
              </p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Content */}
      <Card>
        <CardHeader>
          <CardTitle>{t('detail.contentHeading')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="whitespace-pre-wrap text-sm">{b.body}</p>
          {b.cta_text && b.cta_url && (
            <p className="text-sm text-muted-foreground">
              {b.cta_text} → {b.cta_url}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recipients */}
      <Card>
        <CardHeader>
          <CardTitle>{t('detail.recipientsHeading')}</CardTitle>
        </CardHeader>
        <CardContent>
          {recipients.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('detail.noRecipients')}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">{t('detail.recipient.email')}</th>
                      <th className="py-2 pr-4 font-medium">{t('detail.recipient.type')}</th>
                      <th className="py-2 pr-4 font-medium">{t('detail.recipient.status')}</th>
                      <th className="py-2 pr-4 font-medium">{t('detail.recipient.engagement')}</th>
                      <th className="py-2 pr-4 font-medium">{t('detail.recipient.sentAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.map(r => {
                      const status = r.status as RecipientStatus;
                      return (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">{r.email}</td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {r.user_id
                              ? t('detail.recipient.user')
                              : t('detail.recipient.external')}
                          </td>
                          <td className="py-2 pr-4">
                            <Badge
                              variant="outline"
                              className={cn('border', RECIPIENT_STATUS_STYLES[status])}
                            >
                              {t(
                                `detail.recipientStatus.${status}` as 'detail.recipientStatus.sent'
                              )}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {r.clicked_at
                              ? t('detail.engagement.clicked')
                              : r.opened_at
                                ? t('detail.engagement.opened')
                                : r.delivered_at
                                  ? t('detail.engagement.delivered')
                                  : '—'}
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {r.sent_at ? new Date(r.sent_at).toLocaleString(locale) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 text-sm">
                  <span className="text-muted-foreground">
                    {t('detail.pagination.page', { page, total: totalPages })}
                  </span>
                  <div className="flex gap-2">
                    {page > 1 && (
                      <Link
                        href={`/admin/emails/${id}?page=${page - 1}`}
                        className="rounded-md border px-3 py-1.5 hover:bg-muted"
                      >
                        {t('detail.pagination.prev')}
                      </Link>
                    )}
                    {page < totalPages && (
                      <Link
                        href={`/admin/emails/${id}?page=${page + 1}`}
                        className="rounded-md border px-3 py-1.5 hover:bg-muted"
                      >
                        {t('detail.pagination.next')}
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
