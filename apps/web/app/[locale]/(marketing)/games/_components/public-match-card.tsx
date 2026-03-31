'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Calendar,
  Check,
  CircleDollarSign,
  Clock,
  MapPin,
  Share2,
  Swords,
  User,
  Users,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { getRelativeDateLabel, formatDuration } from './utils';

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
  player_expectation: string | null;
  court_status: string | null;
  is_court_free: boolean | null;
  estimated_cost: number | null;
  location_name: string | null;
  location_address?: string | null;
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
  onJoin: (matchId: string) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PlayerSlots({ match }: { match: PublicMatch }) {
  const total = match.format === 'doubles' ? 4 : 2;
  const joined = match.participants?.filter(p => p.status === 'joined') ?? [];
  const sorted = [...joined].sort((a, b) => (b.is_host ? 1 : 0) - (a.is_host ? 1 : 0));

  const slots: Array<{ filled: boolean; participant?: PublicMatchParticipant }> = [];
  for (let i = 0; i < total; i++) {
    slots.push({ filled: !!sorted[i], participant: sorted[i] });
  }

  return (
    <div className="flex items-center -space-x-1.5">
      {slots.map((slot, i) => {
        const avatarUrl = slot.participant?.player?.profile?.profile_picture_url;
        const displayName = slot.participant?.player?.profile?.display_name;

        return (
          <div key={i} className="relative" style={{ zIndex: i }}>
            <div
              className={cn(
                'size-9 rounded-full flex items-center justify-center overflow-hidden',
                'bg-card',
                slot.filled
                  ? 'ring-2 ring-primary/20'
                  : 'border-2 border-dashed border-muted-foreground/25'
              )}
            >
              {slot.filled ? (
                avatarUrl ? (
                  <img src={avatarUrl} alt={displayName || ''} className="size-full object-cover" />
                ) : (
                  <User className="size-4 text-primary" />
                )
              ) : (
                <span className="text-sm text-muted-foreground/40">+</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ShareButton({ matchId }: { matchId: string }) {
  const t = useTranslations('gamesPage');
  const [copied, setCopied] = useState(false);

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/match/${matchId}`;

    if ('share' in navigator) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // User cancelled or not supported — fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  };

  return (
    <button
      onClick={handleShare}
      className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      aria-label="Share"
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Share2 className="size-3.5" />}
      {copied && (
        <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap bg-background border rounded px-1.5 py-0.5 shadow-sm">
          {t('copied')}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PublicMatchCard({ match, onJoin }: PublicMatchCardProps) {
  const t = useTranslations('gamesPage');
  const locale = useLocale();

  const dateLabel = getRelativeDateLabel(match.match_date, locale, t('today'), t('tomorrow'));
  const dateTime = new Date(`${match.match_date}T${match.start_time}`);
  const time = dateTime.toLocaleTimeString(locale, { timeStyle: 'short' });
  const duration = match.end_time ? formatDuration(match.start_time, match.end_time) : null;

  const facilityName = match.facility?.name;
  const location = facilityName || match.location_name || t('locationTBD');
  const city = match.facility?.city;
  const courtName = match.court?.name;

  const total = match.format === 'doubles' ? 4 : 2;
  const joinedCount = match.participants?.filter(p => p.status === 'joined').length ?? 0;
  const spotsLeft = Math.max(0, total - joinedCount);
  const isFull = spotsLeft === 0;

  const costLabel = match.is_court_free
    ? t('free')
    : match.estimated_cost
      ? t('costPerPlayer', { amount: Math.ceil(match.estimated_cost / total) })
      : null;

  const badges: Array<{
    key: string;
    label: string;
    variant: 'default' | 'secondary' | 'outline';
  }> = [];

  if (match.format) {
    badges.push({
      key: 'format',
      label: match.format === 'doubles' ? t('doubles') : t('singles'),
      variant: 'outline',
    });
  }
  if (match.player_expectation && match.player_expectation !== 'both') {
    badges.push({
      key: 'expectation',
      label: match.player_expectation === 'competitive' ? t('competitive') : t('casual'),
      variant: 'outline',
    });
  }
  if (match.court_status === 'reserved') {
    badges.push({ key: 'court', label: t('courtBooked'), variant: 'secondary' });
  }
  if (match.min_rating_score) {
    badges.push({ key: 'rating', label: match.min_rating_score.label, variant: 'secondary' });
  }
  if (costLabel) {
    badges.push({ key: 'cost', label: costLabel, variant: 'outline' });
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 h-full">
      {/* Accent strip */}
      <div className="h-1 w-full bg-gradient-to-r from-primary to-primary/60" />

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
          <PlayerSlots match={match} />
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            <span>
              {joinedCount}/{total}
            </span>
          </div>
        </div>

        {/* Badges */}
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {badges.map(badge => (
              <Badge
                key={badge.key}
                variant={badge.variant}
                className="text-xs px-2.5 py-1 font-medium"
              >
                {badge.key === 'expectation' && <Swords className="size-3.5 mr-1" />}
                {badge.key === 'cost' && <CircleDollarSign className="size-3.5 mr-1" />}
                {badge.label}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex-1" />

        {/* CTA */}
        <Button
          className="w-full font-semibold"
          size="lg"
          onClick={() => onJoin(match.id)}
          disabled={isFull}
        >
          {t('joinButton')}
        </Button>
      </div>
    </div>
  );
}
