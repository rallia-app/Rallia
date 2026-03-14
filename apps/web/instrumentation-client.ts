// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';
import { SentryTransport } from '@rallia/shared-services';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable Sentry in production (not development or Vercel preview)
  enabled: process.env.NODE_ENV === 'production',

  integrations: [Sentry.replayIntegration()],

  // Sample 20% of traces in production
  tracesSampleRate: 0.2,

  enableLogs: true,

  // Capture 10% of sessions for replay, 100% when an error occurs
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  sendDefaultPii: true,
});

// Wire up the shared logger's SentryTransport so Logger.error() calls also go to Sentry
SentryTransport.configure(Sentry);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
