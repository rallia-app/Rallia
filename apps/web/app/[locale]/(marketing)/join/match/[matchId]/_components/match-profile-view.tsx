'use client';

import {
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Crown,
  Hand,
  MapPin,
  Smile,
  Trophy,
  User,
  UserPlus,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { WebJoinMatchContext, WebJoinMatchParticipant } from '../_lib/match-context';
import { MatchDateTimeCard } from './match-date-time-card';
import { MatchProfileMap } from './match-profile-map';

import {
  MatchChipRow,
  type MatchChipDef,
} from '@/app/[locale]/(marketing)/games/_components/match-chip';
import { cn } from '@/lib/utils';
import { getStorageImageUrl } from '@rallia/shared-utils';

type MatchProfileViewProps = {
  match: WebJoinMatchContext;
};

function getFullName(
  profile: { first_name: string | null; last_name: string | null } | null | undefined
): string {
  if (!profile) return '';
  return [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
}

function CourtPlayer({
  participant,
  isHost,
}: {
  participant: WebJoinMatchParticipant;
  isHost: boolean;
}) {
  const avatarUrl = getStorageImageUrl(participant.player?.profile?.profile_picture_url, {
    width: 128,
    height: 128,
    quality: 70,
  });
  const fullName = getFullName(participant.player?.profile);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        <div className="flex size-14 items-center justify-center overflow-hidden rounded-full bg-card shadow-md ring-2 ring-card">
          {avatarUrl ? (
            <img src={avatarUrl} alt={fullName} className="size-full object-cover" />
          ) : (
            <User className="size-6 text-primary" />
          )}
        </div>
        {isHost && (
          <span className="absolute -bottom-0.5 -left-0.5 flex size-5 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm">
            <Crown className="size-3 fill-current" />
          </span>
        )}
      </div>
      <span className="max-w-[6.5rem] truncate rounded-full bg-card/90 px-2 py-0.5 text-center text-xs font-medium shadow-sm backdrop-blur-sm">
        {fullName || '—'}
      </span>
    </div>
  );
}

function CourtEmptySlot({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex size-14 items-center justify-center rounded-full border-2 border-dashed border-foreground/25 text-foreground/35">
        <UserPlus className="size-5" />
      </div>
      <span className="rounded-full px-2 py-0.5 text-center text-xs font-medium text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function CourtSide({
  slots,
  openLabel,
  layout,
}: {
  slots: Array<WebJoinMatchParticipant | null>;
  openLabel: string;
  layout: 'singles' | 'doubles';
}) {
  return (
    <div
      className={cn(
        'flex flex-1 items-center justify-center py-2',
        layout === 'doubles' ? 'flex-col gap-4' : 'flex-row px-2'
      )}
    >
      {slots.map((p, i) =>
        p ? (
          <CourtPlayer key={p.id} participant={p} isHost={p.is_host} />
        ) : (
          <CourtEmptySlot key={`empty-${i}`} label={openLabel} />
        )
      )}
    </div>
  );
}

export function MatchProfileView({ match }: MatchProfileViewProps) {
  const tDetail = useTranslations('matchDetail');
  const tGames = useTranslations('gamesPage');
  const tMatch = useTranslations('match');
  const tProfile = useTranslations('webJoin.profile');

  const facilityName = match.facility?.name;
  const locationTitle = facilityName || match.location_name || tDetail('locationTBD');
  const courtName = match.court?.name;
  const address = match.facility?.address || match.location_address;
  const city = match.facility?.city;
  const locationSub =
    [address, city && !address?.includes(city) ? city : null].filter(Boolean).join(', ') ||
    undefined;

  const total = match.format === 'doubles' ? 4 : 2;
  const perSide = total / 2;
  const isDoubles = match.format === 'doubles';
  const joined = match.participants?.filter(p => p.status === 'joined') ?? [];
  const joinedCount = joined.length;
  const isFull = joinedCount >= total;

  const sorted = [...joined].sort((a, b) => (b.is_host ? 1 : 0) - (a.is_host ? 1 : 0));

  // Split players across the net
  const leftSlots: Array<WebJoinMatchParticipant | null> = [];
  const rightSlots: Array<WebJoinMatchParticipant | null> = [];
  for (let i = 0; i < perSide; i++) {
    leftSlots.push(sorted[i] ?? null);
    rightSlots.push(sorted[perSide + i] ?? null);
  }

  const costLabel = match.is_court_free
    ? tDetail('free')
    : match.estimated_cost
      ? tGames('costPerPlayer', { amount: (match.estimated_cost / total).toFixed(2) })
      : null;

  const latitude = match.facility?.latitude ?? match.custom_latitude;
  const longitude = match.facility?.longitude ?? match.custom_longitude;
  const hasMap = latitude != null && longitude != null;

  const chips: MatchChipDef[] = [];

  if (match.sport?.name) {
    chips.push({
      key: 'sport',
      label: match.sport.name.charAt(0).toUpperCase() + match.sport.name.slice(1),
      tone: 'primary',
    });
  }

  chips.push({
    key: 'format',
    label: match.format === 'doubles' ? tGames('doubles') : tGames('singles'),
    tone: 'primary',
  });

  if (match.min_rating_score?.label) {
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
      label: tGames('courtBooked'),
      tone: 'secondary',
      icon: <CheckCircle2 />,
    });
  }
  if (match.player_expectation && match.player_expectation !== 'both') {
    const isCompetitive = match.player_expectation === 'competitive';
    chips.push({
      key: 'expectation',
      label: isCompetitive ? tDetail('competitive') : tDetail('casual'),
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
  if (match.preferred_opponent_gender) {
    const genderKey =
      match.preferred_opponent_gender === 'male'
        ? 'menOnly'
        : match.preferred_opponent_gender === 'female'
          ? 'womenOnly'
          : 'other';
    chips.push({
      key: 'gender',
      label: tMatch(`gender.${genderKey}`),
      tone: 'primary',
      icon: <User />,
    });
  }
  if (match.join_mode === 'request') {
    chips.push({
      key: 'joinMode',
      label: tMatch('joinMode.request'),
      tone: 'primary',
      icon: <Hand />,
    });
  }

  return (
    <article className="w-full overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* Hero */}
      <header className="relative overflow-hidden border-b px-5 py-4">
        <div className="absolute inset-0 -z-10 bg-linear-to-br from-primary/10 via-primary/5 to-transparent" />
        <MatchDateTimeCard match={match} isFull={isFull} />

        <MatchChipRow chips={chips} className="mt-3" />
      </header>

      <div className="divide-y">
        {/* Court matchup */}
        <section className="space-y-2 px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-muted-foreground" />
            {tProfile('matchup')}
            <span className="font-normal text-muted-foreground">
              {joinedCount}/{total}
            </span>
          </h2>
          <div
            className={cn(
              'relative w-full overflow-hidden rounded-xl border bg-linear-to-br from-primary/15 via-primary/5 to-primary/15',
              isDoubles ? 'aspect-[16/10] sm:aspect-[2/1]' : 'aspect-[5/2]'
            )}
          >
            {/* Court lines */}
            <div className="pointer-events-none absolute inset-4 rounded-sm border-2 border-foreground/15" />
            <div className="pointer-events-none absolute inset-x-4 top-1/2 -translate-y-px border-t border-foreground/10" />
            <div className="pointer-events-none absolute inset-y-4 left-1/2 -translate-x-px border-l-2 border-dashed border-foreground/25" />
            {/* Net VS chip */}
            <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
              <span className="rounded-full border bg-card px-2 py-0.5 text-xs font-bold tracking-wide text-foreground shadow-sm">
                {tProfile('vs')}
              </span>
            </div>
            {/* Sides */}
            <div className="relative flex h-full">
              <CourtSide
                slots={leftSlots}
                openLabel={tDetail('open')}
                layout={isDoubles ? 'doubles' : 'singles'}
              />
              <CourtSide
                slots={rightSlots}
                openLabel={tDetail('open')}
                layout={isDoubles ? 'doubles' : 'singles'}
              />
            </div>
          </div>
        </section>

        {/* Location + map */}
        <section className="space-y-2 px-5 py-3">
          <p className="flex items-center gap-2 text-sm">
            <MapPin className="size-4 shrink-0 text-primary" />
            <span className="truncate">
              <span className="font-medium text-foreground">
                {locationTitle}
                {courtName ? ` — ${courtName}` : ''}
              </span>
              {locationSub && <span className="text-muted-foreground"> · {locationSub}</span>}
            </span>
          </p>
          {hasMap && (
            <div className="overflow-hidden rounded-lg border">
              <MatchProfileMap latitude={latitude} longitude={longitude} />
            </div>
          )}
        </section>

        {/* Notes */}
        {match.notes && (
          <section className="space-y-1 px-5 py-3">
            <h2 className="text-sm font-semibold">{tDetail('notes')}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {match.notes}
            </p>
          </section>
        )}
      </div>
    </article>
  );
}
