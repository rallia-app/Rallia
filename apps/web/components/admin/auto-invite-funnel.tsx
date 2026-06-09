'use client';

import { useAutoInviteFunnel, type AutoInviteFunnelPoint } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { KpiCard } from '@/components/admin/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const DAY_OPTIONS = [7, 14, 30] as const;
type DaysWindow = (typeof DAY_OPTIONS)[number];

interface AutoInviteTotals {
  matchesCreated: number;
  invitesSent: number;
  invitesSettled: number;
  invitesInFlight: number;
  responded: number;
  accepted: number;
  declined: number;
  timeSuggested: number;
  noResponse: number;
  requestsTotal: number;
  requestsApproved: number;
  requestsRefused: number;
  requestsPending: number;
}

function aggregate(rows: AutoInviteFunnelPoint[]): AutoInviteTotals {
  return rows.reduce<AutoInviteTotals>(
    (acc, r) => {
      acc.matchesCreated += r.matchesCreated;
      acc.invitesSent += r.invitesSent;
      acc.invitesSettled += r.invitesSettled;
      acc.invitesInFlight += r.invitesInFlight;
      acc.responded += r.responded;
      acc.accepted += r.accepted;
      acc.declined += r.declined;
      acc.timeSuggested += r.timeSuggested;
      acc.noResponse += r.noResponse;
      acc.requestsTotal += r.requestsTotal;
      acc.requestsApproved += r.requestsApproved;
      acc.requestsRefused += r.requestsRefused;
      acc.requestsPending += r.requestsPending;
      return acc;
    },
    {
      matchesCreated: 0,
      invitesSent: 0,
      invitesSettled: 0,
      invitesInFlight: 0,
      responded: 0,
      accepted: 0,
      declined: 0,
      timeSuggested: 0,
      noResponse: 0,
      requestsTotal: 0,
      requestsApproved: 0,
      requestsRefused: 0,
      requestsPending: 0,
    }
  );
}

export function AutoInviteFunnel() {
  const t = useTranslations('admin.analytics');
  const [days, setDays] = useState<DaysWindow>(14);
  const { data, loading } = useAutoInviteFunnel(days);
  const totals = useMemo(() => aggregate(data), [data]);

  const responseRate =
    totals.invitesSettled > 0 ? (totals.responded / totals.invitesSettled) * 100 : null;
  const avgPerMatch = totals.matchesCreated > 0 ? totals.invitesSent / totals.matchesCreated : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t('autoInvite.title')}</CardTitle>
            <p className="text-xs text-muted-foreground m-0 mt-1">{t('autoInvite.hint')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">{t('utm.timeWindow')}</Label>
            <Select value={String(days)} onValueChange={v => setDays(Number(v) as DaysWindow)}>
              <SelectTrigger className="h-8 w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map(option => (
                  <SelectItem key={option} value={String(option)}>
                    {t(`timeRange.${option}d`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : totals.matchesCreated === 0 && totals.invitesSent === 0 ? (
          <p className="text-sm text-muted-foreground m-0">{t('matchesTab.noData')}</p>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Fan-out head: matches -> invitations (a fan-out, not a drop-off) */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <KpiCard
                label={t('autoInvite.matchesCreated')}
                value={totals.matchesCreated}
                hint={t('autoInvite.matchesCreatedHint')}
              />
              <KpiCard
                label={t('autoInvite.invitesSent')}
                value={totals.invitesSent}
                hint={
                  avgPerMatch != null
                    ? t('autoInvite.invitesSentHint', { avg: avgPerMatch.toFixed(1) })
                    : undefined
                }
              />
              <KpiCard
                label={t('autoInvite.responseRate')}
                value={responseRate != null ? `${responseRate.toFixed(0)}%` : '—'}
                hint={t('autoInvite.responseRateHint', {
                  responded: totals.responded,
                  settled: totals.invitesSettled,
                })}
              />
            </div>

            {totals.invitesInFlight > 0 && (
              <p className="text-[11px] text-muted-foreground m-0">
                {t('autoInvite.settleNote', { inFlight: totals.invitesInFlight })}
              </p>
            )}

            {/* Response funnel over the settled cohort */}
            {totals.invitesSettled === 0 ? (
              <p className="text-sm text-muted-foreground m-0">{t('autoInvite.allInFlight')}</p>
            ) : (
              <div className="space-y-3">
                <Bar
                  label={t('autoInvite.stageEligible')}
                  description={t('autoInvite.stageEligibleDesc')}
                  count={totals.invitesSettled}
                  base={totals.invitesSettled}
                  tone="primary"
                />
                <Bar
                  label={t('autoInvite.stageResponded')}
                  count={totals.responded}
                  base={totals.invitesSettled}
                  tone="primary"
                />
                {/* Category split (precedence oui > non > nouvel horaire), base = responses */}
                <div className="space-y-2 pl-3 border-l">
                  <Bar
                    label={t('autoInvite.catOui')}
                    count={totals.accepted}
                    base={totals.responded}
                    tone="emerald"
                    small
                  />
                  <Bar
                    label={t('autoInvite.catNon')}
                    count={totals.declined}
                    base={totals.responded}
                    tone="rose"
                    small
                  />
                  <Bar
                    label={t('autoInvite.catNouvelHoraire')}
                    count={totals.timeSuggested}
                    base={totals.responded}
                    tone="amber"
                    small
                  />
                </div>
                <Bar
                  label={t('autoInvite.noResponse')}
                  count={totals.noResponse}
                  base={totals.invitesSettled}
                  tone="muted"
                />
              </div>
            )}

            {/* Self-request approval flow — a separate population from invited candidates */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t('autoInvite.requestsTitle')}
              </span>
              <p className="text-[11px] text-muted-foreground m-0">
                {t('autoInvite.requestsHint')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-[11px] font-normal">
                  {t('autoInvite.requestsApproved')}: {totals.requestsApproved.toLocaleString()}
                </Badge>
                <Badge variant="outline" className="text-[11px] font-normal">
                  {t('autoInvite.requestsRefused')}: {totals.requestsRefused.toLocaleString()}
                </Badge>
                <Badge variant="outline" className="text-[11px] font-normal">
                  {t('autoInvite.requestsPending')}: {totals.requestsPending.toLocaleString()}
                </Badge>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const TONE_CLASS: Record<string, string> = {
  primary: 'bg-primary',
  emerald: 'bg-emerald-500/70',
  rose: 'bg-rose-500/70',
  amber: 'bg-amber-500/70',
  muted: 'bg-muted-foreground/40',
};

function Bar({
  label,
  description,
  count,
  base,
  tone,
  small,
}: {
  label: string;
  description?: string;
  count: number;
  base: number;
  tone: keyof typeof TONE_CLASS;
  small?: boolean;
}) {
  const pct = base > 0 ? (count / base) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs mb-0.5">
        <span className={small ? '' : 'font-medium'}>{label}</span>
        <span className="text-muted-foreground tabular-nums whitespace-nowrap">
          {count.toLocaleString()} · {pct.toFixed(0)}%
        </span>
      </div>
      {description && <p className="text-[11px] text-muted-foreground m-0 mb-1">{description}</p>}
      <div className={`${small ? 'h-2' : 'h-2.5'} rounded bg-muted overflow-hidden`}>
        <div
          className={`h-full ${TONE_CLASS[tone]}`}
          style={{ width: `${Math.max(pct, count > 0 ? 1.5 : 0)}%` }}
        />
      </div>
    </div>
  );
}
