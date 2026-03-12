// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable Sentry in production (not development or Vercel preview)
  enabled: process.env.NODE_ENV === 'production',

  // Sample 20% of traces in production
  tracesSampleRate: 0.2,

  enableLogs: true,

  sendDefaultPii: true,
});
