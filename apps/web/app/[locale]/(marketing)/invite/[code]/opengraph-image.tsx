import { ImageResponse } from 'next/og';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const alt = 'Join me on Rallia';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 3600;

const poppinsBold = fetch(
  new URL('https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7V1s.ttf')
).then(res => res.arrayBuffer());

const interMedium = fetch(
  new URL(
    'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf'
  )
).then(res => res.arrayBuffer());

// Inline base64-encoded logo SVG to avoid filesystem/network issues on Vercel serverless
const LOGO_BASE64 =
  'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyAgIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgdmlld0JveD0iMCAwIDEzMzAuNjUgNTE4LjMyIj4KICA8cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNMTU4LjA2LDEzOS44N2MxNDcuNDksMTUuNDMsMTg1LjE5LDE1OS44LDU1LjE3LDIzMC45OWw4MC44MywxNDIuMjUtMTAzLjAxLTMuNWMtMTQuMzktOC43MS01My4xOC0xMTIuNTgtNjkuODctMTI4LjA2LTkuMjUtOC41OC0xMy4wNy04Ljg3LTI1LjYxLTcuNDR2MTM5LjA4SDBWMTM4LjMyYzQ4LjU2LS4yNiwxMTEuNjYtMy4zLDE1OC4wNiwxLjU1aDBaTTE4OS40LDIyOS40NWMtMTUuOTctMTUuOTYtNzEuMDEtNi42Mi05My44Ni01LjA5djg3LjkxYzMzLjUxLTEuMjYsOTUuNDYsMTIuMjQsMTAzLjA2LTMzLjM2LDEuOTItMTEuNTItMS4wNS0zNy4zMi05LjE5LTQ1LjQ2aC0uMDFaIi8+CiAgPHJlY3QgZmlsbD0iI2ZmZmZmZiIgeD0iNjQ2Ljk0IiB5PSIxMjUuMjQiIHdpZHRoPSI5NS41NyIgaGVpZ2h0PSIzODcuOTYiLz4KICA8cmVjdCBmaWxsPSIjZmZmZmZmIiB4PSI3NzkuMjciIHk9IjEyNS4yNCIgd2lkdGg9Ijk1LjU3IiBoZWlnaHQ9IjM4Ny45NiIvPgogIDxyZWN0IGZpbGw9IiNmZmZmZmYiIHg9IjkwNC4yNSIgeT0iMjIwLjM5IiB3aWR0aD0iOTUuNTciIGhlaWdodD0iMjkyLjgiLz4KICA8cGF0aCBmaWxsPSIjZmRkNDRlIiBkPSJNOTUyLjQ2LDg0LjE1YzY2LjAxLTMuNDksNzIuMDUsOTQuODgsNS4wNyw5OC4xNy03Mi44NCwzLjU4LTgwLjkzLTk0LjE1LTUuMDctOTguMTdaIi8+CiAgPHBhdGggZmlsbD0iI2ZkZDQ0ZSIgZD0iTTg5Ni42OSw3NS44MWMtMTIyLjU1LTIzLjIyLTQyMy43OS0xMDAuOTQtNDk1LjQzLDM1LjE3LTUuNDEsMTAuMzItOS40OCwyMS41OS0xMi42NCwzMy4zNC0uNTEtMTIuMTYuNzgtMjQuNTUsNC4wNi0zNi42NywyLjQ1LTkuMTIsNi4xMy0xOC4xMiwxMC45MS0yNi4zNSwyNC40OC00Mi41Niw3Mi43Ny02NC4zLDExOS4wNy03My45MiwxMjAuMzYtMjMuODgsMjY2LjQsMTMuMTcsMzc0LjAzLDY4LjQzaDBaIi8+CiAgPHBhdGggZmlsbD0iI2ZkZDQ0ZSIgZD0iTTg3OS41LDEwNi4yN2MtMTA4Ljg1LTEzLjE4LTI3Ni00OS42Mi0zNjcuNjMsMjIuOTQtMy40MiwyLjY5LTYuNzUsNS41Mi05Ljk2LDguNDgtNi40NSw1Ljk3LTEyLjUyLDEyLjU1LTE4LjQyLDE5LjU2LDUuMzItMTcuNTQsMTUuMjQtMzMuOTYsMjguMTktNDcuOTEsODcuMTEtOTAuOTEsMjY4LjQ2LTU4LjI1LDM2Ny44My0zLjA3aDBaIi8+CiAgPGc+CiAgICA8cGF0aCBmaWxsPSIjNTZiY2I3IiBkPSJNNTIyLjgzLDIyNi4zN2wtLjA0LDM2LjEyYy05Ny44NC05My45Mi0yMjAuNzUtMTUuNjUtMjE4LjA5LDExMS45NSwyLjUzLDEyMS40NiwxMjQuNjEsMTkyLjgyLDIxOC4wOSwxMDQuNTVsLjA0LDM2LjEyLDg3LjEtLjA0VjIyNi40MmwtODcuMS0uMDRoMFoiLz4KICA8L2c+CiAgPHBhdGggZmlsbD0iI2VkNmM2ZSIgZD0iTTEyNDIuMzksMjE4LjdsLS4wNCwzNi42NGMtOTkuMTUtOTUuMjYtMjIzLjY5LTE1Ljg3LTIyMSwxMTMuNTUsMi41NiwxMjMuMiwxMjYuMjcsMTk1LjU5LDIyMSwxMDYuMDVsLjA0LDM2LjY0LDg4LjI2LS4wNFYyMTguNzRsLTg4LjI2LS4wNGgwWiIvPgo8L3N2Zz4=';
const logoSrc = `data:image/svg+xml;base64,${LOGO_BASE64}`;

type Props = {
  params: Promise<{ code: string }>;
};

async function getInviter(code: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('profile')
    .select('first_name, profile_picture_url')
    .eq('referral_code', code.toUpperCase())
    .single();
  return data;
}

export default async function Image({ params }: Props) {
  const { code } = await params;
  const [poppinsBoldData, interMediumData] = await Promise.all([poppinsBold, interMedium]);

  const inviter = await getInviter(code);
  const name = inviter?.first_name ?? 'A friend';

  const fonts = [
    { name: 'Poppins', data: poppinsBoldData, style: 'normal' as const, weight: 700 as const },
    { name: 'Inter', data: interMediumData, style: 'normal' as const, weight: 500 as const },
  ];

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
      {/* Accent gradient bar at top */}
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
            stroke="#5eead4"
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
          {name} invited you to Rallia
        </span>

        {/* Subheading */}
        <span
          style={{
            fontSize: 26,
            fontWeight: 500,
            color: '#99f6e4',
            textAlign: 'center',
          }}
        >
          Find players and organize tennis & pickleball games
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
    { ...size, fonts }
  );
}
