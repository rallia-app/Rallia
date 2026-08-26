import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CalendarDays, MapPin } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getTournamentLogoUrl } from '@rallia/shared-utils';

import { IOSCodeHandoff } from '@/components/ios-code-handoff';

import { createServiceRoleClient } from '@/lib/supabase/server';
import { logReferralClick, buildPlayStoreUrl, APP_STORE_URL } from '@/lib/referral-tracking';
import { getLandingContext } from '@/lib/landing-attribution';
import { Card, CardContent } from '@/components/ui/card';
import { TrackedStoreBadges } from '@/components/tracked-store-badges';
import { InviteLandingTracker } from '@/components/invite-landing-tracker';
import ThemeLogo from '@/components/theme-logo';
import { formatDateRange } from '@/lib/format-date-range';
import { SITE_URL } from '@/lib/seo';

type InvitationType =
  | 'referral'
  | 'match'
  | 'group'
  | 'community'
  | 'tournament'
  | 'league'
  | 'flyer'
  | 'poster'
  | 'social';

const CHANNEL_TYPES: readonly InvitationType[] = ['flyer', 'poster', 'social'] as const;
function isChannelType(type: InvitationType): boolean {
  return (CHANNEL_TYPES as readonly string[]).includes(type);
}

type Props = {
  params: Promise<{ code: string; locale: string }>;
  searchParams: Promise<{ type?: string; id?: string; share?: string; session?: string }>;
};

async function getInviter(code: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('profile')
    .select('first_name')
    .eq('referral_code', code.toUpperCase())
    .single();
  return data;
}

async function getMatchDetails(matchId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('match')
    .select(
      `
      *,
      sport:sport_id (name),
      participants:match_participant!match_id (status)
    `
    )
    .eq('id', matchId)
    .single();
  return data;
}

async function getGroupDetails(inviteCode: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('network')
    .select('name, description')
    .eq('invite_code', inviteCode.toUpperCase())
    .eq('network_type', 'group')
    .single();
  return data;
}

async function getCommunityDetails(inviteCode: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('network')
    .select('name, description')
    .eq('invite_code', inviteCode.toUpperCase())
    .eq('network_type', 'community')
    .single();
  return data;
}

interface TournamentDetails {
  name: string;
  logo_url: string | null;
  start_date: string;
  end_date: string;
  city: string | null;
  venue_name: string | null;
  facility: { name: string; city: string | null } | null;
}

async function getTournamentDetails(tournamentId: string): Promise<TournamentDetails | null> {
  // The web Database type deliberately omits the mobile-only tournament tables.
  const supabase =
    createServiceRoleClient() as unknown as import('@supabase/supabase-js').SupabaseClient;
  const { data } = await supabase
    .from('tournaments')
    .select(
      'name, logo_url, start_date, end_date, city, venue_name, facility:facility_id (name, city)'
    )
    .eq('id', tournamentId)
    .single();
  return data as unknown as TournamentDetails | null;
}

function tournamentLocation(tournament: TournamentDetails): string {
  const venue = tournament.venue_name ?? tournament.facility?.name ?? null;
  const city = tournament.city ?? tournament.facility?.city ?? null;
  return [venue, city].filter(Boolean).join(', ');
}

interface LeagueDetails {
  name: string;
  description: string | null;
  venue_name: string | null;
  facility: { name: string; city: string | null } | null;
}

async function getLeagueDetails(leagueId: string): Promise<LeagueDetails | null> {
  // The web Database type deliberately omits the mobile-only league tables.
  const supabase =
    createServiceRoleClient() as unknown as import('@supabase/supabase-js').SupabaseClient;
  const { data } = await supabase
    .from('leagues')
    .select('name, description, venue_name, facility:facility_id (name, city)')
    .eq('id', leagueId)
    .single();
  return data as unknown as LeagueDetails | null;
}

interface LeagueSessionDetails {
  scheduled_at: string;
  timezone: string;
}

async function getLeagueSessionDetails(sessionId: string): Promise<LeagueSessionDetails | null> {
  const supabase =
    createServiceRoleClient() as unknown as import('@supabase/supabase-js').SupabaseClient;
  const { data } = await supabase
    .from('sessions')
    .select('scheduled_at, timezone')
    .eq('id', sessionId)
    .single();
  return data as unknown as LeagueSessionDetails | null;
}

function leagueLocation(league: LeagueDetails): string {
  const venue = league.venue_name ?? league.facility?.name ?? null;
  const city = league.facility?.city ?? null;
  return [venue, city].filter(Boolean).join(', ');
}

function formatSessionDate(session: LeagueSessionDetails, locale: string): string {
  return new Date(session.scheduled_at).toLocaleString(locale, {
    timeZone: session.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseInvitationType(type?: string): InvitationType {
  if (
    type &&
    [
      'match',
      'group',
      'community',
      'tournament',
      'league',
      'referral',
      'flyer',
      'poster',
      'social',
    ].includes(type)
  ) {
    return type as InvitationType;
  }
  return 'referral';
}

/** Self-referential canonical for this invite. Without it the page inherits the
 *  locale layout's homepage canonical (buildAlternates('')), which makes social
 *  scrapers (Facebook obeys rel="canonical") drop the invite URL and preview the
 *  homepage instead, losing the tournament OG image. type/id stay in the URL so
 *  each tournament remains a distinct canonical. */
function buildInviteCanonical(
  code: string,
  locale: string,
  invitationType: InvitationType,
  targetId?: string
): string {
  const params = new URLSearchParams();
  if (invitationType !== 'referral') params.set('type', invitationType);
  if (targetId) params.set('id', targetId);
  const qs = params.toString();
  return `${SITE_URL}/${locale}/invite/${code}${qs ? `?${qs}` : ''}`;
}

/** OG image URL for this invite — /api/og/invite branches on type/id (query params
 *  the file-convention opengraph-image can't see). */
function buildOgImageUrl(
  code: string,
  locale: string,
  invitationType: InvitationType,
  targetId?: string
): string {
  const params = new URLSearchParams({ code, locale });
  if (invitationType !== 'referral') params.set('type', invitationType);
  if (targetId) params.set('id', targetId);
  return `/api/og/invite?${params.toString()}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { code, locale } = await params;
  const query = await searchParams;
  const invitationType = parseInvitationType(query.type);
  const t = await getTranslations({ locale, namespace: 'invitePage' });
  const ogImage = buildOgImageUrl(code, locale, invitationType, query.id);
  const ogImages = [{ url: ogImage, width: 1200, height: 630 }];
  const canonical = buildInviteCanonical(code, locale, invitationType, query.id);

  if (isChannelType(invitationType)) {
    const title = t('physicalTitle');
    return {
      title,
      description: t('physicalDescription'),
      alternates: { canonical },
      robots: { index: false, follow: false },
      openGraph: {
        title,
        description: t('physicalDescription'),
        type: 'website',
        images: ogImages,
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description: t('physicalDescription'),
        images: [ogImage],
      },
    };
  }

  const inviter = await getInviter(code);

  let title: string;
  let description = t('description');

  if (invitationType === 'match' && query.id) {
    const match = await getMatchDetails(query.id);
    const rawSport = match?.sport?.name;
    const sportName = rawSport ? rawSport.charAt(0).toUpperCase() + rawSport.slice(1) : 'a game';
    title = inviter?.first_name
      ? t('matchInviteTitle', { name: inviter.first_name, sport: sportName })
      : t('matchInviteTitleGeneric', { sport: sportName });
  } else if (invitationType === 'tournament' && query.id) {
    const tournament = await getTournamentDetails(query.id);
    if (tournament) {
      title = inviter?.first_name
        ? t('tournamentInviteTitle', { name: inviter.first_name, tournament: tournament.name })
        : t('tournamentInviteTitleGeneric', { tournament: tournament.name });
      const location = tournamentLocation(tournament);
      const dateRange = formatDateRange(tournament.start_date, tournament.end_date, locale);
      description = location ? `${dateRange} · ${location}` : dateRange;
    } else {
      title = inviter?.first_name ? t('invitedBy', { name: inviter.first_name }) : t('title');
    }
  } else if (invitationType === 'league' && query.id) {
    const league = await getLeagueDetails(query.id);
    if (league) {
      title = inviter?.first_name
        ? t('leagueInviteTitle', { name: inviter.first_name, league: league.name })
        : t('leagueInviteTitleGeneric', { league: league.name });
      const session = query.session ? await getLeagueSessionDetails(query.session) : null;
      const parts = [
        session ? t('leagueSessionLine', { date: formatSessionDate(session, locale) }) : null,
        leagueLocation(league) || null,
      ].filter(Boolean);
      if (parts.length > 0) description = parts.join(' · ');
      else if (league.description) description = league.description;
    } else {
      title = inviter?.first_name ? t('invitedBy', { name: inviter.first_name }) : t('title');
    }
  } else if (invitationType === 'group' && query.id) {
    const group = await getGroupDetails(query.id);
    title = group?.name ? t('groupInviteTitle', { group: group.name }) : t('title');
  } else if (invitationType === 'community' && query.id) {
    const community = await getCommunityDetails(query.id);
    title = community?.name ? t('communityInviteTitle', { community: community.name }) : t('title');
  } else {
    title = inviter?.first_name ? t('invitedBy', { name: inviter.first_name }) : t('title');
  }

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: false, follow: false },
    openGraph: { title, description, type: 'website', images: ogImages },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
  };
}

export default async function InvitePage({ params, searchParams }: Props) {
  const { code, locale } = await params;
  const query = await searchParams;
  const invitationType = parseInvitationType(query.type);
  const targetId = query.id;

  const { platform, ip, userAgent, webDistinctId, utm } = await getLandingContext(query);

  // Log click for all visitors (non-blocking)
  logReferralClick(code, ip, userAgent, invitationType, targetId, webDistinctId, utm).catch(
    () => {}
  );

  if (platform === 'android') {
    redirect(buildPlayStoreUrl(code, invitationType, targetId, { webDistinctId, utm }));
  }

  // iOS + Desktop: show landing page (iOS gets clipboard CTA, desktop gets QR code)
  const t = await getTranslations({ locale, namespace: 'invitePage' });
  const isChannel = isChannelType(invitationType);

  // Physical channels (flyer/poster) have no referring user — skip inviter lookup
  const inviter = isChannel ? null : await getInviter(code);

  if (!isChannel && !inviter) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 w-full">
        <h1 className="text-2xl font-bold">{t('notFound')}</h1>
        <p className="text-muted-foreground">{t('notFoundDescription')}</p>
      </div>
    );
  }

  // Build the full invite URL preserving query params for the QR code
  let inviteUrl = `https://rallia.app/invite/${code}`;
  if (invitationType !== 'referral' || targetId) {
    const qsParams = new URLSearchParams();
    if (invitationType !== 'referral') qsParams.set('type', invitationType);
    if (targetId) qsParams.set('id', targetId);
    if (invitationType === 'league' && query.session) qsParams.set('session', query.session);
    inviteUrl += `?${qsParams.toString()}`;
  }

  // Fetch contextual details for rich preview
  let contextHeading: string | null = null;
  let contextDescription: string | null = null;
  // Tournament invites render richer context: the event artwork as a banner
  // plus icon rows instead of an emoji text line.
  let bannerImageUrl: string | null = null;
  let bannerImageAlt: string | null = null;
  let contextRows: { icon: 'calendar' | 'location'; text: string }[] = [];

  if (invitationType === 'match' && targetId) {
    const match = await getMatchDetails(targetId);
    if (match) {
      const rawSport = match.sport?.name;
      const sportName = rawSport ? rawSport.charAt(0).toUpperCase() + rawSport.slice(1) : 'a game';
      const [year, month, day] = match.match_date.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day);
      const matchDate = dateObj.toLocaleDateString(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const matchTime = match.start_time?.substring(0, 5) || '';
      const location = match.location_name || '';
      contextHeading = inviter?.first_name
        ? t('matchInviteHeading', { name: inviter.first_name, sport: sportName })
        : t('matchInviteHeadingGeneric', { sport: sportName });
      const parts = [`📅 ${matchDate}${matchTime ? ` ${t('at')} ${matchTime}` : ''}`];
      if (location) parts.push(`📍 ${location}`);
      contextDescription = parts.join(' · ');
    }
  } else if (invitationType === 'tournament' && targetId) {
    const tournament = await getTournamentDetails(targetId);
    if (tournament) {
      contextHeading = inviter?.first_name
        ? t('tournamentInviteHeading', { name: inviter.first_name, tournament: tournament.name })
        : t('tournamentInviteHeadingGeneric', { tournament: tournament.name });
      const location = tournamentLocation(tournament);
      const dateRange = formatDateRange(tournament.start_date, tournament.end_date, locale);
      contextRows = [{ icon: 'calendar', text: dateRange }];
      if (location) contextRows.push({ icon: 'location', text: location });
      bannerImageUrl = getTournamentLogoUrl(tournament.logo_url);
      bannerImageAlt = tournament.name;
    }
  } else if (invitationType === 'league' && targetId) {
    const league = await getLeagueDetails(targetId);
    if (league) {
      contextHeading = inviter?.first_name
        ? t('leagueInviteHeading', { name: inviter.first_name, league: league.name })
        : t('leagueInviteHeadingGeneric', { league: league.name });
      const session = query.session ? await getLeagueSessionDetails(query.session) : null;
      const location = leagueLocation(league);
      const parts = [
        session
          ? `📅 ${t('leagueSessionLine', { date: formatSessionDate(session, locale) })}`
          : null,
        location ? `📍 ${location}` : null,
      ].filter(Boolean);
      contextDescription = parts.length > 0 ? parts.join(' · ') : league.description || null;
    }
  } else if (invitationType === 'group' && targetId) {
    const group = await getGroupDetails(targetId);
    if (group) {
      contextHeading = t('groupInviteHeading', { group: group.name });
      contextDescription = group.description || null;
    }
  } else if (invitationType === 'community' && targetId) {
    const community = await getCommunityDetails(targetId);
    if (community) {
      contextHeading = t('communityInviteHeading', { community: community.name });
      contextDescription = community.description || null;
    }
  }

  const heading =
    contextHeading ||
    (isChannel
      ? t('physicalHeading')
      : inviter?.first_name
        ? t('invitedBy', { name: inviter.first_name })
        : t('invitedByGeneric'));

  const fallbackDescription = isChannel ? t('physicalDescription') : t('description');

  return (
    <div className="relative flex flex-col items-center gap-8 py-16 w-full max-w-lg mx-auto animate-fade-in">
      {/* Decorative glow — same vocabulary as /events so the funnel feels continuous */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 flex justify-center"
      >
        <div className="h-56 w-56 -translate-x-16 rounded-full bg-[var(--primary-500)]/15 blur-3xl" />
        <div className="h-48 w-48 translate-x-16 translate-y-10 rounded-full bg-[var(--secondary-500)]/10 blur-3xl" />
      </div>

      <InviteLandingTracker
        surface="invite"
        invitationType={invitationType}
        platform={platform ?? 'desktop'}
        code={code}
        {...(targetId ? { targetId } : {})}
      />
      <ThemeLogo width={140} height={40} />

      {bannerImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bannerImageUrl}
          alt={bannerImageAlt ?? ''}
          className="w-full max-h-60 rounded-2xl border object-cover shadow-lg"
        />
      )}

      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold">{heading}</h1>
        {contextRows.length > 0 ? (
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
            {contextRows.map(row => (
              <span key={`${row.icon}-${row.text}`} className="flex items-center gap-2">
                {row.icon === 'calendar' ? (
                  <CalendarDays className="size-4 shrink-0 text-primary/70" />
                ) : (
                  <MapPin className="size-4 shrink-0 text-primary/70" />
                )}
                {row.text}
              </span>
            ))}
          </div>
        ) : contextDescription ? (
          <p className="text-muted-foreground">{contextDescription}</p>
        ) : (
          <p className="text-muted-foreground">{fallbackDescription}</p>
        )}
      </div>

      {platform === 'ios' ? (
        <IOSCodeHandoff
          code={code.toUpperCase()}
          appStoreUrl={APP_STORE_URL}
          downloadLabel={t('downloadCta')}
          codeLabel={t('iosCodeLabel')}
          codeHint={t('iosCodeHint')}
          copyLabel={t('iosCopyCode')}
          copiedLabel={t('iosCodeCopied')}
          referral={{
            code,
            type: invitationType,
            ...(targetId ? { targetId } : {}),
          }}
        />
      ) : (
        <>
          <Card className="p-6">
            <CardContent className="flex flex-col items-center gap-4 p-0">
              <QRCodeSVG value={inviteUrl} size={200} level="M" />
              <p className="text-sm text-muted-foreground text-center">{t('scanQr')}</p>
            </CardContent>
          </Card>

          <TrackedStoreBadges
            placement="invite_page"
            playStoreUrl={buildPlayStoreUrl(code, invitationType, targetId, {
              webDistinctId,
              utm,
            })}
            appStoreLabel={t('appStore')}
            playStoreLabel={t('googlePlay')}
            invitationCode={code}
            {...(targetId ? { matchId: targetId } : {})}
            referral={{
              code,
              type: invitationType,
              ...(targetId ? { targetId } : {}),
            }}
          />
        </>
      )}
    </div>
  );
}
