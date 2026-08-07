import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BadgeCheck, CalendarDays, Flame, MapPin, Timer, Trophy, User } from 'lucide-react';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { primary as dsPrimary, accent as dsAccent } from '@rallia/design-system';

import { getPlayer } from './_lib/get-player';

import { PLAY_STORE_URL } from '@/lib/store-urls';
import { TrackedStoreBadges } from '@/components/tracked-store-badges';

// Always render fresh: profile data and privacy toggles must take effect
// immediately (the OG image keeps its own 1h revalidate).
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ playerId: string; locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { playerId, locale } = await params;
  const player = await getPlayer(playerId);
  const t = await getTranslations({ locale, namespace: 'playerPage' });

  if (!player) {
    return { title: t('notFound'), robots: { index: false, follow: false } };
  }

  const title = t('ogTitle', { name: player.name });

  const descParts: string[] = [];
  const primaryRating = player.ratings[0];
  if (primaryRating) {
    descParts.push(`${capitalize(primaryRating.sportName)} · ${primaryRating.label}`);
  }
  if (player.city) descParts.push(`📍 ${player.city}`);
  if (player.showStats && player.stats.gamesPlayed > 0) {
    descParts.push(t('ogGamesPlayed', { count: player.stats.gamesPlayed }));
  }
  descParts.push(t('ogCta'));
  const description = descParts.join(' · ');

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: 'profile' },
    twitter: { card: 'summary_large_image', title, description },
    // apple-itunes-app meta is rendered by SmartAppBanner in the marketing layout.
  };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Reputation tier → gauge color (gold uses the design-system accent token)
const TIER_COLORS: Record<string, string> = {
  platinum: '#e2e8f0',
  gold: dsAccent[400],
  silver: '#cbd5e1',
  bronze: '#d9913e',
};

export default async function PlayerPage({ params }: Props) {
  const { playerId, locale } = await params;
  const player = await getPlayer(playerId);
  const t = await getTranslations({ locale, namespace: 'playerPage' });

  if (!player) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 w-full">
        <h1 className="text-2xl font-bold">{t('notFound')}</h1>
        <p className="text-muted-foreground">{t('notFoundDescription')}</p>
      </div>
    );
  }

  const avatarUrl = getProfilePictureUrl(player.avatarUrl);
  const joinedLabel = player.joinedAt
    ? new Date(player.joinedAt).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
    : null;

  const stats: Array<{ key: string; icon: React.ReactNode; value: number; label: string }> = [
    {
      key: 'games',
      icon: <Trophy className="size-4 text-primary" />,
      value: player.stats.gamesPlayed,
      label: t('statGamesPlayed'),
    },
    {
      key: 'hours',
      icon: <Timer className="size-4 text-primary" />,
      value: player.stats.hoursPlayed,
      label: t('statHoursPlayed'),
    },
    {
      key: 'streak',
      icon: <Flame className="size-4 text-primary" />,
      value: player.stats.weekStreak,
      label: t('statWeekStreak'),
    },
  ];

  return (
    <div className="flex flex-col gap-8 py-12 w-full max-w-3xl mx-auto">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 items-stretch gap-8">
        {/* Player card */}
        <div className="relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-lg">
          {/* Banner + overlapping avatar, echoing the OG card */}
          <div className="h-24 w-full bg-gradient-to-br from-teal-900 via-teal-700 to-teal-500 relative">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-teal-300 via-amber-400 to-[#ed6a6d]" />
          </div>
          <div className="px-6 -mt-12 flex items-end justify-between relative z-10">
            <div className="rounded-full p-[3px] bg-gradient-to-br from-teal-300 via-amber-400 to-[#ed6a6d] shadow-md">
              <div className="size-24 rounded-full flex items-center justify-center overflow-hidden bg-card border-4 border-card">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt={player.name} className="size-full object-cover" />
                ) : (
                  <User className="size-10 text-primary" />
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 p-6 pt-4">
            {/* Identity */}
            <div className="min-w-0">
              <h2 className="text-2xl font-bold tracking-tight truncate">{player.name}</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground mt-1">
                {player.city && (
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3.5 text-primary" />
                    {player.city}
                  </span>
                )}
                {joinedLabel && (
                  <span className="flex items-center gap-1">
                    <CalendarDays className="size-3.5" />
                    {t('joined', { date: joinedLabel })}
                  </span>
                )}
              </div>
            </div>

            {/* Rating plaques + reputation gauge */}
            {(player.ratings.length > 0 || player.reputation) && (
              <div className="grid grid-cols-2 gap-3">
                {player.ratings.map(rating => (
                  <div
                    key={rating.sportName}
                    className="rounded-xl border bg-muted/40 px-4 py-3 border-l-4"
                    style={{
                      borderLeftColor:
                        rating.sportName.toLowerCase() === 'pickleball'
                          ? dsPrimary[300]
                          : dsAccent[400],
                    }}
                  >
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {capitalize(rating.sportName)}
                    </span>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-xl font-extrabold leading-none tracking-tight">
                        {rating.label}
                      </span>
                      {rating.isCertified && <BadgeCheck className="size-4 text-primary" />}
                    </div>
                  </div>
                ))}
                {player.reputation && (
                  <div className="rounded-xl border bg-muted/40 px-4 py-3 flex items-center gap-3">
                    <div className="relative size-16 shrink-0">
                      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
                        <circle
                          cx="32"
                          cy="32"
                          r="27"
                          fill="none"
                          strokeWidth="6"
                          className="stroke-muted-foreground/20"
                        />
                        <circle
                          cx="32"
                          cy="32"
                          r="27"
                          fill="none"
                          strokeWidth="6"
                          strokeLinecap="round"
                          stroke={TIER_COLORS[player.reputation.tier] ?? dsPrimary[300]}
                          strokeDasharray={`${(2 * Math.PI * 27 * player.reputation.score) / 100} ${2 * Math.PI * 27}`}
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-base font-bold">
                        {player.reputation.score}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {t('reputationLabel')}
                      </span>
                      <span className="text-xl font-extrabold leading-none tracking-tight mt-1">
                        {t(`tier.${player.reputation.tier}`)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Stats */}
            {player.showStats && player.stats.gamesPlayed > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {stats.map(stat => (
                  <div
                    key={stat.key}
                    className="flex flex-col items-center gap-1.5 rounded-xl border bg-muted/40 py-4"
                  >
                    {stat.icon}
                    <span className="text-2xl font-extrabold leading-none tracking-tight">
                      {stat.value}
                    </span>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground text-center leading-tight">
                      {stat.label}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Bio */}
            {player.bio && (
              <p className="text-sm text-muted-foreground border-t pt-4 whitespace-pre-line">
                {player.bio}
              </p>
            )}
          </div>
        </div>

        {/* Download CTA */}
        <section className="cta-gradient p-6 rounded-2xl shadow-luma animate-fade-in flex h-full">
          <div className="flex flex-col items-center justify-center gap-5 text-center flex-1">
            <h2 className="text-xl font-bold">{t('downloadTitle', { name: player.name })}</h2>
            <p className="text-sm text-muted-foreground">{t('downloadDescription')}</p>

            <TrackedStoreBadges
              placement="player_page"
              playStoreUrl={PLAY_STORE_URL}
              appStoreLabel={t('appStore')}
              playStoreLabel={t('googlePlay')}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
