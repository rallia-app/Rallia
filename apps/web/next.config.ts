import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  // Transpile shared monorepo packages
  transpilePackages: [
    '@rallia/design-system',
    '@rallia/shared-components',
    '@rallia/shared-constants',
    '@rallia/shared-hooks',
    '@rallia/shared-services',
    '@rallia/shared-translations',
    '@rallia/shared-types',
    '@rallia/shared-utils',
  ],
  async headers() {
    return [
      {
        source: '/.well-known/:path*',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
    ];
  },
  images: {
    // Disable optimization in dev to allow local Supabase (private IP)
    unoptimized: isDev,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ['@svgr/webpack'],
    });
    return config;
  },
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
