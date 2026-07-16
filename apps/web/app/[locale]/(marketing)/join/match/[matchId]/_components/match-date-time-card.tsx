'use client';

import { ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import type { WebJoinMatchContext } from '../_lib/match-context';
import { formatCountdown, getMatchDateTimeDisplay } from '../_lib/match-date-time';

import { cn } from '@/lib/utils';
import { deriveMatchStatus, getTimeDifferenceFromNow } from '@rallia/shared-utils';

type MatchDateTimeCardProps = {
  match: WebJoinMatchContext;
  isFull: boolean;
  className?: string;
};

function DateTimeDivider() {
  return <div className="h-8 w-px shrink-0 bg-border" aria-hidden="true" />;
}

function DateTimeColumn({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span
        className={cn('mt-0.5 whitespace-nowrap text-base font-bold sm:text-lg', valueClassName)}
      >
        {value}
      </span>
    </div>
  );
}

export function MatchDateTimeCard({ match, isFull, className }: MatchDateTimeCardProps) {
  const locale = useLocale();
  const tMatches = useTranslations('matches');
  const tDetail = useTranslations('matchDetail');
  const tTime = useTranslations('common.time');

  const resolveDateLabel = (translationKey: string | null, label: string) => {
    if (translationKey === 'common.time.today') return tTime('today');
    if (translationKey === 'common.time.tomorrow') return tTime('tomorrow');
    return label;
  };

  const { dateLabel, startTimeLabel, durationLabel, isUrgent } = useMemo(
    () => getMatchDateTimeDisplay(match, locale, resolveDateLabel),
    [match, locale, tTime]
  );

  const derivedStatus = deriveMatchStatus({
    cancelled_at: null,
    match_date: match.match_date,
    start_time: match.start_time,
    end_time: match.end_time ?? match.start_time,
    timezone: match.timezone ?? 'UTC',
    result: null,
  });

  const isInProgress = derivedStatus === 'in_progress';
  const hasMatchEnded = derivedStatus === 'completed';
  const isExpired = (isInProgress || hasMatchEnded) && !isFull;
  const isOngoing = isInProgress;
  const isStartingSoon = isUrgent && !isOngoing;

  const tz = match.timezone || 'UTC';
  const [countdownMs, setCountdownMs] = useState(() =>
    Math.max(0, getTimeDifferenceFromNow(match.match_date, match.start_time, tz))
  );

  useEffect(() => {
    if (!isStartingSoon || isExpired) return;

    const tick = () => {
      setCountdownMs(Math.max(0, getTimeDifferenceFromNow(match.match_date, match.start_time, tz)));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isStartingSoon, isExpired, match.match_date, match.start_time, tz]);

  const valueColor = isExpired
    ? 'text-muted-foreground'
    : isOngoing
      ? 'text-emerald-600 dark:text-emerald-400'
      : isStartingSoon
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-foreground/80';

  const cardTone = isOngoing
    ? 'border-emerald-500/30 bg-emerald-500/5'
    : isStartingSoon
      ? 'border-amber-500/30 bg-amber-500/5'
      : isExpired
        ? 'border-border bg-muted/30'
        : 'border-primary/25 bg-primary/[0.06]';

  const countdownLabel =
    isStartingSoon && countdownMs > 0
      ? tDetail('startsIn', { time: formatCountdown(countdownMs) })
      : null;

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center gap-3 rounded-xl border px-4 py-4',
        cardTone,
        className
      )}
    >
      {isOngoing && !isExpired && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-bold text-emerald-600 dark:text-emerald-400">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          {tDetail('live')}
        </span>
      )}
      {isStartingSoon && !isExpired && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-sm font-bold text-amber-600 dark:text-amber-400">
          <ChevronRight className="size-3.5" />
          {countdownLabel ?? tDetail('startingSoon')}
        </span>
      )}

      <div className="flex w-full items-center justify-center gap-3 sm:gap-5">
        <DateTimeColumn label={tMatches('date')} value={dateLabel} valueClassName={valueColor} />
        <DateTimeDivider />
        <DateTimeColumn
          label={tDetail('startTime')}
          value={startTimeLabel}
          valueClassName={valueColor}
        />
        <DateTimeDivider />
        <DateTimeColumn
          label={tDetail('duration')}
          value={durationLabel}
          valueClassName={valueColor}
        />
      </div>
    </div>
  );
}
