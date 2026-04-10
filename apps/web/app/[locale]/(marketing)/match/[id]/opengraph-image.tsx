import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTranslations } from 'next-intl/server';
import { getMatch } from './_lib/get-match';

export const alt = 'Rallia Match';
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

export default async function Image({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const match = await getMatch(id);
  const t = await getTranslations({ locale, namespace: 'gamesPage' });
  const logoSvgPath = join(process.cwd(), 'public/rallia-logo-light-inline.svg');
  const [poppinsBoldData, poppinsSemiBoldData, interMediumData, logoSvgBuf] = await Promise.all([
    poppinsBold,
    poppinsSemiBold,
    interMedium,
    readFile(logoSvgPath),
  ]);
  const logoSrc = `data:image/svg+xml;base64,${logoSvgBuf.toString('base64')}`;

  const fonts = [
    { name: 'Poppins', data: poppinsBoldData, style: 'normal' as const, weight: 700 as const },
    { name: 'Poppins', data: poppinsSemiBoldData, style: 'normal' as const, weight: 600 as const },
    { name: 'Inter', data: interMediumData, style: 'normal' as const, weight: 500 as const },
  ];

  if (!match) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f766e',
          fontFamily: 'Poppins',
        }}
      >
        <span style={{ fontSize: 56, fontWeight: 700, color: '#ffffff' }}>Rallia</span>
      </div>,
      { ...size, fonts }
    );
  }

  // ---------- Derived values ----------
  const sportName = match.sport?.name ?? 'Match';
  const facilityName = match.facility?.name;
  const city = match.facility?.city;
  const location = facilityName
    ? `${facilityName}${city ? `, ${city}` : ''}`
    : (match.location_name ?? '');
  const dateObj = new Date(`${match.match_date}T${match.start_time}`);
  const dateStr = dateObj.toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = dateObj.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  let endTimeStr = '';
  if (match.end_time) {
    const endObj = new Date(`${match.match_date}T${match.end_time}`);
    endTimeStr = ` \u2013 ${endObj.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
  }

  const total = match.format === 'doubles' ? 4 : 2;
  const joined = match.participants?.filter(p => p.status === 'joined') ?? [];
  const joinedCount = joined.length;
  const spotsLeft = Math.max(0, total - joinedCount);
  const isFull = spotsLeft === 0;

  const spotsColor = isFull ? '#dc2626' : spotsLeft === 1 ? '#d97706' : '#059669';
  const spotsBg = isFull ? '#fef2f2' : spotsLeft === 1 ? '#fffbeb' : '#ecfdf5';
  const spotsDot = isFull ? '#ef4444' : spotsLeft === 1 ? '#f59e0b' : '#10b981';
  const spotsText = isFull ? t('matchFull') : t('spotsLeft', { count: spotsLeft });

  // Sort host first
  const sorted = [...joined].sort((a, b) => (b.is_host ? 1 : 0) - (a.is_host ? 1 : 0));
  const slots = Array.from({ length: total }, (_, i) => {
    const participant = sorted[i];
    return {
      filled: !!participant,
      avatarUrl: participant?.player?.profile?.profile_picture_url ?? null,
      initials: participant?.player?.profile?.display_name?.charAt(0).toUpperCase() ?? null,
    };
  });

  // Build attribute badges
  const attributes: string[] = [];
  attributes.push(match.format === 'doubles' ? t('doubles') : t('singles'));
  if (match.player_expectation && match.player_expectation !== 'both') {
    attributes.push(match.player_expectation === 'competitive' ? t('competitive') : t('casual'));
  }
  if (match.min_rating_score) {
    attributes.push(match.min_rating_score.label);
  }
  if (match.court_status === 'reserved') {
    attributes.push(t('courtBooked'));
  }
  if (match.is_court_free) {
    attributes.push(t('free'));
  } else if (match.estimated_cost) {
    attributes.push(t('costPerPlayer', { amount: Math.ceil(match.estimated_cost / total) }));
  }

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(150deg, #134e4a 0%, #0f766e 50%, #14b8a6 100%)',
        fontFamily: 'Inter',
        padding: '0 56px',
        position: 'relative',
      }}
    >
      {/* Accent gradient bar at very top */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 5,
          display: 'flex',
          background: 'linear-gradient(90deg, #5eead4, #fbbf24, #ed6a6d)',
        }}
      />

      {/* Top bar: Sport + Rallia */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 36,
          paddingBottom: 20,
        }}
      >
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: 20,
            fontWeight: 600,
            color: '#99f6e4',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
          }}
        >
          {sportName}
        </span>
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
          padding: '40px 48px',
          justifyContent: 'space-between',
        }}
      >
        {/* Date + Time */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span
            style={{
              fontFamily: 'Poppins',
              fontSize: 52,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1.15,
              textTransform: 'capitalize',
            }}
          >
            {dateStr}
          </span>
          <span style={{ fontSize: 30, fontWeight: 500, color: '#99f6e4' }}>
            {timeStr}
            {endTimeStr}
          </span>
        </div>

        {/* Location */}
        {location && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ccfbf1"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span style={{ fontSize: 26, fontWeight: 500, color: '#e5e5e5' }}>{location}</span>
          </div>
        )}

        {/* Match attributes row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {attributes.map(attr => (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 20px',
                borderRadius: 10,
                background: 'rgba(0,0,0,0.15)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <span style={{ fontSize: 18, fontWeight: 500, color: '#ccfbf1' }}>{attr}</span>
            </div>
          ))}
        </div>

        {/* Bottom row: Avatars + count on left, spots pill on right */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Avatars + count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {/* Overlapping avatar stack */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {slots.map((slot, i) => (
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    marginLeft: i === 0 ? 0 : -12,
                    background: slot.filled
                      ? slot.avatarUrl
                        ? '#0f766e'
                        : '#14b8a6'
                      : 'rgba(255,255,255,0.06)',
                    border: slot.filled
                      ? '3px solid rgba(15,118,110,0.6)'
                      : '2px solid rgba(255,255,255,0.15)',
                  }}
                >
                  {slot.filled ? (
                    slot.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={slot.avatarUrl}
                        width={56}
                        height={56}
                        style={{ objectFit: 'cover', width: 56, height: 56 }}
                      />
                    ) : (
                      <span
                        style={{
                          fontFamily: 'Poppins',
                          fontSize: 20,
                          fontWeight: 700,
                          color: '#ffffff',
                        }}
                      >
                        {slot.initials}
                      </span>
                    )
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="rgba(255,255,255,0.3)"
                      strokeWidth="2"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  )}
                </div>
              ))}
            </div>

            {/* Player count text */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span
                style={{
                  fontFamily: 'Poppins',
                  fontSize: 28,
                  fontWeight: 700,
                  color: '#ffffff',
                  lineHeight: 1,
                }}
              >
                {joinedCount}/{total}
              </span>
              <span style={{ fontSize: 16, fontWeight: 500, color: '#ccfbf1' }}>
                {t('playersJoined')}
              </span>
            </div>
          </div>

          {/* Spots status pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 26px',
              borderRadius: 100,
              background: spotsBg,
            }}
          >
            <div style={{ width: 10, height: 10, borderRadius: 5, background: spotsDot }} />
            <span
              style={{ fontFamily: 'Poppins', fontSize: 19, fontWeight: 600, color: spotsColor }}
            >
              {spotsText}
            </span>
          </div>
        </div>
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
    { ...size, fonts }
  );
}
