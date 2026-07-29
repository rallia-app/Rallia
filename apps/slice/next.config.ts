import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

/**
 * Deliberately minimal. No Sentry and no transpilePackages: this app ships
 * nothing from the parent monorepo, so the built output carries no trace of it.
 * The only rewrite proxies PostHog through our own origin so the browser never
 * contacts a third-party host.
 */
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
};

export default createNextIntlPlugin('./i18n/request.ts')(nextConfig);
