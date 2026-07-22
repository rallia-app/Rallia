'use client';

import { useUserDemographics, type DemographicCount } from '@rallia/shared-hooks';
import { useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { KpiCard } from '@/components/admin/kpi-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const CHART_VARS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export function UsersSection() {
  const t = useTranslations('admin.analytics');
  const { data, loading } = useUserDemographics();

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground m-0">{t('noData')}</p>;
  }

  const { totals, engagement, referred } = data;
  const onboardedPct =
    totals.players > 0 ? Math.round((totals.onboarded / totals.players) * 100) : 0;

  const signupData = data.signupsByWeek.map(p => ({ week: p.week, count: p.count }));

  const playersHint = `${onboardedPct}% ${t('usersTab.onboarded')}`;

  // Tennis / pickleball rating histograms, split for readability.
  const tennisRatings = data.ratingHistogram.filter(r => r.sport === 'tennis');
  const pickleballRatings = data.ratingHistogram.filter(r => r.sport === 'pickleball');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground m-0">{t('usersTab.subtitle')}</p>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label={t('usersTab.kpiPlayers')} value={totals.players} hint={playersHint} />
        <KpiCard label={t('usersTab.kpiActiveWeek')} value={totals.activeWeek} />
        <KpiCard label={t('usersTab.kpiActiveMonth')} value={totals.activeMonth} />
        <KpiCard
          label={t('usersTab.kpiNewMonth')}
          value={totals.newMonth}
          hint={`${totals.newWeek} ${t('usersTab.thisWeek')}`}
        />
      </div>

      {/* Signups trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t('usersTab.signupsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {signupData.length === 0 ? (
            <p className="text-sm text-muted-foreground m-0">{t('noData')}</p>
          ) : (
            <div className="w-full" style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={signupData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                  <XAxis
                    dataKey="week"
                    tickFormatter={formatWeek}
                    stroke="currentColor"
                    className="text-muted-foreground text-xs"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    stroke="currentColor"
                    className="text-muted-foreground text-xs"
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip
                    labelFormatter={(l: unknown) => formatWeek(String(l))}
                    contentStyle={{
                      background: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="count"
                    name={t('usersTab.signups')}
                    fill="var(--chart-1)"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Demographics */}
      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown title={t('usersTab.ageTitle')} items={data.ageBands} format={cap} />
        <Breakdown
          title={t('usersTab.genderTitle')}
          items={data.gender}
          format={v => (t.has(`usersTab.gender.${v}`) ? t(`usersTab.gender.${v}`) : cap(v))}
        />
        <Breakdown title={t('usersTab.localeTitle')} items={data.locale} format={formatLocale} />
        <Breakdown title={t('usersTab.geographyTitle')} items={data.geography} format={cap} />
      </div>

      {/* Sport & skill */}
      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown title={t('usersTab.sportTitle')} items={data.sports} format={cap} />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('usersTab.skillTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <SkillRow
              label="Tennis"
              rows={data.skillLevels.filter(s => s.sport === 'tennis')}
              t={t}
            />
            <SkillRow
              label="Pickleball"
              rows={data.skillLevels.filter(s => s.sport === 'pickleball')}
              t={t}
            />
          </CardContent>
        </Card>
      </div>

      {/* Rating histograms */}
      {(tennisRatings.length > 0 || pickleballRatings.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <RatingHistogram
            title={t('usersTab.ratingTennis')}
            rows={tennisRatings}
            noData={t('noData')}
          />
          <RatingHistogram
            title={t('usersTab.ratingPickleball')}
            rows={pickleballRatings}
            noData={t('noData')}
          />
        </div>
      )}

      {/* Play preferences */}
      <div className="grid gap-4 md:grid-cols-3">
        <Breakdown title={t('usersTab.matchTypeTitle')} items={data.matchType} format={cap} />
        <Breakdown
          title={t('usersTab.durationTitle')}
          items={data.matchDuration}
          format={formatDuration}
        />
        <Breakdown title={t('usersTab.handTitle')} items={data.playingHand} format={cap} />
      </div>

      {/* Engagement & games played */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('usersTab.gamesTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground m-0 mb-3">{t('usersTab.gamesSubtitle')}</p>
            <BarList items={data.gamesPlayed} format={v => v} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('usersTab.engagementTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <MiniStat label={t('usersTab.engCheckedIn')} value={engagement.everCheckedIn} />
            <MiniStat label={t('usersTab.engStreaks')} value={engagement.activeStreaks} />
            <MiniStat label={t('usersTab.engAvailability')} value={engagement.haveAvailability} />
            <MiniStat label={t('usersTab.engFavFacility')} value={engagement.haveFavFacility} />
            <MiniStat label={t('usersTab.engAutoInvite')} value={engagement.autoInviteOn} />
            <MiniStat label={t('usersTab.engMaxStreak')} value={engagement.maxStreak} />
          </CardContent>
        </Card>
      </div>

      {/* Acquisition */}
      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown title={t('usersTab.acquisitionTitle')} items={data.acquisition} format={cap} />
        <Breakdown
          title={t('usersTab.referredTitle')}
          items={[
            { label: t('usersTab.referred'), count: referred.referred },
            { label: t('usersTab.notReferred'), count: referred.notReferred },
          ]}
          format={v => v}
        />
      </div>

      {data.topCities.length > 0 && (
        <Breakdown title={t('usersTab.cityTitle')} items={data.topCities} format={v => v} />
      )}
    </div>
  );
}

// ── presentational helpers ──────────────────────────────────────────────────

function Breakdown({
  title,
  items,
  format,
}: {
  title: string;
  items: DemographicCount[];
  format: (label: string) => string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <BarList items={items} format={format} />
      </CardContent>
    </Card>
  );
}

function BarList({
  items,
  format,
}: {
  items: DemographicCount[];
  format: (label: string) => string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground m-0">—</p>;
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  const max = Math.max(...items.map(i => i.count), 1);
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, idx) => {
        const pct = Math.round((item.count / total) * 100);
        return (
          <div key={`${item.label}-${idx}`} className="flex items-center gap-3">
            <span className="text-xs w-28 shrink-0 truncate" title={format(item.label)}>
              {format(item.label)}
            </span>
            <div className="flex-1 h-4 rounded bg-muted overflow-hidden">
              <div
                className="h-full rounded"
                style={{
                  width: `${Math.max((item.count / max) * 100, 2)}%`,
                  background: CHART_VARS[idx % CHART_VARS.length],
                }}
              />
            </div>
            <span className="text-xs tabular-nums w-14 text-right shrink-0">
              {item.count} <span className="text-muted-foreground">({pct}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SkillRow({
  label,
  rows,
  t,
}: {
  label: string;
  rows: { skill: string; count: number }[];
  t: ReturnType<typeof useTranslations>;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium m-0 mb-2">{label}</p>
      <BarList
        items={rows.map(r => ({ label: r.skill, count: r.count }))}
        format={v => (t.has(`usersTab.skill.${v}`) ? t(`usersTab.skill.${v}`) : cap(v))}
      />
    </div>
  );
}

function RatingHistogram({
  title,
  rows,
  noData,
}: {
  title: string;
  rows: { label: string; value: number; count: number }[];
  noData: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground m-0">{noData}</p>
        ) : (
          <div className="w-full" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows.map(r => ({
                  label: r.label.replace(/^(NTRP|DUPR)\s/, ''),
                  count: r.count,
                }))}
                margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="currentColor"
                  className="text-muted-foreground text-xs"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  stroke="currentColor"
                  className="text-muted-foreground text-xs"
                  tickLine={false}
                  axisLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="var(--chart-2)"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xl font-bold m-0">{value}</p>
      <p className="text-xs text-muted-foreground m-0 mt-0.5">{label}</p>
    </div>
  );
}

// ── label formatting ────────────────────────────────────────────────────────

function cap(v: string): string {
  if (!v) return '';
  return v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatLocale(v: string): string {
  if (v === 'en-US') return 'English';
  if (v === 'fr-CA') return 'Français';
  return cap(v);
}

function formatDuration(v: string): string {
  return /^\d+$/.test(v) ? `${v} min` : cap(v);
}

function formatWeek(iso: string): string {
  // iso is "YYYY-MM-DD" (Monday of the ISO week)
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
