import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { primary, neutral, accent, secondary } from '@rallia/design-system';

import { getPlayer } from './_lib/get-player';
import type { PublicPlayer } from './_lib/get-player';

import { logoSrc } from '@/lib/og-logo';

export const alt = 'Rallia Player';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 3600;

const poppinsBold = fetch(
  new URL('https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7V1s.ttf')
).then(res => res.arrayBuffer());

const poppinsSemiBold = fetch(
  new URL('https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLEj6V1s.ttf')
).then(res => res.arrayBuffer());

const interMedium = fetch(
  new URL(
    'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf'
  )
).then(res => res.arrayBuffer());

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Brand accent trio (same as the match OG top bar)
const ACCENT_TEAL = primary[300];
const ACCENT_YELLOW = accent[400];
const ACCENT_CORAL = secondary[500];

const TIER_COLORS: Record<string, string> = {
  platinum: '#e2e8f0',
  gold: ACCENT_YELLOW,
  silver: '#cbd5e1',
  bronze: '#d9913e',
};

const SPORT_COLORS: Record<string, string> = {
  tennis: ACCENT_YELLOW,
  pickleball: ACCENT_TEAL,
};

function tierColor(tier: string): string {
  return TIER_COLORS[tier] ?? ACCENT_TEAL;
}

function sportColor(sport: string): string {
  return SPORT_COLORS[sport.toLowerCase()] ?? ACCENT_CORAL;
}

function RatingPlaque({
  sport,
  label,
  certified,
  certifiedLabel,
}: {
  sport: string;
  label: string;
  certified: boolean;
  certifiedLabel: string;
}) {
  const color = sportColor(sport);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '14px 26px 12px 22px',
        borderRadius: 16,
        background: 'rgba(0,0,0,0.25)',
        borderLeft: `6px solid ${color}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      }}
    >
      <span
        style={{
          fontSize: 16,
          fontWeight: 500,
          color,
          textTransform: 'uppercase',
          letterSpacing: '0.16em',
        }}
      >
        {capitalize(sport)}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: 38,
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        {certified ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              borderRadius: 999,
              background: `${color}26`,
              border: `1px solid ${color}66`,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span style={{ fontSize: 15, fontWeight: 500, color }}>{certifiedLabel}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Donut gauge: SVG stroke-dasharray progress ring (satori has no conic-gradient)
function ReputationRing({
  score,
  tier,
  tierLabel,
  caption,
}: {
  score: number;
  tier: string;
  tierLabel: string;
  caption: string;
}) {
  const color = tierColor(tier);
  const R = 102;
  const C = 2 * Math.PI * R;
  const progress = C * (Math.min(100, Math.max(0, score)) / 100);
  const SIZE = 252;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          position: 'relative',
          width: SIZE,
          height: SIZE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="rgba(0,0,0,0.22)"
            stroke="rgba(255,255,255,0.14)"
            strokeWidth="18"
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="18"
            strokeLinecap="round"
            strokeDasharray={`${progress} ${C}`}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <span
            style={{
              fontFamily: 'Poppins',
              fontSize: 68,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1,
            }}
          >
            {score}
          </span>
          <span
            style={{
              fontSize: 17,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.55)',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
            }}
          >
            {caption}
          </span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '8px 22px',
          borderRadius: 999,
          background: `${color}26`,
          border: `1px solid ${color}66`,
        }}
      >
        <div
          style={{ width: 11, height: 11, borderRadius: 6, background: color, display: 'flex' }}
        />
        <span style={{ fontFamily: 'Poppins', fontSize: 23, fontWeight: 600, color: '#ffffff' }}>
          {tierLabel}
        </span>
      </div>
    </div>
  );
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        flex: 1,
        padding: '26px 0 22px',
        borderRadius: 20,
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 100%)',
        border: '1px solid rgba(255,255,255,0.16)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
      }}
    >
      <span
        style={{
          fontFamily: 'Poppins',
          fontSize: 58,
          fontWeight: 700,
          color: ACCENT_YELLOW,
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 17,
          fontWeight: 500,
          color: primary[100],
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
        }}
      >
        {label}
      </span>
    </div>
  );
}

function PlayerCard({
  player,
  locale,
  t,
}: {
  player: PublicPlayer;
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const avatarUrl = getProfilePictureUrl(player.avatarUrl);
  const initials = player.name.charAt(0).toUpperCase();
  const joinedLabel = player.joinedAt
    ? capitalize(
        new Date(player.joinedAt).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
      )
    : null;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(160deg, ${primary[950]} 0%, ${primary[800]} 55%, ${primary[600]} 100%)`,
        fontFamily: 'Inter',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative glow orbs */}
      <div
        style={{
          position: 'absolute',
          top: -220,
          right: -160,
          width: 620,
          height: 620,
          borderRadius: 310,
          background: `radial-gradient(circle, ${ACCENT_TEAL}2e 0%, transparent 70%)`,
          display: 'flex',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -260,
          left: -180,
          width: 640,
          height: 640,
          borderRadius: 320,
          background: `radial-gradient(circle, ${ACCENT_CORAL}26 0%, transparent 70%)`,
          display: 'flex',
        }}
      />
      {/* Oversized ghost initial anchoring the right side */}
      <span
        style={{
          position: 'absolute',
          right: 24,
          top: -60,
          fontFamily: 'Poppins',
          fontSize: 460,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.045)',
          lineHeight: 1,
        }}
      >
        {initials}
      </span>

      {/* Accent gradient bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          display: 'flex',
          background: `linear-gradient(90deg, ${ACCENT_TEAL}, ${ACCENT_YELLOW}, ${ACCENT_CORAL})`,
        }}
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: '40px 64px 36px',
        }}
      >
        {/* Top bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <img src={logoSrc} height={46} style={{ height: 46, objectFit: 'contain' }} />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '9px 20px',
              borderRadius: 999,
              border: `1px solid ${ACCENT_TEAL}66`,
              background: 'rgba(0,0,0,0.2)',
            }}
          >
            <span
              style={{
                fontSize: 17,
                fontWeight: 500,
                color: ACCENT_TEAL,
                textTransform: 'uppercase',
                letterSpacing: '0.2em',
              }}
            >
              {t('ogEyebrow')}
            </span>
          </div>
        </div>

        {/* Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 34, flex: 1 }}>
          {/* Avatar with brand-gradient ring */}
          <div
            style={{
              display: 'flex',
              padding: 7,
              borderRadius: 999,
              background: `linear-gradient(135deg, ${ACCENT_TEAL}, ${ACCENT_YELLOW}, ${ACCENT_CORAL})`,
              boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
            }}
          >
            <div
              style={{
                width: 208,
                height: 208,
                borderRadius: 104,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                background: primary[700],
                border: `6px solid ${primary[900]}`,
              }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  width={208}
                  height={208}
                  style={{ objectFit: 'cover', width: 208, height: 208 }}
                />
              ) : (
                <span
                  style={{
                    fontFamily: 'Poppins',
                    fontSize: 88,
                    fontWeight: 700,
                    color: '#ffffff',
                  }}
                >
                  {initials}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
            <span
              style={{
                fontFamily: 'Poppins',
                fontSize: 64,
                fontWeight: 700,
                color: '#ffffff',
                lineHeight: 1.05,
                letterSpacing: '-0.01em',
              }}
            >
              {player.name}
            </span>

            {(player.city || joinedLabel) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {player.city ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg
                      width="26"
                      height="26"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={ACCENT_TEAL}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span style={{ fontSize: 27, fontWeight: 500, color: neutral[100] }}>
                      {player.city}
                    </span>
                  </div>
                ) : null}
                {player.city && joinedLabel ? (
                  <span style={{ fontSize: 24, color: 'rgba(255,255,255,0.35)' }}>·</span>
                ) : null}
                {joinedLabel ? (
                  <span style={{ fontSize: 24, fontWeight: 500, color: primary[200] }}>
                    {t('joined', { date: joinedLabel })}
                  </span>
                ) : null}
              </div>
            )}

            {/* Rating plaques — the headline credential per sport */}
            {player.ratings.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                {player.ratings.slice(0, 2).map((r, i) => (
                  <RatingPlaque
                    key={i}
                    sport={r.sportName}
                    label={r.label}
                    certified={r.isCertified}
                    certifiedLabel={t('certified')}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Reputation gauge on the right */}
          {player.reputation ? (
            <ReputationRing
              score={player.reputation.score}
              tier={player.reputation.tier}
              tierLabel={t(`tier.${player.reputation.tier}`)}
              caption={t('reputationLabel')}
            />
          ) : null}
        </div>

        {/* Stat tiles — omitted until the player has actually played (zeros sell nobody) */}
        {player.showStats && player.stats.gamesPlayed > 0 ? (
          <div style={{ display: 'flex', gap: 20 }}>
            <StatTile value={player.stats.gamesPlayed} label={t('statGamesPlayed')} />
            <StatTile value={player.stats.hoursPlayed} label={t('statHoursPlayed')} />
            <StatTile value={player.stats.weekStreak} label={t('statWeekStreak')} />
          </div>
        ) : null}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: 22,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 500, color: 'rgba(255,255,255,0.4)' }}>
            rallia.app
          </span>
        </div>
      </div>
    </div>
  );
}

export default async function Image({
  params,
}: {
  params: Promise<{ playerId: string; locale: string }>;
}) {
  const { playerId, locale } = await params;
  const player = await getPlayer(playerId);
  const t = await getTranslations({ locale, namespace: 'playerPage' });
  const [poppinsBoldData, poppinsSemiBoldData, interMediumData] = await Promise.all([
    poppinsBold,
    poppinsSemiBold,
    interMedium,
  ]);

  const fonts = [
    { name: 'Poppins', data: poppinsBoldData, style: 'normal' as const, weight: 700 as const },
    { name: 'Poppins', data: poppinsSemiBoldData, style: 'normal' as const, weight: 600 as const },
    { name: 'Inter', data: interMediumData, style: 'normal' as const, weight: 500 as const },
  ];

  if (!player) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(160deg, ${primary[950]} 0%, ${primary[700]} 100%)`,
          fontFamily: 'Poppins',
        }}
      >
        <img src={logoSrc} height={90} style={{ height: 90, objectFit: 'contain' }} />
      </div>,
      { ...size, fonts }
    );
  }

  return new ImageResponse(<PlayerCard player={player} locale={locale} t={t} />, {
    ...size,
    fonts,
  });
}
