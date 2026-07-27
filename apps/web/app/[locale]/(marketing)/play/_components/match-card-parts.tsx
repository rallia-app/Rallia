'use client';

import { getStorageImageUrl } from '@rallia/shared-utils';
import {
  BarChart3,
  Check,
  CheckCircle2,
  CircleDollarSign,
  List,
  Share2,
  Smile,
  Timer,
  Trophy,
  User,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { MatchChipDef } from './match-chip';
import type { ViewerMatchStatus } from './match-viewer-status';
import type { PublicMatch, PublicMatchParticipant } from './public-match-card';

import { publicMatchShareClicked } from '@/lib/analytics';
import { cn } from '@/lib/utils';

type GamesT = ReturnType<typeof useTranslations<'gamesPage'>>;
type MatchT = ReturnType<typeof useTranslations<'match'>>;

/** Roster maths shared by the list card and the map panel card. */
export function getMatchCounts(match: PublicMatch) {
  const total = match.format === 'doubles' ? 4 : 2;
  const joinedCount = match.participants?.filter(p => p.status === 'joined').length ?? 0;
  const spotsLeft = Math.max(0, total - joinedCount);
  return { total, joinedCount, spotsLeft, isFull: spotsLeft === 0 };
}

/** Rating / court / expectation / cost / format chips. */
export function buildMatchChips(match: PublicMatch, t: GamesT): MatchChipDef[] {
  const { total } = getMatchCounts(match);
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

  const costLabel = match.is_court_free
    ? t('free')
    : match.estimated_cost
      ? t('costPerPlayer', { amount: (match.estimated_cost / total).toFixed(2) })
      : null;
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

  return chips;
}

/** Avatar row: one slot per seat, dashed placeholder for open spots. */
export function PlayerSlots({
  match,
  viewerPlayerId,
  size = 'md',
}: {
  match: PublicMatch;
  viewerPlayerId?: string | null;
  size?: 'sm' | 'md';
}) {
  const { total } = getMatchCounts(match);
  const joined = match.participants?.filter(p => p.status === 'joined') ?? [];
  const sorted = [...joined].sort((a, b) => (b.is_host ? 1 : 0) - (a.is_host ? 1 : 0));

  const slots: Array<{ filled: boolean; participant?: PublicMatchParticipant }> = [];
  for (let i = 0; i < total; i++) {
    slots.push({ filled: !!sorted[i], participant: sorted[i] });
  }

  const box = size === 'sm' ? 'size-7' : 'size-9';
  const icon = size === 'sm' ? 'size-3' : 'size-4';

  return (
    <div className="flex items-center -space-x-1.5">
      {slots.map((slot, i) => {
        const avatarUrl = getStorageImageUrl(
          slot.participant?.player?.profile?.profile_picture_url,
          {
            width: 96,
            height: 96,
            quality: 70,
          }
        );
        const displayName = slot.participant?.player?.profile?.display_name;
        const isViewer = !!viewerPlayerId && slot.participant?.player_id === viewerPlayerId;

        return (
          <div key={i} className="relative" style={{ zIndex: i }}>
            <div
              className={cn(
                'flex items-center justify-center overflow-hidden rounded-full bg-card',
                box,
                slot.filled
                  ? isViewer
                    ? 'ring-2 ring-primary'
                    : 'ring-2 ring-primary/20'
                  : 'border-2 border-dashed border-muted-foreground/25'
              )}
            >
              {slot.filled ? (
                avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt={displayName || ''} className="size-full object-cover" />
                ) : (
                  <User className={cn(icon, 'text-primary')} />
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

/** Share the public match link — native share sheet, clipboard fallback. */
export function ShareButton({ matchId, className }: { matchId: string; className?: string }) {
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
      className={cn(
        'relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        className
      )}
      aria-label="Share"
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Share2 className="size-3.5" />}
      {copied && (
        <span className="absolute -bottom-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 shadow-sm dark:text-emerald-400">
          {t('copied')}
        </span>
      )}
    </button>
  );
}

export function ViewerStatusBanner({
  status,
  compact = false,
}: {
  status: ViewerMatchStatus;
  compact?: boolean;
}) {
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
        'flex items-center gap-1.5 rounded-lg font-medium',
        compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs',
        config.className
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {config.label}
    </div>
  );
}

/** Context-aware CTA: reflects the viewer's participation and the match's join mode. */
export function resolveCta(
  viewerStatus: ViewerMatchStatus | null,
  isFull: boolean,
  isRequestMode: boolean,
  tMatch: MatchT
): {
  label: string;
  variant: 'default' | 'outline' | 'secondary';
  disabled: boolean;
  className?: string;
} {
  const viewOutline = {
    label: tMatch('cta.view'),
    variant: 'outline' as const,
    disabled: false,
    className: 'border-primary/30 text-primary hover:bg-primary/5',
  };

  if (viewerStatus === 'joined' || viewerStatus === 'requested') return viewOutline;
  if (viewerStatus === 'waitlisted') {
    if (isFull) return viewOutline;
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
  if (isFull) return { label: tMatch('cta.joinWaitlist'), variant: 'outline', disabled: false };
  if (isRequestMode) return { label: tMatch('cta.askToJoin'), variant: 'default', disabled: false };
  return { label: tMatch('cta.join'), variant: 'default', disabled: false };
}
