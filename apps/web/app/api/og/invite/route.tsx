/**
 * Dynamic OG image for /invite/{code} links.
 *
 * The invite route carries its context in query params (?type=tournament&id=…),
 * which the file-convention opengraph-image can't see — so the invite page's
 * generateMetadata points og:image here instead. Tournament invites render the
 * tournament's banner (or a branded trophy background when the organizer kept
 * the default banner) with name/dates/venue/spots; every other type renders
 * the generic "X invited you to Rallia" card.
 */
import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { primary, secondary, neutral, accent, status } from '@rallia/design-system';
import { getTournamentLogoUrl } from '@rallia/shared-utils';
import { locales, defaultLocale } from '@rallia/shared-translations';

import { createServiceRoleClient } from '@/lib/supabase/server';
import { formatDateRange } from '@/lib/format-date-range';
import { loadOgFonts } from '@/lib/og-fonts';

/** The web Database type deliberately omits the mobile-only tournament tables —
 *  read them through an untyped client and type the rows locally. */
function untypedServiceRoleClient(): SupabaseClient {
  return createServiceRoleClient();
}

export const revalidate = 3600;

const SIZE = { width: 1200, height: 630 };
/** 9:16 Instagram/Snapchat story frame, requested with ?format=story. */
const STORY_SIZE = { width: 1080, height: 1920 };
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
};

// Inline base64-encoded logo SVG to avoid filesystem/network issues on Vercel serverless
const LOGO_BASE64 =
  'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyAgIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgdmlld0JveD0iMCAwIDEzMzAuNjUgNTE4LjMyIj4KICA8cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNMTU4LjA2LDEzOS44N2MxNDcuNDksMTUuNDMsMTg1LjE5LDE1OS44LDU1LjE3LDIzMC45OWw4MC44MywxNDIuMjUtMTAzLjAxLTMuNWMtMTQuMzktOC43MS01My4xOC0xMTIuNTgtNjkuODctMTI4LjA2LTkuMjUtOC41OC0xMy4wNy04Ljg3LTI1LjYxLTcuNDR2MTM5LjA4SDBWMTM4LjMyYzQ4LjU2LS4yNiwxMTEuNjYtMy4zLDE1OC4wNiwxLjU1aDBaTTE4OS40LDIyOS40NWMtMTUuOTctMTUuOTYtNzEuMDEtNi42Mi05My44Ni01LjA5djg3LjkxYzMzLjUxLTEuMjYsOTUuNDYsMTIuMjQsMTAzLjA2LTMzLjM2LDEuOTItMTEuNTItMS4wNS0zNy4zMi05LjE5LTQ1LjQ2aC0uMDFaIi8+CiAgPHJlY3QgZmlsbD0iI2ZmZmZmZiIgeD0iNjQ2Ljk0IiB5PSIxMjUuMjQiIHdpZHRoPSI5NS41NyIgaGVpZ2h0PSIzODcuOTYiLz4KICA8cmVjdCBmaWxsPSIjZmZmZmZmIiB4PSI3NzkuMjciIHk9IjEyNS4yNCIgd2lkdGg9Ijk1LjU3IiBoZWlnaHQ9IjM4Ny45NiIvPgogIDxyZWN0IGZpbGw9IiNmZmZmZmYiIHg9IjkwNC4yNSIgeT0iMjIwLjM5IiB3aWR0aD0iOTUuNTciIGhlaWdodD0iMjkyLjgiLz4KICA8cGF0aCBmaWxsPSIjZmRkNDRlIiBkPSJNOTUyLjQ2LDg0LjE1YzY2LjAxLTMuNDksNzIuMDUsOTQuODgsNS4wNyw5OC4xNy03Mi44NCwzLjU4LTgwLjkzLTk0LjE1LTUuMDctOTguMTdaIi8+CiAgPHBhdGggZmlsbD0iI2ZkZDQ0ZSIgZD0iTTg5Ni42OSw3NS44MWMtMTIyLjU1LTIzLjIyLTQyMy43OS0xMDAuOTQtNDk1LjQzLDM1LjE3LTUuNDEsMTAuMzItOS40OCwyMS41OS0xMi42NCwzMy4zNC0uNTEtMTIuMTYuNzgtMjQuNTUsNC4wNi0zNi42NywyLjQ1LTkuMTIsNi4xMy0xOC4xMiwxMC45MS0yNi4zNSwyNC40OC00Mi41Niw3Mi43Ny02NC4zLDExOS4wNy03My45MiwxMjAuMzYtMjMuODgsMjY2LjQsMTMuMTcsMzc0LjAzLDY4LjQzaDBaIi8+CiAgPHBhdGggZmlsbD0iI2ZkZDQ0ZSIgZD0iTTg3OS41LDEwNi4yN2MtMTA4Ljg1LTEzLjE4LTI3Ni00OS42Mi0zNjcuNjMsMjIuOTQtMy40MiwyLjY5LTYuNzUsNS41Mi05Ljk2LDguNDgtNi40NSw1Ljk3LTEyLjUyLDEyLjU1LTE4LjQyLDE5LjU2LDUuMzItMTcuNTQsMTUuMjQtMzMuOTYsMjguMTktNDcuOTEsODcuMTEtOTAuOTEsMjY4LjQ2LTU4LjI1LDM2Ny44My0zLjA3aDBaIi8+CiAgPGc+CiAgICA8cGF0aCBmaWxsPSIjNTZiY2I3IiBkPSJNNTIyLjgzLDIyNi4zN2wtLjA0LDM2LjEyYy05Ny44NC05My45Mi0yMjAuNzUtMTUuNjUtMjE4LjA5LDExMS45NSwyLjUzLDEyMS40NiwxMjQuNjEsMTkyLjgyLDIxOC4wOSwxMDQuNTVsLjA0LDM2LjEyLDg3LjEtLjA0VjIyNi40MmwtODcuMS0uMDRoMFoiLz4KICA8L2c+CiAgPHBhdGggZmlsbD0iI2VkNmM2ZSIgZD0iTTEyNDIuMzksMjE4LjdsLS4wNCwzNi42NGMtOTkuMTUtOTUuMjYtMjIzLjY5LTE1Ljg3LTIyMSwxMTMuNTUsMi41NiwxMjMuMiwxMjYuMjcsMTk1LjU5LDIyMSwxMDYuMDVsLjA0LDM2LjY0LDg4LjI2LS4wNFYyMTguNzRsLTg4LjI2LS4wNGgwWiIvPgo8L3N2Zz4=';
const logoSrc = `data:image/svg+xml;base64,${LOGO_BASE64}`;

interface TournamentOgData {
  name: string;
  start_date: string;
  end_date: string;
  city: string | null;
  venue_name: string | null;
  status: string;
  entry_fee_cents: number;
  currency: string;
  entry_format: 'singles' | 'doubles' | 'mixed_doubles';
  max_participants: number;
  min_rating: number | null;
  max_rating: number | null;
  prize_money_cents: number | null;
  registration_closes_at: string | null;
  logo_url: string | null;
  sport: { name: string } | null;
  facility: { name: string; city: string | null } | null;
  registeredCount: number;
}

async function getTournament(id: string): Promise<TournamentOgData | null> {
  const supabase = untypedServiceRoleClient();
  const { data } = await supabase
    .from('tournaments')
    .select(
      `
      name, start_date, end_date, city, venue_name, status,
      entry_fee_cents, currency, entry_format, max_participants,
      min_rating, max_rating, prize_money_cents, registration_closes_at, logo_url,
      sport:sport_id (name),
      facility:facility_id (name, city)
    `
    )
    .eq('id', id)
    .single();
  if (!data) return null;

  const { count } = await supabase
    .from('tournament_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', id)
    .in('status', ['registered', 'pending']);

  return { ...data, registeredCount: count ?? 0 } as unknown as TournamentOgData;
}

async function getInviter(code: string) {
  if (!code) return null;
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('profile')
    .select('first_name')
    .eq('referral_code', code.toUpperCase())
    .single();
  return data;
}

/**
 * Fetch the banner and re-encode it as a JPEG data URI cropped to the OG frame.
 * Satori can't decode webp (the Série 1 banners) and organizer uploads vary
 * wildly in size/format — sharp normalizes all of it. Returns null on any
 * failure so the card falls back to the branded backdrop.
 */
async function fetchBannerDataUri(
  url: string,
  width: number,
  height: number
): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    const sharp = (await import('sharp')).default;
    const jpeg = await sharp(input)
      .resize(width, height, { fit: 'cover' })
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Banner art area height in the banner layout — the rest is the info panel.
 *  1200×424 is a gentle center crop of the 2.4:1 (1200×500) banner shape. */
const BANNER_HEIGHT = 424;

/** Money formatted for Canada so CAD renders as "$25" / "25 $", not "CA$25". */
function formatMoney(cents: number, currency: string, locale: string): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(locale === 'fr-CA' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

type Fonts = { name: string; data: ArrayBuffer; style: 'normal'; weight: 500 | 600 | 700 }[];
type Translator = Awaited<ReturnType<typeof getTranslations>>;

/** Display values shared by the landscape OG card and the story poster. */
function deriveTournamentCard(tournament: TournamentOgData, locale: string, t: Translator) {
  const rawSport = tournament.sport?.name;
  const sportName = rawSport ? rawSport.charAt(0).toUpperCase() + rawSport.slice(1) : '';
  const bannerUrl = tournament.logo_url
    ? (getTournamentLogoUrl(tournament.logo_url) ?? tournament.logo_url)
    : null;

  const dateStr = formatDateRange(tournament.start_date, tournament.end_date, locale);
  const venue = tournament.venue_name ?? tournament.facility?.name ?? null;
  const city = tournament.city ?? tournament.facility?.city ?? null;
  const location = [venue, city].filter(Boolean).join(', ');

  const badges: string[] = [];
  badges.push(
    tournament.entry_format === 'mixed_doubles'
      ? t('mixedDoubles')
      : tournament.entry_format === 'doubles'
        ? t('doubles')
        : t('singles')
  );
  const { min_rating: minR, max_rating: maxR } = tournament;
  if (minR != null && maxR != null) {
    badges.push(`${Number(minR).toFixed(1)} – ${Number(maxR).toFixed(1)}`);
  } else if (minR != null) {
    badges.push(`${Number(minR).toFixed(1)}+`);
  } else if (maxR != null) {
    badges.push(`≤ ${Number(maxR).toFixed(1)}`);
  }
  if (tournament.entry_fee_cents > 0) {
    badges.push(
      t('entryFee', {
        amount: formatMoney(tournament.entry_fee_cents, tournament.currency, locale),
      })
    );
  } else {
    badges.push(t('free'));
  }
  if (tournament.prize_money_cents && tournament.prize_money_cents > 0) {
    badges.push(
      t('prizePool', {
        amount: formatMoney(tournament.prize_money_cents, tournament.currency, locale),
      })
    );
  }

  const isOpen = tournament.status === 'registration_open';
  const spotsLeft = Math.max(0, tournament.max_participants - tournament.registeredCount);
  const isFull = spotsLeft === 0;
  const pillText = !isOpen
    ? t('registrationClosed')
    : isFull
      ? t('full')
      : t('spotsLeft', { count: spotsLeft });
  const pillColor = !isOpen
    ? neutral[600]
    : isFull
      ? status.error.dark
      : spotsLeft <= 3
        ? status.warning.dark
        : status.success.DEFAULT;
  const pillBg = !isOpen
    ? neutral[100]
    : isFull
      ? '#fef2f2'
      : spotsLeft <= 3
        ? accent[50]
        : '#ecfdf5';
  const pillDot = !isOpen
    ? neutral[400]
    : isFull
      ? status.error.DEFAULT
      : spotsLeft <= 3
        ? status.warning.DEFAULT
        : status.success.light;

  return { sportName, bannerUrl, dateStr, location, badges, pillText, pillColor, pillBg, pillDot };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code') ?? '';
  const localeParam = searchParams.get('locale') ?? '';
  const locale = (locales as readonly string[]).includes(localeParam) ? localeParam : defaultLocale;
  const type = searchParams.get('type');
  const id = searchParams.get('id');

  const {
    poppinsBold: poppinsBoldData,
    poppinsSemiBold: poppinsSemiBoldData,
    interMedium: interMediumData,
  } = await loadOgFonts();
  const fonts: Fonts = [
    { name: 'Poppins', data: poppinsBoldData, style: 'normal', weight: 700 },
    { name: 'Poppins', data: poppinsSemiBoldData, style: 'normal', weight: 600 },
    { name: 'Inter', data: interMediumData, style: 'normal', weight: 500 },
  ];

  if (type === 'tournament' && id) {
    const tournament = await getTournament(id);
    if (tournament) {
      return searchParams.get('format') === 'story'
        ? tournamentStoryImage(tournament, id, code, searchParams.get('share') ?? '', locale, fonts)
        : tournamentImage(tournament, locale, fonts);
    }
  }

  return inviteImage(code, locale, fonts);
}

// ---------------------------------------------------------------------------
// Tournament card
// ---------------------------------------------------------------------------

async function tournamentImage(tournament: TournamentOgData, locale: string, fonts: Fonts) {
  const t = await getTranslations({ locale, namespace: 'tournamentOg' });

  const { sportName, bannerUrl, dateStr, location, badges, pillText, pillColor, pillBg, pillDot } =
    deriveTournamentCard(tournament, locale, t);
  const bannerSrc = bannerUrl ? await fetchBannerDataUri(bannerUrl, 1200, BANNER_HEIGHT) : null;

  const rawName = tournament.name;
  const name = rawName.length > 64 ? `${rawName.slice(0, 63)}…` : rawName;
  const nameSize = name.length > 42 ? 42 : name.length > 26 ? 50 : 58;

  const pill = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 24px',
        borderRadius: 100,
        background: pillBg,
      }}
    >
      <div style={{ width: 10, height: 10, borderRadius: 5, background: pillDot }} />
      <span style={{ fontFamily: 'Poppins', fontSize: 19, fontWeight: 600, color: pillColor }}>
        {pillText}
      </span>
    </div>
  );

  const eyebrowChip = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 22px',
        borderRadius: 999,
        background: 'rgba(4,47,46,0.55)',
        border: '1px solid rgba(255,255,255,0.22)',
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={accent[400]}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
      <span
        style={{
          fontFamily: 'Poppins',
          fontSize: 19,
          fontWeight: 600,
          color: '#ffffff',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
        }}
      >
        {sportName ? `${sportName} · ${t('tournament')}` : t('tournament')}
      </span>
    </div>
  );

  const accentBar = (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 5,
        display: 'flex',
        background: 'linear-gradient(90deg, #6bdcc9, #f5b535, #f2554b)',
      }}
    />
  );

  // Banner layout: the organizer's art shown nearly uncropped on top, with a
  // solid info panel below — never fighting typography baked into the banner.
  if (bannerSrc) {
    const bannerName = rawName.length > 56 ? `${rawName.slice(0, 55)}…` : rawName;
    const bannerLocation = location.length > 32 ? `${location.slice(0, 31)}…` : location;
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          fontFamily: 'Inter',
          background: primary[950],
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bannerSrc}
          width={1200}
          height={BANNER_HEIGHT}
          style={{ width: 1200, height: BANNER_HEIGHT, objectFit: 'cover' }}
        />
        {accentBar}
        {/* Rallia logo floats top-right on a subtle scrim chip */}
        <div
          style={{
            position: 'absolute',
            top: 26,
            right: 40,
            display: 'flex',
            alignItems: 'center',
            padding: '10px 16px',
            borderRadius: 14,
            background: 'rgba(4,47,46,0.5)',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} height={36} style={{ height: 36, objectFit: 'contain' }} />
        </div>

        {/* Info panel */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            justifyContent: 'space-between',
            padding: '22px 56px 26px 56px',
            borderTop: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span
              style={{
                fontFamily: 'Poppins',
                fontSize: 15,
                fontWeight: 600,
                color: primary[300],
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
              }}
            >
              {sportName ? `${sportName} · ${t('tournament')}` : t('tournament')}
            </span>
            <span
              style={{
                fontFamily: 'Poppins',
                fontSize: bannerName.length > 44 ? 30 : 36,
                fontWeight: 700,
                color: '#ffffff',
                lineHeight: 1.15,
              }}
            >
              {bannerName}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={primary[300]}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span style={{ fontSize: 22, fontWeight: 500, color: primary[100] }}>
                  {dateStr}
                </span>
              </div>
              {bannerLocation && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={primary[300]}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span style={{ fontSize: 21, fontWeight: 500, color: neutral[200] }}>
                    {bannerLocation}
                  </span>
                </div>
              )}
              {badges.slice(0, 2).map((badge, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '7px 16px',
                    borderRadius: 9,
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                  }}
                >
                  <span style={{ fontSize: 17, fontWeight: 500, color: primary[100] }}>
                    {badge}
                  </span>
                </div>
              ))}
            </div>
            {pill}
          </div>
        </div>
      </div>,
      { ...SIZE, fonts, headers: CACHE_HEADERS }
    );
  }

  // Backdrop layout: custom branded art when the tournament rides the default
  // banner — same poster language as the Série 1 banners (deep teal, faint
  // arcs, a coral bracket converging on a gold trophy node).
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        fontFamily: 'Inter',
        background: `linear-gradient(140deg, ${primary[950]} 0%, #0a4e48 55%, ${primary[800]} 100%)`,
      }}
    >
      {/* Faint concentric arcs, bottom-left */}
      <div
        style={{
          position: 'absolute',
          bottom: -200,
          left: -160,
          width: 560,
          height: 560,
          borderRadius: 280,
          border: '1.5px solid rgba(94,234,212,0.11)',
          display: 'flex',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -130,
          left: -90,
          width: 420,
          height: 420,
          borderRadius: 210,
          border: '1.5px solid rgba(94,234,212,0.07)',
          display: 'flex',
        }}
      />
      {/* Bracket motif: eight seeds funnel into a gold trophy */}
      <svg
        width="410"
        height="338"
        viewBox="0 0 400 330"
        fill="none"
        style={{ position: 'absolute', top: 72, right: 48 }}
      >
        <g
          stroke={secondary[500]}
          strokeOpacity="0.55"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M0 10h55M0 50h55M55 10v40M55 30h75" />
          <path d="M0 100h55M0 140h55M55 100v40M55 120h75" />
          <path d="M0 190h55M0 230h55M55 190v40M55 210h75" />
          <path d="M0 280h55M0 320h55M55 280v40M55 300h75" />
          <path d="M130 30v90M130 75h75" />
          <path d="M130 210v90M130 255h75" />
          <path d="M205 75v180M205 165h61" />
        </g>
        <circle cx="300" cy="165" r="52" fill={accent[400]} fillOpacity="0.09" />
        <circle
          cx="300"
          cy="165"
          r="34"
          fill="rgba(4,47,46,0.75)"
          stroke={accent[400]}
          strokeOpacity="0.85"
          strokeWidth="2"
        />
        <g transform="translate(282,147) scale(1.5)">
          <g
            stroke={accent[400]}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
            <path d="M4 22h16" />
            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
            <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
          </g>
        </g>
      </svg>

      {accentBar}

      {/* Top bar: sport · tournament eyebrow + Rallia logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '36px 56px 0 56px',
        }}
      >
        {eyebrowChip}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} height={40} style={{ height: 40, objectFit: 'contain' }} />
      </div>

      {/* Spacer pushes the info block to the bottom */}
      <div style={{ display: 'flex', flexGrow: 1 }} />

      {/* Bottom info block */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          padding: '0 56px 44px 56px',
        }}
      >
        {/* Tri-colour dashes — the Série 1 poster signature */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 46,
              height: 6,
              borderRadius: 3,
              background: primary[300],
              display: 'flex',
            }}
          />
          <div
            style={{
              width: 46,
              height: 6,
              borderRadius: 3,
              background: secondary[400],
              display: 'flex',
            }}
          />
          <div
            style={{
              width: 46,
              height: 6,
              borderRadius: 3,
              background: accent[400],
              display: 'flex',
            }}
          />
        </div>
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: nameSize,
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1.12,
            maxWidth: 1030,
          }}
        >
          {name}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke={primary[200]}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span style={{ fontSize: 27, fontWeight: 500, color: primary[100] }}>{dateStr}</span>
          </div>
          {location && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke={primary[200]}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span style={{ fontSize: 25, fontWeight: 500, color: neutral[200] }}>{location}</span>
            </div>
          )}
        </div>

        {/* Badges + spots pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {badges.map((badge, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '9px 20px',
                  borderRadius: 10,
                  background: 'rgba(4,47,46,0.5)',
                  border: '1px solid rgba(255,255,255,0.18)',
                }}
              >
                <span style={{ fontSize: 19, fontWeight: 500, color: primary[100] }}>{badge}</span>
              </div>
            ))}
          </div>

          {pill}
        </div>
      </div>
    </div>,
    { ...SIZE, fonts, headers: CACHE_HEADERS }
  );
}

// ---------------------------------------------------------------------------
// Tournament story poster (9:16, for Instagram/Snapchat stories)
// ---------------------------------------------------------------------------

/** QR for the full invite link — stories get screenshotted and printed, and a
 *  scan survives both. The `qrcode` lib emits plain SVG, no React needed. */
async function qrDataUri(value: string): Promise<string | null> {
  try {
    const QRCode = (await import('qrcode')).default;
    const svg = await QRCode.toString(value, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: primary[950], light: '#ffffff' },
    });
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Vertical poster a player shares to their story. Content is inset ~180px top
 * / ~230px bottom so Instagram's username header and reply box never cover it.
 * The sharer's referral code is rendered as the visible link and the QR
 * carries the full share-tokened invite URL, so screenshots and prints keep
 * both attribution and redemption.
 */
async function tournamentStoryImage(
  tournament: TournamentOgData,
  tournamentId: string,
  code: string,
  shareToken: string,
  locale: string,
  fonts: Fonts
) {
  const t = await getTranslations({ locale, namespace: 'tournamentOg' });

  const { sportName, bannerUrl, dateStr, location, badges, pillText } = deriveTournamentCard(
    tournament,
    locale,
    t
  );
  // 952×397 keeps the 2.4:1 banner shape uncropped inside the story frame.
  const bannerSrc = bannerUrl ? await fetchBannerDataUri(bannerUrl, 952, 397) : null;

  const rawName = tournament.name;
  const name = rawName.length > 72 ? `${rawName.slice(0, 71)}…` : rawName;
  const nameSize = name.length > 48 ? 56 : name.length > 30 ? 66 : 78;
  const linkLabel = code ? `rallia.app/invite/${code.toUpperCase()}` : 'rallia.app';

  const isOpen = tournament.status === 'registration_open';
  const spotsLeft = Math.max(0, tournament.max_participants - tournament.registeredCount);
  const urgent = isOpen && spotsLeft > 0 && spotsLeft <= 3;
  // Dark-scheme status colors — the OG card's light pill palette washes out here.
  const spot =
    !isOpen || spotsLeft === 0
      ? {
          dot: neutral[400],
          text: neutral[200],
          bg: 'rgba(2,27,26,0.65)',
          border: 'rgba(255,255,255,0.25)',
        }
      : urgent
        ? {
            dot: accent[400],
            text: accent[300],
            bg: 'rgba(245,181,53,0.14)',
            border: 'rgba(245,181,53,0.45)',
          }
        : {
            dot: '#34d399',
            text: '#6ee7b7',
            bg: 'rgba(52,211,153,0.12)',
            border: 'rgba(52,211,153,0.40)',
          };

  const goldText = {
    backgroundImage: `linear-gradient(180deg, #fde9a8 0%, ${accent[400]} 55%, #d99a1f 100%)`,
    backgroundClip: 'text',
    color: 'transparent',
  } as const;

  const hasPrize = !!tournament.prize_money_cents && tournament.prize_money_cents > 0;
  const prizeStr = hasPrize
    ? t('prizePool', {
        amount: formatMoney(tournament.prize_money_cents!, tournament.currency, locale),
      })
    : '';
  // The gold hero line already shows the prize — don't repeat it as a badge.
  const shownBadges = hasPrize ? badges.filter(b => b !== prizeStr) : badges;

  const deadlineStr =
    isOpen && tournament.registration_closes_at
      ? new Intl.DateTimeFormat(locale === 'fr-CA' ? 'fr-CA' : 'en-CA', {
          day: 'numeric',
          month: 'long',
          timeZone: 'America/Toronto',
        }).format(new Date(tournament.registration_closes_at))
      : null;

  const qrTarget = code
    ? `https://rallia.app/invite/${encodeURIComponent(code.toUpperCase())}?type=tournament&id=${tournamentId}${
        shareToken ? `&share=${encodeURIComponent(shareToken)}` : ''
      }&utm_source=story&utm_medium=qr`
    : 'https://rallia.app';
  const qrSrc = await qrDataUri(qrTarget);

  const eyebrowDash = (color: string) => (
    <div style={{ width: 42, height: 5, borderRadius: 3, background: color, display: 'flex' }} />
  );

  const trophySvg = (size: number, stroke: string, strokeWidth: number) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        fontFamily: 'Inter',
        background: `linear-gradient(175deg, #021b1a 0%, ${primary[950]} 38%, #0a4e48 78%, #0d5a52 100%)`,
      }}
    >
      {/* Ambient glows */}
      <div
        style={{
          position: 'absolute',
          top: -320,
          right: -320,
          width: 900,
          height: 900,
          display: 'flex',
          background:
            'radial-gradient(circle, rgba(242,85,75,0.22) 0%, rgba(242,85,75,0.06) 45%, transparent 68%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -380,
          left: -320,
          width: 1000,
          height: 1000,
          display: 'flex',
          background:
            'radial-gradient(circle, rgba(107,220,201,0.18) 0%, rgba(107,220,201,0.05) 45%, transparent 68%)',
        }}
      />
      {/* Faint perspective court lines in the empty bottom zone */}
      <svg
        width="1080"
        height="620"
        viewBox="0 0 1080 620"
        fill="none"
        style={{ position: 'absolute', bottom: 0, left: 0 }}
      >
        <g stroke="rgba(255,255,255,0.05)" strokeWidth="3">
          <path d="M400 0 L680 0 L1010 620 L70 620 Z" />
          <path d="M442 0 L211 620" />
          <path d="M638 0 L869 620" />
          <path d="M330 300 L750 300" />
          <path d="M540 0 L540 300" />
        </g>
      </svg>
      {/* Vignette pulls the eye to the center */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          background:
            'radial-gradient(ellipse at center, transparent 52%, rgba(0,12,11,0.38) 100%)',
        }}
      />

      {/* Accent bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 8,
          display: 'flex',
          background: 'linear-gradient(90deg, #6bdcc9, #f5b535, #f2554b)',
        }}
      />

      {/* Top: logo + sport eyebrow, below the Instagram username header */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 30,
          paddingTop: 176,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} height={54} style={{ height: 54, objectFit: 'contain' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {eyebrowDash(accent[400])}
          <span
            style={{
              fontFamily: 'Poppins',
              fontSize: 27,
              fontWeight: 600,
              color: primary[300],
              textTransform: 'uppercase',
              letterSpacing: '0.24em',
              marginRight: -7,
            }}
          >
            {sportName ? `${sportName} · ${t('tournament')}` : t('tournament')}
          </span>
          {eyebrowDash(accent[400])}
        </div>
      </div>

      {/* Name */}
      <span
        style={{
          fontFamily: 'Poppins',
          fontSize: nameSize,
          fontWeight: 700,
          color: '#ffffff',
          lineHeight: 1.08,
          maxWidth: 940,
          textAlign: 'center',
          marginTop: 32,
        }}
      >
        {name}
      </span>

      {/* Hero: tilted banner art, or glowing trophy */}
      {bannerSrc ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 44 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bannerSrc}
            width={952}
            height={397}
            style={{
              width: 952,
              height: 397,
              objectFit: 'cover',
              borderRadius: 26,
              border: '1px solid rgba(255,255,255,0.16)',
              transform: 'rotate(-2deg)',
              boxShadow: '0 30px 70px rgba(0,0,0,0.5)',
            }}
          />
        </div>
      ) : (
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 900,
            height: 380,
            marginTop: 12,
          }}
        >
          {/* Seeds funnel in from both sides toward the trophy */}
          <svg
            width="900"
            height="380"
            viewBox="0 0 900 380"
            fill="none"
            style={{ position: 'absolute', top: 0, left: 0 }}
          >
            <g stroke={secondary[500]} strokeOpacity="0.5" strokeWidth="2.5" strokeLinecap="round">
              <path d="M20 60h100M20 140h100M120 60v80M120 100h90" />
              <path d="M20 240h100M20 320h100M120 240v80M120 280h90" />
              <path d="M210 100v180M210 190h90" />
              <path d="M780 60h100M780 140h100M780 60v80M690 100h90" />
              <path d="M780 240h100M780 320h100M780 240v80M690 280h90" />
              <path d="M690 100v180M600 190h90" />
            </g>
          </svg>
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: 270,
              width: 360,
              height: 360,
              display: 'flex',
              background:
                'radial-gradient(circle, rgba(245,181,53,0.25) 0%, rgba(245,181,53,0.07) 50%, transparent 68%)',
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 236,
              height: 236,
              borderRadius: 118,
              background: 'rgba(4,47,46,0.8)',
              border: `2px solid ${accent[400]}`,
              boxShadow: '0 0 60px rgba(245,181,53,0.35)',
            }}
          >
            {trophySvg(120, accent[400], 1.3)}
          </div>
        </div>
      )}

      {/* Distribute leftover height around the info card, capped so sparse
          posters lift the CTA instead of stretching the gaps. */}
      <div style={{ display: 'flex', flexGrow: 1, maxHeight: 190 }} />

      {/* Prize lockup */}
      {hasPrize && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 44 }}>
          {trophySvg(52, accent[400], 1.8)}
          <span style={{ fontFamily: 'Poppins', fontSize: 62, fontWeight: 700, ...goldText }}>
            {prizeStr}
          </span>
        </div>
      )}

      {/* Glass info card: dates, venue, registration deadline */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          marginTop: hasPrize ? 32 : 44,
          padding: '30px 54px',
          borderRadius: 28,
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.14)',
        }}
      >
        <span style={{ fontFamily: 'Poppins', fontSize: 38, fontWeight: 600, color: '#ffffff' }}>
          {dateStr}
        </span>
        {location && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg
              width="27"
              height="27"
              viewBox="0 0 24 24"
              fill="none"
              stroke={primary[300]}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span style={{ fontSize: 29, fontWeight: 500, color: primary[200] }}>{location}</span>
          </div>
        )}
        {deadlineStr && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 6,
              paddingTop: 18,
              borderTop: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke={accent[400]}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span
              style={{ fontFamily: 'Poppins', fontSize: 29, fontWeight: 600, color: accent[300] }}
            >
              {t('storyDeadline', { date: deadlineStr })}
            </span>
          </div>
        )}
      </div>

      {/* Badges + spots pill */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          flexWrap: 'wrap',
          maxWidth: 940,
          marginTop: 28,
        }}
      >
        {shownBadges.map((badge, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '12px 26px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.16)',
            }}
          >
            <span
              style={{ fontFamily: 'Poppins', fontSize: 25, fontWeight: 600, color: primary[100] }}
            >
              {badge}
            </span>
          </div>
        ))}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 28px',
            borderRadius: 999,
            background: spot.bg,
            border: `1.5px solid ${spot.border}`,
          }}
        >
          <div style={{ width: 13, height: 13, borderRadius: 7, background: spot.dot }} />
          <span style={{ fontFamily: 'Poppins', fontSize: 25, fontWeight: 600, color: spot.text }}>
            {pillText}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexGrow: 1, maxHeight: 190 }} />

      {/* Footer action card: CTA, link and QR as one centered unit */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 34,
          padding: '26px 38px',
          borderRadius: 30,
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.14)',
          marginBottom: 204,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '22px 54px',
              borderRadius: 999,
              background: 'linear-gradient(90deg, #f2554b, #ed6c6e)',
              boxShadow: '0 14px 44px rgba(242,85,75,0.4)',
            }}
          >
            <span
              style={{ fontFamily: 'Poppins', fontSize: 34, fontWeight: 700, color: '#ffffff' }}
            >
              {t('storyCta')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg
              width="25"
              height="25"
              viewBox="0 0 24 24"
              fill="none"
              stroke={primary[300]}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span
              style={{ fontFamily: 'Poppins', fontSize: 26, fontWeight: 600, color: primary[200] }}
            >
              {linkLabel}
            </span>
          </div>
        </div>
        {qrSrc && (
          <div
            style={{
              width: 1,
              alignSelf: 'stretch',
              background: 'rgba(255,255,255,0.14)',
              display: 'flex',
            }}
          />
        )}
        {qrSrc && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: '12px 12px 10px 12px',
              borderRadius: 18,
              background: '#ffffff',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} width={132} height={132} style={{ width: 132, height: 132 }} />
            <span
              style={{ fontFamily: 'Poppins', fontSize: 17, fontWeight: 600, color: primary[950] }}
            >
              {t('storyScan')}
            </span>
          </div>
        )}
      </div>
    </div>,
    { ...STORY_SIZE, fonts, headers: CACHE_HEADERS }
  );
}

// ---------------------------------------------------------------------------
// Generic invite card (referral / match / group / community)
// ---------------------------------------------------------------------------

async function inviteImage(code: string, locale: string, fonts: Fonts) {
  const t = await getTranslations({ locale, namespace: 'invitePage' });
  const inviter = await getInviter(code);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(150deg, ${primary[900]} 0%, ${primary[700]} 50%, ${primary[500]} 100%)`,
        fontFamily: 'Inter',
        padding: '0 56px',
        position: 'relative',
      }}
    >
      {/* Accent gradient bar at top */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 5,
          display: 'flex',
          background: 'linear-gradient(90deg, #6bdcc9, #f5b535, #f2554b)',
        }}
      />

      {/* Top bar: Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingTop: 36,
          paddingBottom: 20,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} height={40} style={{ height: 40, objectFit: 'contain' }} />
      </div>

      {/* Main card */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: 24,
          border: '1px solid rgba(255,255,255,0.15)',
          padding: '48px 56px',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
        }}
      >
        {/* Invite icon */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 80,
            height: 80,
            borderRadius: 40,
            background: 'rgba(255,255,255,0.15)',
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke={primary[300]}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" />
            <line x1="22" y1="11" x2="16" y2="11" />
          </svg>
        </div>

        {/* Heading */}
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: 48,
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1.2,
            textAlign: 'center',
          }}
        >
          {inviter?.first_name
            ? t('invitedBy', { name: inviter.first_name })
            : t('invitedByGeneric')}
        </span>

        {/* Subheading */}
        <span
          style={{
            fontSize: 26,
            fontWeight: 500,
            color: primary[200],
            textAlign: 'center',
          }}
        >
          {t('description')}
        </span>
      </div>

      {/* Bottom branding */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: 18,
          paddingBottom: 24,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.35)' }}>
          rallia.app
        </span>
      </div>
    </div>,
    { ...SIZE, fonts, headers: CACHE_HEADERS }
  );
}
