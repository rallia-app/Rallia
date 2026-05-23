// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';
import { SentryTransport } from '@rallia/shared-services';

// Quebec Law 25: tracking is off by default. Sentry error capture itself
// runs from boot (operational necessity for prod stability) but with PII
// disabled. Session replay and PostHog initialize only after the visitor
// grants analytics consent — see components/consent/analytics-runtime.tsx.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable Sentry in production (not development or Vercel preview)
  enabled: process.env.NODE_ENV === 'production',

  // Session replay is attached lazily by AnalyticsRuntime after consent.
  integrations: [],

  // Sample 20% of traces in production
  tracesSampleRate: 0.2,

  enableLogs: true,

  // Replay sample rates kick in only once replayIntegration is added.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Off by default for Law 25 compliance. Replay attach (post-consent) does
  // not flip this back on; if you want PII later, do it from AnalyticsRuntime
  // gated by consent state.
  sendDefaultPii: false,
});

// Wire up the shared logger's SentryTransport so Logger.error() calls also go to Sentry
SentryTransport.configure(Sentry);

// PostHog is initialized in components/consent/analytics-runtime.tsx only
// after the visitor grants analytics consent.

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
