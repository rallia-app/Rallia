'use client';

import { Clock, MapPin, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  deriveMatchStatus,
  formatIntuitiveDateInTimezone,
  formatTimeRangeInTimezone,
} from '@rallia/shared-utils';
import type { MatchWithDetails } from '@rallia/shared-types';

import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { PlayerAvatar } from '@/components/app/primitives/player-avatar';
import { cn } from '@/lib/utils';

/**
 * A game the player is in. The web counterpart to mobile's MyMatchCard.
 *
 * Dates and times go through the shared timezone-aware formatters rather than
 * toLocaleString: a game carries the *facility's* timezone, so a naive local format
 * shows the wrong hour to anyone travelling or booking across a zone.
 */
export function MyGameCard({
  match,
  participantStatus,
  pendingRequestCount = 0,
}: {
  match: MatchWithDetails;
  /** Raw match_participant_status_enum for the viewer; drives the confirmation pill. */
  participantStatus?: string | null;
  /** Join requests awaiting the host's decision. Only meaningful to the creator. */
  pendingRequestCount?: number;
}) {
  const t = useTranslations('playerMatches');
  const tGames = useTranslations('gamesPage');
  // Root translator: the shared date formatter hands back a fully-qualified key
  // ('common.time.today'), so each app localizes Today/Tomorrow itself.
  const tRoot = useTranslations();
  const locale = useLocale();

  const timezone = match.timezone || 'UTC';
  const status = deriveMatchStatus(match);

  const date = formatIntuitiveDateInTimezone(match.match_date, timezone, locale);
  const dateLabel = date.translationKey ? tRoot(date.translationKey) : date.formattedDate;

  const timeRange = formatTimeRangeInTimezone(
    match.match_date,
    match.start_time,
    match.end_time,
    timezone,
    locale
  );

  const joined = (match.participants ?? []).filter(p => p.status === 'joined');
  const capacity = match.format === 'doubles' ? 4 : 2;

  const locationName =
    match.location_type === 'tbd' ? null : (match.facility?.name ?? match.location_name ?? null);

  const isUnconfirmed =
    participantStatus === 'pending' ||
    participantStatus === 'requested' ||
    participantStatus === 'waitlisted';

  return (
    <Link
      href={`/app/games/${match.id}`}
      className="block rounded-lg border border-border p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">{dateLabel}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{timeRange}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {status === 'cancelled' && <Badge variant="destructive">{t('filters.cancelled')}</Badge>}
          {status !== 'cancelled' && isUnconfirmed && (
            <Badge variant="secondary">{t('filters.waiting')}</Badge>
          )}
          {pendingRequestCount > 0 && <Badge className="tabular-nums">{pendingRequestCount}</Badge>}
        </div>
      </div>

      {locationName && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{locationName}</span>
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex -space-x-2">
          {joined.slice(0, 4).map(participant => (
            <PlayerAvatar
              key={participant.id}
              size="sm"
              className="ring-2 ring-background"
              name={participant.player?.profile?.display_name ?? null}
              profilePictureUrl={participant.player?.profile?.profile_picture_url ?? null}
            />
          ))}
        </div>

        <span
          className={cn(
            'flex items-center gap-1.5 text-sm tabular-nums',
            joined.length >= capacity ? 'text-muted-foreground' : 'text-primary'
          )}
        >
          <Users className="size-3.5" aria-hidden="true" />
          {joined.length}/{capacity}
          {joined.length < capacity && (
            <span className="ml-1">{tGames('spotsLeft', { count: capacity - joined.length })}</span>
          )}
        </span>
      </div>
    </Link>
  );
}
