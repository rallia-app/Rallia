// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable Sentry in production (not development or Vercel preview)
  enabled: process.env.NODE_ENV === 'production',

  // Sample 10% of traces in production
  tracesSampleRate: 0.1,

  enableLogs: true,

  sendDefaultPii: true,

  beforeSend(event, hint) {
    // Vulnerability scanners probing WordPress/PHP paths — pure bot noise
    const url = event.request?.url;
    if (url && /\/wp-|\.php(\?|$)/i.test(url)) return null;

    // undici's "fetch failed" hides the real reason (code, failing host) in
    // error.cause, which Sentry doesn't capture by default
    const causes: Record<string, unknown>[] = [];
    let cause = (hint.originalException as { cause?: unknown } | undefined)?.cause;
    while (cause && causes.length < 5) {
      const c = cause as { name?: string; message?: string; code?: string; cause?: unknown };
      causes.push({ name: c.name, message: c.message, code: c.code });
      cause = c.cause;
    }
    if (causes.length > 0) {
      event.extra = { ...event.extra, errorCauseChain: causes };
    }
    return event;
  },
});
