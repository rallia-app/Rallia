import { ImageResponse } from 'next/og';
import { primary } from '@rallia/design-system';

import { loadOgFonts } from '@/lib/og-fonts';

export const alt = 'Rallia - Where Rallies Live On';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  const { poppinsBold: poppinsBoldData, interMedium: interMediumData } = await loadOgFonts();

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(145deg, ${primary[950]} 0%, ${primary[800]} 60%, ${primary[600]} 100%)`,
        fontFamily: 'Inter',
        gap: 24,
      }}
    >
      <span
        style={{
          fontFamily: 'Poppins',
          fontSize: 72,
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: '0.02em',
        }}
      >
        Rallia
      </span>
      <span
        style={{
          fontSize: 32,
          fontWeight: 500,
          color: primary[400],
        }}
      >
        Where Rallies Live On
      </span>
      <span
        style={{
          fontSize: 22,
          fontWeight: 500,
          color: 'rgba(255,255,255,0.5)',
          marginTop: 8,
        }}
      >
        Tennis & Pickleball Matchmaking
      </span>
    </div>,
    {
      ...size,
      fonts: [
        { name: 'Poppins', data: poppinsBoldData, style: 'normal' as const, weight: 700 as const },
        { name: 'Inter', data: interMediumData, style: 'normal' as const, weight: 500 as const },
      ],
    }
  );
}
