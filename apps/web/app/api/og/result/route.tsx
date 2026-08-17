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

/**
 * Placement drives the whole poster's temperature: hero colour, badge ring,
 * the halo circles behind the badge, and the ghost numeral bleeding off the
 * right edge.
 */
interface Tone {
  text: string;
  glow: string;
  /** Badge border. */
  ring: string;
  /** Innermost halo circle, a softer read of the same hue. */
  halo: string;
  /** The giant numeral behind everything. Barely there on purpose. */
  ghost: string;
}

const TONE: Record<string, Tone> = {
  champion: {
    text: accent[400],
    glow: 'rgba(245,181,53,0.32)',
    ring: 'rgba(245,181,53,0.60)',
    halo: 'rgba(245,181,53,0.30)',
    ghost: 'rgba(245,181,53,0.07)',
  },
  finalist: {
    text: '#e2e8f0',
    glow: 'rgba(226,232,240,0.20)',
    ring: 'rgba(226,232,240,0.50)',
    halo: 'rgba(226,232,240,0.30)',
    ghost: 'rgba(226,232,240,0.05)',
  },
  semifinal: {
    text: primary[300],
    glow: 'rgba(107,220,201,0.20)',
    ring: 'rgba(107,220,201,0.50)',
    halo: 'rgba(107,220,201,0.30)',
    ghost: 'rgba(107,220,201,0.055)',
  },
  quarterfinal: {
    text: primary[300],
    glow: 'rgba(107,220,201,0.18)',
    ring: 'rgba(107,220,201,0.50)',
    halo: 'rgba(107,220,201,0.30)',
    ghost: 'rgba(107,220,201,0.055)',
  },
};
const NEUTRAL_TONE: Tone = {
  text: neutral[200],
  glow: 'rgba(255,255,255,0.10)',
  ring: 'rgba(255,255,255,0.32)',
  halo: 'rgba(255,255,255,0.30)',
  ghost: 'rgba(255,255,255,0.045)',
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

/** How many were left standing at that round: the ghost numeral's whole point. */
const GHOST_GLYPH: Record<string, string> = {
  champion: '1',
  finalist: '2',
  semifinal: '4',
  quarterfinal: '8',
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

/** The badge's centre in the finished frame; every halo layer keys off it. */
const BADGE_CX = 540;
const BADGE_CY = 742;

/** The round's survivor count, set huge and bled off the right edge. */
const ghostNumeral = (glyph: string, color: string) => (
  <div
    style={{
      position: 'absolute',
      right: -40,
      top: 150,
      display: 'flex',
      fontFamily: 'Poppins',
      fontStyle: 'italic',
      fontWeight: 800,
      fontSize: 640,
      lineHeight: 1,
      color,
    }}
  >
    {glyph}
  </div>
);

/** Concentric rings radiating out of the badge, fading as they go. */
const haloCircles = (halo: string) => (
  <svg
    width="1080"
    height="1920"
    viewBox="0 0 1080 1920"
    fill="none"
    style={{ position: 'absolute', top: 0, left: 0 }}
  >
    <circle cx={BADGE_CX} cy={BADGE_CY} r={150} stroke={halo} strokeWidth={3} />
    <circle cx={BADGE_CX} cy={BADGE_CY} r={250} stroke="rgba(255,255,255,0.09)" strokeWidth={2} />
    <circle cx={BADGE_CX} cy={BADGE_CY} r={380} stroke="rgba(255,255,255,0.06)" strokeWidth={2} />
    <circle cx={BADGE_CX} cy={BADGE_CY} r={540} stroke="rgba(255,255,255,0.04)" strokeWidth={2} />
  </svg>
);

/** Champion only: short spokes fanning off the top of the badge. */
const championRays = () => (
  <svg
    width="1080"
    height="1920"
    viewBox="0 0 1080 1920"
    fill="none"
    style={{ position: 'absolute', top: 0, left: 0 }}
  >
    <g stroke="rgba(245,181,53,0.5)" strokeWidth={4} strokeLinecap="round">
      <path d="M540 528 L540 488" />
      <path d="M647 557 L667 522" />
      <path d="M725 635 L760 615" />
      <path d="M433 557 L413 522" />
      <path d="M355 635 L320 615" />
    </g>
  </svg>
);

/** Champion only. Fixed placements: the render has to stay deterministic. */
const CONFETTI: {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  color: string;
  opacity: number;
  round?: boolean;
}[] = [
  { x: 148, y: 424, w: 16, h: 22, rot: 22, color: '#f5b535', opacity: 0.75 },
  { x: 872, y: 470, w: 15, h: 21, rot: -18, color: '#f2554b', opacity: 0.7 },
  { x: 248, y: 610, w: 14, h: 20, rot: 40, color: '#f2554b', opacity: 0.65 },
  { x: 938, y: 702, w: 12, h: 12, rot: 0, color: '#f5b535', opacity: 0.7, round: true },
  { x: 182, y: 866, w: 13, h: 13, rot: 0, color: '#6bdcc9', opacity: 0.6, round: true },
  { x: 818, y: 922, w: 15, h: 21, rot: 14, color: '#ffffff', opacity: 0.5 },
  { x: 110, y: 1058, w: 15, h: 20, rot: -32, color: '#f5b535', opacity: 0.7 },
  { x: 950, y: 1120, w: 14, h: 20, rot: 26, color: '#6bdcc9', opacity: 0.6 },
];

const confetti = () =>
  CONFETTI.map((c, i) => (
    <div
      key={i}
      style={{
        position: 'absolute',
        left: c.x,
        top: c.y,
        width: c.w,
        height: c.h,
        display: 'flex',
        background: c.color,
        opacity: c.opacity,
        borderRadius: c.round ? 999 : 2,
        transform: `rotate(${c.rot}deg)`,
      }}
    />
  ));

type TileVariant = 'gold' | 'solid' | 'muted' | 'accent';

/** Skewed to match the seed pill; the content counter-skews back to upright. */
const TILE: Record<TileVariant, { bg: string; border: string; value: string; label: string }> = {
  gold: {
    bg: 'linear-gradient(100deg, #ffc94d, #f5b535)',
    border: 'none',
    value: '#2b1a04',
    label: '#4e3108',
  },
  solid: {
    bg: 'rgba(255,255,255,0.09)',
    border: '1px solid rgba(255,255,255,0.2)',
    value: '#ffffff',
    label: neutral[400],
  },
  muted: {
    bg: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.13)',
    value: neutral[300],
    label: neutral[400],
  },
  accent: {
    bg: 'rgba(255,255,255,0.09)',
    border: '1px solid rgba(255,255,255,0.2)',
    value: accent[400],
    label: neutral[400],
  },
};

const statTile = (value: string, label: string, variant: TileVariant) => {
  const s = TILE[variant];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '22px 48px',
        borderRadius: 14,
        background: s.bg,
        border: s.border,
        minWidth: 180,
        transform: 'skewX(-8deg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          transform: 'skewX(8deg)',
        }}
      >
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: 66,
            fontWeight: 700,
            color: s.value,
            lineHeight: 1.1,
          }}
        >
          {value}
        </span>
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: 21,
            fontWeight: 600,
            color: s.label,
            textTransform: 'uppercase',
            letterSpacing: '3px',
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
};

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
    poppinsExtraBoldItalic: poppinsExtraBoldItalicData,
    interMedium: interMediumData,
  } = await loadOgFonts();
  const fonts: Fonts = [
    { name: 'Poppins', data: poppinsBoldData, style: 'normal', weight: 700 },
    { name: 'Poppins', data: poppinsSemiBoldData, style: 'normal', weight: 600 },
    { name: 'Poppins', data: poppinsExtraBoldItalicData, style: 'italic', weight: 800 },
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

  // A pool finish names its own number, so the ghost mirrors it; a bracket exit
  // shows how many were still alive at that round. Deeper rounds get nothing:
  // "16" bleeding off the edge says less than empty space does.
  const ghostGlyph =
    result.stage === 'pool' && result.pool_rank
      ? String(result.pool_rank)
      : (GHOST_GLYPH[result.placement] ?? null);

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
      {ghostGlyph && ghostNumeral(ghostGlyph, tone.ghost)}
      {haloCircles(tone.halo)}
      {isChampion && championRays()}
      {isChampion && confetti()}
      {storyHeader(eyebrow)}

      {/* Equal spacers above and below optically center the result block:
            unlike the invite poster there is no banner art to fill the frame. */}
      <div style={{ display: 'flex', flexGrow: 1 }} />

      {/* Tournament name: context for the result, not the hero */}
      <span
        style={{
          fontFamily: 'Poppins',
          fontSize: 33,
          fontWeight: 600,
          color: neutral[300],
          textTransform: 'uppercase',
          letterSpacing: '3px',
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
            width: 196,
            height: 196,
            borderRadius: 999,
            background: `radial-gradient(circle, ${tone.glow} 0%, transparent 70%)`,
            border: `3px solid ${tone.ring}`,
          }}
        >
          {isChampion ? trophyGlyph(88, tone.text) : medalGlyph(80, tone.text)}
        </div>
        <span
          style={{
            fontFamily: 'Poppins',
            fontStyle: 'italic',
            fontSize: heroLabel.length > 12 ? 96 : 124,
            fontWeight: 800,
            color: tone.text,
            textTransform: 'uppercase',
            textShadow: `0 0 80px ${tone.glow}, 0 12px 40px rgba(2,27,26,0.7)`,
            lineHeight: 1.06,
            maxWidth: 990,
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
        {/* flexShrink:0 or a long name wraps to two lines inside the pill. */}
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: 44,
            fontWeight: 700,
            color: '#ffffff',
            flexShrink: 0,
          }}
        >
          {playerName}
        </span>
        {result.seed_rank !== null && (
          <div
            style={{
              display: 'flex',
              padding: '8px 22px',
              borderRadius: 6,
              background: 'rgba(107,220,201,0.16)',
              border: '1px solid rgba(107,220,201,0.3)',
              transform: 'skewX(-10deg)',
            }}
          >
            <span
              style={{
                fontFamily: 'Poppins',
                fontSize: 24,
                fontWeight: 600,
                color: primary[200],
                transform: 'skewX(10deg)',
              }}
            >
              {t('seeded', { seed: result.seed_rank })}
            </span>
          </div>
        )}
      </div>

      {/* The record */}
      <div style={{ display: 'flex', gap: 20, marginTop: 40 }}>
        {statTile(String(result.wins), t('won'), isChampion ? 'gold' : 'solid')}
        {statTile(String(result.losses), t('lost'), 'muted')}
        {result.points !== null && statTile(String(result.points), t('points'), 'accent')}
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
