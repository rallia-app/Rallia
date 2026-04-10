import { ImageResponse } from 'next/og';

export const alt = 'Rallia - Where Rallies Live On';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const poppinsBold = fetch(
  new URL('https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7V1s.ttf')
).then(res => res.arrayBuffer());

const interMedium = fetch(
  new URL(
    'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf'
  )
).then(res => res.arrayBuffer());

export default async function Image() {
  const [poppinsBoldData, interMediumData] = await Promise.all([poppinsBold, interMedium]);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(145deg, #042f2e 0%, #115e59 60%, #0d9488 100%)',
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
          color: '#2dd4bf',
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
