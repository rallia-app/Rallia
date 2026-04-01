import { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Calendar, CircleDollarSign, Clock, MapPin, Swords, User, Users } from 'lucide-react';
import Image from 'next/image';
import type { Match } from '@rallia/shared-types';
import { getRelativeDateLabel, formatDuration } from '../../games/_components/utils';

const APP_STORE_URL = 'https://apps.apple.com/app/rallia/idXXXXXXXXXX';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.rallia.app';

function isMobile(userAgent: string): 'ios' | 'android' | null {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return null;
}

/** Shape returned by the Supabase query with selected relation columns */
type MatchWithRelations = Match & {
  sport: Pick<{ name: string; slug: string }, 'name' | 'slug'> | null;
  facility: Pick<{ name: string; city: string }, 'name' | 'city'> | null;
  court: Pick<{ name: string }, 'name'> | null;
  min_rating_score: Pick<{ label: string }, 'label'> | null;
  participants:
    | {
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
      }[]
    | null;
};

type Props = {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function getMatch(id: string): Promise<MatchWithRelations | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('match')
    .select(
      '*, sport:sport_id (name, slug), facility:facility_id (name, city), court:court_id (name), min_rating_score:min_rating_score_id (label), participants:match_participant (id, status, is_host, player_id, player:player_id (profile (display_name, profile_picture_url)))'
    )
    .eq('id', id)
    .single();
  return data as MatchWithRelations | null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, locale } = await params;
  const match = await getMatch(id);
  const t = await getTranslations({ locale, namespace: 'matchPage' });

  if (!match) {
    return { title: t('notFound') };
  }

  const sportName = match.sport?.name ?? '';
  const { facility } = match;
  const location = facility ? `${facility.name}, ${facility.city}` : '';
  const date = new Date(`${match.match_date}T${match.start_time}`).toLocaleDateString(locale, {
    dateStyle: 'long',
  });

  return {
    title: `${sportName} — ${date}`,
    description: `${sportName} ${t('at')} ${location} — ${date}`,
    openGraph: {
      title: `${sportName} — ${date}`,
      description: `${sportName} ${t('at')} ${location} — ${date}`,
    },
  };
}

export default async function MatchPage({ params, searchParams }: Props) {
  const { id, locale } = await params;
  const query = await searchParams;

  // When the link comes from the interest email (?src=email), redirect mobile users to app stores
  if (query.src === 'email') {
    const headersList = await headers();
    const userAgent = headersList.get('user-agent') ?? '';
    const platform = isMobile(userAgent);
    if (platform === 'ios') redirect(APP_STORE_URL);
    if (platform === 'android') redirect(PLAY_STORE_URL);
  }

  const match = await getMatch(id);
  const t = await getTranslations({ locale, namespace: 'matchPage' });
  const tGames = await getTranslations({ locale, namespace: 'gamesPage' });

  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 w-full">
        <h1 className="text-2xl font-bold">{t('notFound')}</h1>
        <p className="text-muted-foreground">{t('notFoundDescription')}</p>
      </div>
    );
  }

  // ---------- Derived values (mirrors PublicMatchCard logic) ----------
  const dateLabel = getRelativeDateLabel(
    match.match_date,
    locale,
    tGames('today'),
    tGames('tomorrow')
  );
  const dateTime = new Date(`${match.match_date}T${match.start_time}`);
  const time = dateTime.toLocaleTimeString(locale, { timeStyle: 'short' });
  const duration = match.end_time ? formatDuration(match.start_time, match.end_time) : null;

  const facilityName = match.facility?.name;
  const location = facilityName || match.location_name || tGames('locationTBD');
  const city = match.facility?.city;
  const courtName = match.court?.name;

  const total = match.format === 'doubles' ? 4 : 2;
  const joined = match.participants?.filter(p => p.status === 'joined') ?? [];
  const joinedCount = joined.length;
  const spotsLeft = Math.max(0, total - joinedCount);
  const isFull = spotsLeft === 0;

  const costLabel = match.is_court_free
    ? tGames('free')
    : match.estimated_cost
      ? tGames('costPerPlayer', { amount: Math.ceil(match.estimated_cost / total) })
      : null;

  const badges: Array<{
    key: string;
    label: string;
    variant: 'default' | 'secondary' | 'outline';
  }> = [];
  if (match.format) {
    badges.push({
      key: 'format',
      label: match.format === 'doubles' ? tGames('doubles') : tGames('singles'),
      variant: 'outline',
    });
  }
  if (match.player_expectation && match.player_expectation !== 'both') {
    badges.push({
      key: 'expectation',
      label: match.player_expectation === 'competitive' ? tGames('competitive') : tGames('casual'),
      variant: 'outline',
    });
  }
  if (match.court_status === 'reserved') {
    badges.push({ key: 'court', label: tGames('courtBooked'), variant: 'secondary' });
  }
  if (match.min_rating_score) {
    badges.push({ key: 'rating', label: match.min_rating_score.label, variant: 'secondary' });
  }
  if (costLabel) {
    badges.push({ key: 'cost', label: costLabel, variant: 'outline' });
  }

  // Player slots
  const sorted = [...joined].sort((a, b) => (b.is_host ? 1 : 0) - (a.is_host ? 1 : 0));
  const slots: Array<{ filled: boolean; participant?: (typeof sorted)[number] }> = [];
  for (let i = 0; i < total; i++) {
    slots.push({ filled: !!sorted[i], participant: sorted[i] });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 items-stretch gap-8 py-12 w-full max-w-3xl mx-auto">
      {/* Match card — mirrors PublicMatchCard visual design */}
      <div className="relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-lg">
        {/* Accent strip */}
        <div className="h-1 w-full bg-gradient-to-r from-primary to-primary/60" />

        <div className="flex flex-col gap-4 p-5">
          {/* Header: Sport + Spots */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {match.sport && (
                <Badge variant="default" className="capitalize text-xs font-semibold">
                  {match.sport.name}
                </Badge>
              )}
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
              {isFull ? tGames('matchFull') : tGames('spotsLeft', { count: spotsLeft })}
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
            </div>
          </div>

          {/* Players */}
          <div className="flex items-center justify-between">
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
                          <img
                            src={avatarUrl}
                            alt={displayName || ''}
                            className="size-full object-cover"
                          />
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

          {/* Notes */}
          {match.notes && (
            <p className="text-sm text-muted-foreground border-t pt-4">{match.notes}</p>
          )}
        </div>
      </div>

      {/* Download CTA */}
      <section className="cta-gradient p-6 rounded-2xl shadow-luma animate-fade-in flex h-full">
        <div className="flex flex-col items-center justify-center gap-5 text-center flex-1">
          <h2 className="text-xl font-bold">{t('downloadTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('downloadDescription')}</p>
          <div className="flex gap-4">
            <a href="https://apps.apple.com" target="_blank" rel="noopener noreferrer">
              <Image
                src="/app-store-badge.svg"
                alt={t('appStore')}
                width={120}
                height={40}
                className="button-scale"
              />
            </a>
            <a href="https://play.google.com" target="_blank" rel="noopener noreferrer">
              <Image
                src="/google-play-badge.svg"
                alt={t('googlePlay')}
                width={135}
                height={40}
                className="button-scale"
              />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
