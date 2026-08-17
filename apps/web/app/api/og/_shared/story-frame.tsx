/**
 * Chrome shared by every 9:16 story poster (tournament invite, tournament
 * result). Keeping the backdrop, the eyebrow and the footer action card in one
 * place is what stops the posters drifting into two different-looking families
 * a release from now.
 *
 * These are plain functions returning JSX, not components: satori renders the
 * element tree directly and the rest of the OG code already reads this way.
 */
import { primary, accent } from '@rallia/design-system';

import { logoSrc } from '@/lib/og-logo';

/** 9:16 Instagram/Snapchat story frame. */
export const STORY_SIZE = { width: 1080, height: 1920 };

/** Posters whose content can still change (spots left, registration status). */
export const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
};

/** A completed tournament's result never changes; cache it for good. */
export const IMMUTABLE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
};

export type Fonts = {
  name: string;
  data: ArrayBuffer;
  style: 'normal';
  weight: 500 | 600 | 700;
}[];

/** QR for the full link — stories get screenshotted and printed, and a scan
 *  survives both. The `qrcode` lib emits plain SVG; qrcode.react cannot be
 *  used here (react-dom/server has a null hooks dispatcher in a route). */
export async function qrDataUri(value: string): Promise<string | null> {
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

export const eyebrowDash = (color: string) => (
  <div style={{ width: 42, height: 5, borderRadius: 3, background: color, display: 'flex' }} />
);

/**
 * Gradient, ambient glows, perspective court lines, vignette and accent bar.
 * Render it as the first child of the poster root; content paints over it.
 */
export function storyBackdrop() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        background: `linear-gradient(175deg, #021b1a 0%, ${primary[950]} 38%, #0a4e48 78%, #0d5a52 100%)`,
      }}
    >
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
    </div>
  );
}

/** Logo plus the dashed uppercase eyebrow, inset below Instagram's own header. */
export function storyHeader(eyebrow: string, paddingTop = 176) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 30,
        paddingTop,
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
          {eyebrow}
        </span>
        {eyebrowDash(accent[400])}
      </div>
    </div>
  );
}

/**
 * Footer action card: CTA pill, the readable link, and the QR as one centered
 * unit. The link is rendered as text so a screenshot of a screenshot still
 * carries attribution.
 */
export function storyFooter({
  ctaLabel,
  linkLabel,
  scanLabel,
  qrSrc,
}: {
  ctaLabel: string;
  linkLabel: string;
  scanLabel: string;
  qrSrc: string | null;
}) {
  return (
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
          <span style={{ fontFamily: 'Poppins', fontSize: 34, fontWeight: 700, color: '#ffffff' }}>
            {ctaLabel}
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
            {scanLabel}
          </span>
        </div>
      )}
    </div>
  );
}
