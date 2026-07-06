import { ImageResponse } from 'next/og';
import { primary } from '@rallia/design-system';

/** Standard OG image dimensions — 1200×630 (1.91:1) for Twitter / Facebook / LinkedIn. */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = 'image/png';

const poppinsBoldPromise = fetch(
  new URL('https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7V1s.ttf')
).then(res => res.arrayBuffer());

const interMediumPromise = fetch(
  new URL(
    'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf'
  )
).then(res => res.arrayBuffer());

export interface OgTemplateOptions {
  /** Small label across the top (e.g. "GUIDE", "GAMES", "ABOUT"). Uppercase recommended. */
  eyebrow?: string;
  /** Main heading — the page title. Keep under ~80 chars for legibility. */
  title: string;
  /** Optional subline below the title (≤120 chars). */
  subtitle?: string;
  /** Footer tag — defaults to the Rallia tagline. */
  footer?: string;
}

/**
 * Renders a branded 1200×630 OG image using the same teal gradient and type
 * stack as the root opengraph-image. Centralized so per-page OGs stay
 * visually consistent across the marketing surface.
 */
export async function renderOgImage(opts: OgTemplateOptions): Promise<Response> {
  const [poppinsBold, interMedium] = await Promise.all([poppinsBoldPromise, interMediumPromise]);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '72px 88px',
        background: `linear-gradient(145deg, ${primary[950]} 0%, ${primary[800]} 60%, ${primary[600]} 100%)`,
        fontFamily: 'Inter',
      }}
    >
      {/* Top row — brand mark + eyebrow */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: 40,
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '0.01em',
          }}
        >
          Rallia
        </span>
        {opts.eyebrow ? (
          <span
            style={{
              fontSize: 18,
              fontWeight: 500,
              color: primary[400],
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              border: '1px solid rgba(45, 212, 191, 0.4)',
              borderRadius: 999,
              padding: '8px 16px',
            }}
          >
            {opts.eyebrow}
          </span>
        ) : null}
      </div>

      {/* Spacer that pushes the title block to the visual center-bottom */}
      <div style={{ display: 'flex', flexGrow: 1 }} />

      {/* Title + optional subtitle */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <span
          style={{
            fontFamily: 'Poppins',
            fontSize: 64,
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            maxWidth: 980,
          }}
        >
          {opts.title}
        </span>
        {opts.subtitle ? (
          <span
            style={{
              fontSize: 26,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.72)',
              lineHeight: 1.35,
              maxWidth: 960,
            }}
          >
            {opts.subtitle}
          </span>
        ) : null}
      </div>

      {/* Footer tagline */}
      <div
        style={{
          display: 'flex',
          marginTop: 36,
          paddingTop: 24,
          borderTop: '1px solid rgba(255,255,255,0.12)',
        }}
      >
        <span
          style={{
            fontSize: 20,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.55)',
          }}
        >
          {opts.footer ?? 'Tennis & Pickleball Matchmaking · rallia.app'}
        </span>
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        { name: 'Poppins', data: poppinsBold, style: 'normal' as const, weight: 700 as const },
        { name: 'Inter', data: interMedium, style: 'normal' as const, weight: 500 as const },
      ],
    }
  );
}
