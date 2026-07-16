'use client';

import { getStorageImageUrl } from '@rallia/shared-utils';
import {
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  List,
  MapPin,
  Share2,
  Smile,
  Timer,
  Trophy,
  User,
  Users,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { getRelativeDateLabel, formatDuration } from './utils';
import { MatchChipRow, type MatchChipDef } from './match-chip';
import {
  getViewerMatchStatus,
  getViewerParticipant,
  type ViewerMatchStatus,
} from './match-viewer-status';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { publicMatchShareClicked } from '@/lib/analytics';

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
// Sub-components
// ---------------------------------------------------------------------------

function PlayerSlots({
  match,
  viewerPlayerId,
}: {
  match: PublicMatch;
  viewerPlayerId?: string | null;
}) {
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
        const avatarUrl = getStorageImageUrl(
          slot.participant?.player?.profile?.profile_picture_url,
          { width: 96, height: 96, quality: 70 }
        );
        const displayName = slot.participant?.player?.profile?.display_name;
        const isViewer = !!viewerPlayerId && slot.participant?.player_id === viewerPlayerId;

        return (
          <div key={i} className="relative" style={{ zIndex: i }}>
            <div
              className={cn(
                'size-9 rounded-full flex items-center justify-center overflow-hidden',
                'bg-card',
                slot.filled
                  ? isViewer
                    ? 'ring-2 ring-primary'
                    : 'ring-2 ring-primary/20'
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
        publicMatchShareClicked({ match_id: matchId, share_channel: 'native_share' });
        return;
      } catch {
        // User cancelled or not supported — fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      publicMatchShareClicked({ match_id: matchId, share_channel: 'clipboard' });
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

function ViewerStatusBanner({ status }: { status: ViewerMatchStatus }) {
  const t = useTranslations('gamesPage');

  const config = {
    joined: {
      label: t('cardStatus.joined'),
      className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      icon: Check,
    },
    requested: {
      label: t('cardStatus.requested'),
      className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
      icon: Timer,
    },
    waitlisted: {
      label: t('cardStatus.waitlisted'),
      className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
      icon: List,
    },
    invited: {
      label: t('cardStatus.invited'),
      className: 'bg-primary/10 text-primary',
      icon: User,
    },
  }[status];

  const Icon = config.icon;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium',
        config.className
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {config.label}
    </div>
  );
}

function resolveCta(
  viewerStatus: ViewerMatchStatus | null,
  isFull: boolean,
  isRequestMode: boolean,
  tMatch: ReturnType<typeof useTranslations<'match'>>
): {
  label: string;
  variant: 'default' | 'outline' | 'secondary';
  disabled: boolean;
  className?: string;
} {
  if (viewerStatus === 'joined') {
    return {
      label: tMatch('cta.view'),
      variant: 'outline',
      disabled: false,
      className: 'border-primary/30 text-primary hover:bg-primary/5',
    };
  }
  if (viewerStatus === 'requested') {
    return {
      label: tMatch('cta.view'),
      variant: 'outline',
      disabled: false,
      className: 'border-primary/30 text-primary hover:bg-primary/5',
    };
  }
  if (viewerStatus === 'waitlisted') {
    if (isFull) {
      return {
        label: tMatch('cta.view'),
        variant: 'outline',
        disabled: false,
        className: 'border-primary/30 text-primary hover:bg-primary/5',
      };
    }
    return {
      label: isRequestMode ? tMatch('cta.askToJoin') : tMatch('cta.join'),
      variant: 'default',
      disabled: false,
    };
  }
  if (viewerStatus === 'invited') {
    return {
      label: isRequestMode ? tMatch('cta.askToJoin') : tMatch('cta.acceptInvitation'),
      variant: 'default',
      disabled: false,
    };
  }
  if (isFull) {
    return { label: tMatch('cta.joinWaitlist'), variant: 'outline', disabled: false };
  }
  if (isRequestMode) {
    return { label: tMatch('cta.askToJoin'), variant: 'default', disabled: false };
  }
  return { label: tMatch('cta.join'), variant: 'default', disabled: false };
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

  const total = match.format === 'doubles' ? 4 : 2;
  const joinedCount = match.participants?.filter(p => p.status === 'joined').length ?? 0;
  const spotsLeft = Math.max(0, total - joinedCount);
  const isFull = spotsLeft === 0;
  const isRequestMode = match.join_mode === 'request';

  const costLabel = match.is_court_free
    ? t('free')
    : match.estimated_cost
      ? t('costPerPlayer', { amount: (match.estimated_cost / total).toFixed(2) })
      : null;

  const chips: MatchChipDef[] = [];

  if (match.min_rating_score) {
    chips.push({
      key: 'rating',
      label: match.min_rating_score.label,
      tone: 'secondary',
      icon: <BarChart3 />,
    });
  }
  if (match.court_status === 'reserved') {
    chips.push({
      key: 'court',
      label: t('courtBooked'),
      tone: 'secondary',
      icon: <CheckCircle2 />,
    });
  }
  if (match.player_expectation && match.player_expectation !== 'both') {
    const isCompetitive = match.player_expectation === 'competitive';
    chips.push({
      key: 'expectation',
      label: isCompetitive ? t('competitive') : t('casual'),
      tone: 'primary',
      icon: isCompetitive ? <Trophy /> : <Smile />,
    });
  }
  if (costLabel) {
    chips.push({
      key: 'cost',
      label: costLabel,
      tone: 'primary',
      icon: match.is_court_free ? <CheckCircle2 /> : <CircleDollarSign />,
    });
  }
  if (match.format) {
    chips.push({
      key: 'format',
      label: match.format === 'doubles' ? t('doubles') : t('singles'),
      tone: 'primary',
    });
  }

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
