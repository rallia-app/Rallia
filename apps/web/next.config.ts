import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  // Transpile shared monorepo packages.
  // @rallia/shared-components is deliberately absent: it is React Native only.
  transpilePackages: [
    '@rallia/design-system',
    '@rallia/shared-constants',
    '@rallia/shared-hooks',
    '@rallia/shared-services',
    '@rallia/shared-translations',
    '@rallia/shared-types',
    '@rallia/shared-utils',
  ],
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
  async redirects() {
    return [
      // rallia.ca served a full duplicate of the canonical rallia.app origin
      // (SITE_URL), so every page carried a cross-domain canonical. Fold it in.
      ...['rallia.ca', 'www.rallia.ca'].map(host => ({
        source: '/:path*',
        has: [{ type: 'host' as const, value: host }],
        destination: 'https://www.rallia.app/:path*',
        permanent: true,
      })),
      // Apex -> www, except /.well-known/*. associatedDomains names the apex
      // (applinks:rallia.app), and neither Apple's CDN nor Android's verifier
      // follows a redirect when fetching the association files, so the apex has
      // to serve them itself or universal links never verify.
      {
        source: '/:path((?!\\.well-known).*)',
        has: [{ type: 'host' as const, value: 'rallia.app' }],
        destination: 'https://www.rallia.app/:path',
        permanent: true,
      },
      // Bare/foreign locale prefixes otherwise fall through to next-intl, which
      // prepends the default locale and 404s (/fr -> /en-US/fr).
      ...(
        [
          ['en', 'en-US'],
          ['en-CA', 'en-US'],
          ['en-GB', 'en-US'],
          ['fr', 'fr-CA'],
          ['fr-FR', 'fr-CA'],
        ] as const
      ).flatMap(([alias, locale]) => [
        { source: `/${alias}`, destination: `/${locale}`, permanent: true },
        { source: `/${alias}/:path*`, destination: `/${locale}/:path*`, permanent: true },
      ]),
      // /games and /courts merged into /play (constrained to real locales so
      // authenticated routes like /app/games are untouched)
      {
        source: '/games',
        destination: '/play',
        permanent: true,
      },
      {
        source: '/:locale(en-US|fr-CA)/games',
        destination: '/:locale/play',
        permanent: true,
      },
      {
        source: '/courts',
        destination: '/play',
        permanent: true,
      },
      {
        source: '/:locale(en-US|fr-CA)/courts',
        destination: '/:locale/play',
        permanent: true,
      },
      // Public routes retired without a redirect: /beta (pre-launch signup,
      // removed in a8b3e075) and /find-a-match (WTP smoke test, removed in
      // ea8172c3 — it lived on rallia.ca, which is where the 404s surfaced).
      {
        source: '/beta',
        destination: '/',
        permanent: true,
      },
      {
        source: '/:locale(en-US|fr-CA)/beta',
        destination: '/:locale',
        permanent: true,
      },
      {
        source: '/find-a-match',
        destination: '/play',
        permanent: true,
      },
      {
        source: '/:locale(en-US|fr-CA)/find-a-match',
        destination: '/:locale/play',
        permanent: true,
      },
      {
        source: '/:locale/waitlist',
        destination: '/:locale',
        permanent: false,
      },
      {
        source: '/waitlist',
        destination: '/',
        permanent: false,
      },
      {
        source: '/:locale/winter',
        destination: '/:locale',
        permanent: false,
      },
      {
        source: '/winter',
        destination: '/',
        permanent: false,
      },
    ];
  },
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
export default withSentryConfig(withNextIntl(nextConfig), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: 'rallia',

  project: 'javascript-nextjs',

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: '/monitoring',

  // Delete source maps after upload so they aren't served to clients
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
