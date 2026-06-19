'use client';

import { CalendarPlus, Navigation } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { WebJoinMatchContext } from '../_lib/match-context';
import { getMatchCalendarUrl, getMatchDirectionsUrl } from '../_lib/match-action-links';

import { cn } from '@/lib/utils';

type MatchActionLinksProps = {
  match: WebJoinMatchContext;
  className?: string;
};

export function MatchActionLinks({ match, className }: MatchActionLinksProps) {
  const tProfile = useTranslations('webJoin.profile');
  const calendarUrl = getMatchCalendarUrl(match);
  const directionsUrl = getMatchDirectionsUrl(match);

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      <a
        href={calendarUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
      >
        <CalendarPlus className="size-3.5" />
        {tProfile('addToCalendar')}
      </a>
      {directionsUrl && (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Navigation className="size-3.5" />
          {tProfile('openDirections')}
        </a>
      )}
    </div>
  );
}
