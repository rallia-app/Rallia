'use client';

import { Calendar, Clock, MapPin, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import {
  buildMatchChips,
  getMatchCounts,
  PlayerSlots,
  resolveCta,
  ShareButton,
  ViewerStatusBanner,
} from './match-card-parts';
import { MatchChipRow } from './match-chip';
import { getViewerMatchStatus, getViewerParticipant } from './match-viewer-status';
import { getRelativeDateLabel, formatDuration } from './utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublicMatchParticipant {
  id: string;
  status: string;
  is_host: boolean;
  player_id: string;
  player: {
    profile: {
      display_name: string | null;
      profile_picture_url: string | null;
    } | null;
  } | null;
}

export interface PublicMatch {
  id: string;
  match_date: string;
  start_time: string;
  end_time: string;
  format: string;
  join_mode: 'direct' | 'request' | null;
  player_expectation: string | null;
  court_status: string | null;
  is_court_free: boolean | null;
  estimated_cost: number | null;
  location_name: string | null;
  location_address?: string | null;
  custom_latitude?: number | null;
  custom_longitude?: number | null;
  notes?: string | null;
  sport: { name: string; slug: string } | null;
  facility: {
    name: string;
    city: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
  court: { name: string } | null;
  participants: PublicMatchParticipant[] | null;
  min_rating_score: { label: string } | null;
  distance?: number | null;
}

interface PublicMatchCardProps {
  match: PublicMatch;
  viewerPlayerId?: string | null;
  onJoin: (matchId: string) => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PublicMatchCard({ match, viewerPlayerId, onJoin }: PublicMatchCardProps) {
  const t = useTranslations('gamesPage');
  const tMatch = useTranslations('match');
  const locale = useLocale();

  const viewerParticipant = getViewerParticipant(match.participants, viewerPlayerId);
  const viewerStatus = getViewerMatchStatus(viewerParticipant);

  const dateLabel = getRelativeDateLabel(match.match_date, locale, t('today'), t('tomorrow'));
  const dateTime = new Date(`${match.match_date}T${match.start_time}`);
  const time = dateTime.toLocaleTimeString(locale, { timeStyle: 'short' });
  const duration = match.end_time ? formatDuration(match.start_time, match.end_time) : null;

  const facilityName = match.facility?.name;
  const location = facilityName || match.location_name || t('locationTBD');
  const city = match.facility?.city;
  const courtName = match.court?.name;

  const { total, joinedCount, spotsLeft, isFull } = getMatchCounts(match);
  const isRequestMode = match.join_mode === 'request';

  const chips = buildMatchChips(match, t);
  const cta = resolveCta(viewerStatus, isFull, isRequestMode, tMatch);

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 h-full',
        viewerStatus === 'joined' && 'border-primary/40 ring-1 ring-primary/20'
      )}
    >
      {/* Accent strip */}
      <div className="h-1 w-full bg-linear-to-r from-primary to-primary/60" />

      <div className="flex flex-col gap-4 p-5 flex-1">
        {/* Header: Sport + Share + Spots */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {match.sport && (
              <Badge variant="default" className="capitalize text-xs font-semibold">
                {match.sport.name}
              </Badge>
            )}
            <ShareButton matchId={match.id} />
          </div>
          <span
            className={cn(
              'text-xs font-semibold px-2 py-0.5 rounded-full',
              isFull
                ? 'bg-destructive/10 text-destructive'
                : spotsLeft === 1
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            )}
          >
            {isFull ? t('matchFull') : t('spotsLeft', { count: spotsLeft })}
          </span>
        </div>

        {viewerStatus && <ViewerStatusBanner status={viewerStatus} />}

        {/* Date & Time row */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Calendar className="size-4 text-primary" />
            <span>{dateLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-3.5" />
            <span>
              {time}
              {duration && <span className="text-muted-foreground/60"> · {duration}</span>}
            </span>
          </div>
        </div>

        {/* Location */}
        <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="font-medium text-foreground truncate block">{location}</span>
            {(city || courtName) && (
              <span className="text-xs truncate block">
                {[courtName, city].filter(Boolean).join(' · ')}
              </span>
            )}
            {match.distance != null && (
              <span className="text-xs">
                {t('kmAway', { distance: Math.round(match.distance) })}
              </span>
            )}
          </div>
        </div>

        {/* Players */}
        <div className="flex items-center justify-between">
          <PlayerSlots match={match} viewerPlayerId={viewerPlayerId} />
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            <span>
              {joinedCount}/{total}
            </span>
          </div>
        </div>

        {/* Chips */}
        <MatchChipRow chips={chips} />

        <div className="flex-1" />

        {/* CTA */}
        <Button
          className={cn('w-full font-semibold', cta.className)}
          size="lg"
          onClick={() => onJoin(match.id)}
          variant={cta.variant}
          disabled={cta.disabled}
        >
          {cta.label}
        </Button>
      </div>
    </div>
  );
}
