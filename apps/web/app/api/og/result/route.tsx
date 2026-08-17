/**
 * Result poster for a finished tournament, 9:16, shared to a story.
 *
 * Keyed on the registration uuid: unguessable, and it renders strictly what
 * the bracket already shows any participant (name, placement, record). The
 * derivation lives in tournament_result_for_share, which refuses anything not
 * completed and any entry that forfeited.
 *
 * Spec: specs/17-leagues-tournaments/result-share.md
 */
import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { primary, neutral, accent } from '@rallia/design-system';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { locales, defaultLocale } from '@rallia/shared-translations';

import {
  STORY_SIZE,
  IMMUTABLE_CACHE_HEADERS,
  qrDataUri,
  storyBackdrop,
  storyHeader,
  storyFooter,
  type Fonts,
} from '../_shared/story-frame';

import { createServiceRoleClient } from '@/lib/supabase/server';
import { formatDateRange } from '@/lib/format-date-range';
import { loadOgFonts } from '@/lib/og-fonts';

export const revalidate = false;

/** The web Database type deliberately omits the mobile-only tournament tables. */
function untypedServiceRoleClient(): SupabaseClient {
  return createServiceRoleClient();
}

interface ResultRow {
  registration_id: string;
  tournament_id: string;
  display_name: string | null;
  partner_name: string | null;
  avatar_url: string | null;
  referral_code: string | null;
  stage: 'knockout' | 'pool' | 'none';
  placement: string;
  pool_letter: string | null;
  pool_rank: number | null;
  wins: number;
  losses: number;
  best_win_name: string | null;
  best_win_seed: number | null;
  points: number | null;
  seed_rank: number | null;
  field_size: number;
}

interface TournamentLite {
  name: string;
  start_date: string;
  end_date: string;
  city: string | null;
  venue_name: string | null;
  sport: { name: string } | null;
}

async function getResult(registrationId: string): Promise<ResultRow | null> {
  const { data, error } = await untypedServiceRoleClient().rpc('tournament_result_for_share', {
    p_registration_id: registrationId,
  });
  if (error || !data || (data as ResultRow[]).length === 0) return null;
  return (data as ResultRow[])[0];
}

async function getTournament(id: string): Promise<TournamentLite | null> {
  const { data, error } = await untypedServiceRoleClient()
    .from('tournaments')
    .select('name, start_date, end_date, city, venue_name, sport:sport_id (name)')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return data as unknown as TournamentLite;
}

/** Placement drives the whole poster's temperature. */
const TONE: Record<string, { text: string; glow: string; ring: string }> = {
  champion: { text: accent[400], glow: 'rgba(245,181,53,0.30)', ring: 'rgba(245,181,53,0.55)' },
  finalist: { text: '#e2e8f0', glow: 'rgba(226,232,240,0.20)', ring: 'rgba(226,232,240,0.45)' },
  semifinal: { text: primary[300], glow: 'rgba(107,220,201,0.20)', ring: 'rgba(107,220,201,0.45)' },
  quarterfinal: {
    text: primary[300],
    glow: 'rgba(107,220,201,0.18)',
    ring: 'rgba(107,220,201,0.40)',
  },
};
const NEUTRAL_TONE = {
  text: neutral[200],
  glow: 'rgba(255,255,255,0.10)',
  ring: 'rgba(255,255,255,0.28)',
};

const PLACEMENT_KEY: Record<string, string> = {
  champion: 'champion',
  finalist: 'finalist',
  semifinal: 'semifinal',
  quarterfinal: 'quarterfinal',
  round_of_16: 'roundOf16',
  round_of_32: 'roundOf32',
  round_of_64: 'roundOf64',
  participated: 'participated',
};

const trophyGlyph = (size: number, stroke: string) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={stroke}
    strokeWidth={1.6}
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

const medalGlyph = (size: number, stroke: string) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={stroke}
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.61 2.14a2 2 0 0 1 .13 2.2L16.79 15" />
    <path d="M11 12 5.12 2.2" />
    <path d="m13 12 5.88-9.8" />
    <path d="M8 7h8" />
    <circle cx="12" cy="17" r="5" />
    <path d="M12 18v-2h-.5" />
  </svg>
);

const statTile = (value: string, label: string, color: string) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
      padding: '20px 40px',
      borderRadius: 24,
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.13)',
      minWidth: 176,
    }}
  >
    <span style={{ fontFamily: 'Poppins', fontSize: 62, fontWeight: 700, color, lineHeight: 1.1 }}>
      {value}
    </span>
    <span
      style={{
        fontFamily: 'Poppins',
        fontSize: 21,
        fontWeight: 600,
        color: neutral[400],
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
      }}
    >
      {label}
    </span>
  </div>
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const reg = searchParams.get('reg') ?? '';
  const localeParam = searchParams.get('locale') ?? '';
  const locale = (locales as readonly string[]).includes(localeParam) ? localeParam : defaultLocale;
  const shareToken = searchParams.get('share') ?? '';

  if (!reg) return new Response('Not found', { status: 404 });

  const result = await getResult(reg);
  if (!result) return new Response('Not found', { status: 404 });

  const tournament = await getTournament(result.tournament_id);
  if (!tournament) return new Response('Not found', { status: 404 });

  const t = await getTranslations({ locale, namespace: 'tournamentResultOg' });

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

  const tone = TONE[result.placement] ?? NEUTRAL_TONE;
  const isChampion = result.placement === 'champion';
  const placementLabel = t(
    `placement.${PLACEMENT_KEY[result.placement] ?? 'participated'}` as 'placement.participated'
  );

  // A pool exit has no bracket round to name, and the ladder calls it
  // "participated" — a deflating word to hand someone as their headline. Their
  // pool finish is the real result, so it becomes the hero instead.
  const poolLine =
    result.stage === 'pool' && result.pool_rank && result.pool_letter
      ? t('poolFinish', { rank: result.pool_rank, letter: result.pool_letter })
      : null;
  const heroLabel = poolLine ?? placementLabel;

  const rawName = tournament.name;
  const tName = rawName.length > 64 ? `${rawName.slice(0, 63)}…` : rawName;
  const playerName = [result.display_name, result.partner_name].filter(Boolean).join(' & ');
  const avatarUrl = getProfilePictureUrl(result.avatar_url ?? undefined);

  // Only an actual upset earns the line: a scalp seeded above the sharer, or
  // any seeded scalp when the sharer was unseeded.
  const showBestWin =
    !!result.best_win_name &&
    result.best_win_seed !== null &&
    (result.seed_rank === null || result.best_win_seed < result.seed_rank);

  const dateStr = formatDateRange(tournament.start_date, tournament.end_date, locale);
  const place = tournament.city ?? tournament.venue_name ?? null;
  const context = [dateStr, place, t('drawSize', { count: result.field_size })]
    .filter(Boolean)
    .join('  ·  ');

  const code = (searchParams.get('code') || result.referral_code || '').toUpperCase();
  const linkLabel = code ? `rallia.app/invite/${code}` : 'rallia.app';
  // Points at the invite landing until /events/[id] ships (spec rollout step 4).
  const qrTarget = code
    ? `https://rallia.app/invite/${encodeURIComponent(code)}?type=tournament&id=${result.tournament_id}${
        shareToken ? `&share=${encodeURIComponent(shareToken)}` : ''
      }&utm_source=result&utm_medium=qr`
    : 'https://rallia.app';
  const qrSrc = await qrDataUri(qrTarget);

  const eyebrow = tournament.sport?.name
    ? `${tournament.sport.name} · ${t('eyebrow')}`
    : t('eyebrow');

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
      }}
    >
      {storyBackdrop()}
      {storyHeader(eyebrow)}

      {/* Equal spacers above and below optically center the result block:
            unlike the invite poster there is no banner art to fill the frame. */}
      <div style={{ display: 'flex', flexGrow: 1 }} />

      {/* Tournament name: context for the result, not the hero */}
      <span
        style={{
          fontFamily: 'Poppins',
          fontSize: 38,
          fontWeight: 600,
          color: neutral[300],
          maxWidth: 900,
          textAlign: 'center',
          marginTop: 30,
        }}
      >
        {tName}
      </span>

      {/* Placement lockup */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 26,
          marginTop: 40,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 172,
            height: 172,
            borderRadius: 999,
            background: `radial-gradient(circle, ${tone.glow} 0%, transparent 70%)`,
            border: `2px solid ${tone.ring}`,
          }}
        >
          {isChampion ? trophyGlyph(88, tone.text) : medalGlyph(80, tone.text)}
        </div>
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: heroLabel.length > 18 ? 68 : 84,
            fontWeight: 700,
            color: tone.text,
            lineHeight: 1.06,
            maxWidth: 960,
            textAlign: 'center',
          }}
        >
          {heroLabel}
        </span>
      </div>

      {/* Who */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          marginTop: 44,
          padding: '18px 34px 18px 18px',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.14)',
        }}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            width={82}
            height={82}
            style={{
              width: 82,
              height: 82,
              borderRadius: 999,
              objectFit: 'cover',
              border: `2px solid ${tone.ring}`,
            }}
          />
        ) : (
          <div
            style={{
              width: 82,
              height: 82,
              borderRadius: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: primary[800],
              border: `2px solid ${tone.ring}`,
              fontFamily: 'Poppins',
              fontSize: 36,
              fontWeight: 700,
              color: '#ffffff',
            }}
          >
            {(playerName || 'R').slice(0, 1).toUpperCase()}
          </div>
        )}
        <span style={{ fontFamily: 'Poppins', fontSize: 44, fontWeight: 700, color: '#ffffff' }}>
          {playerName}
        </span>
        {result.seed_rank !== null && (
          <span
            style={{
              fontFamily: 'Poppins',
              fontSize: 24,
              fontWeight: 600,
              color: primary[200],
              padding: '8px 20px',
              borderRadius: 999,
              background: 'rgba(107,220,201,0.14)',
            }}
          >
            {t('seeded', { seed: result.seed_rank })}
          </span>
        )}
      </div>

      {/* The record */}
      <div style={{ display: 'flex', gap: 20, marginTop: 40 }}>
        {statTile(String(result.wins), t('won'), '#ffffff')}
        {statTile(String(result.losses), t('lost'), neutral[300])}
        {result.points !== null && statTile(String(result.points), t('points'), accent[400])}
      </div>

      {showBestWin && (
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: 30,
            fontWeight: 600,
            color: primary[200],
            marginTop: 28,
            maxWidth: 900,
            textAlign: 'center',
          }}
        >
          {t('bestWin', { name: result.best_win_name as string })}
        </span>
      )}

      <span
        style={{
          fontFamily: 'Inter',
          fontSize: 26,
          fontWeight: 500,
          color: neutral[400],
          marginTop: 26,
          textAlign: 'center',
        }}
      >
        {context}
      </span>

      <div style={{ display: 'flex', flexGrow: 1 }} />

      {storyFooter({
        ctaLabel: t('cta'),
        linkLabel,
        scanLabel: t('scan'),
        qrSrc,
      })}
    </div>,
    { ...STORY_SIZE, fonts, headers: IMMUTABLE_CACHE_HEADERS }
  );
}
