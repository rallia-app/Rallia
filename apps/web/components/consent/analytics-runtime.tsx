'use client';

import { useEffect, useRef } from 'react';

import { clearDistinctIdCookie, clearUtmCookie } from '@/lib/utm-cookie';

import { useConsent } from './consent-provider';

/** PostHog drops a number of first-party cookies prefixed with `ph_`. */
function clearPostHogCookies() {
  if (typeof document === 'undefined') return;
  document.cookie.split(';').forEach(raw => {
    const name = raw.split('=')[0]?.trim();
    if (!name) return;
    if (name.startsWith('ph_') || name.startsWith('__ph_')) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
  });
}

/**
 * Bridges saved consent into the analytics SDKs.
 *
 * - PostHog is initialized lazily — only after analytics consent. Until then,
 *   `usePostHog()` returns the uninitialized global which no-ops, so existing
 *   call sites (PostHogIdentify, UtmCapture, invite-landing-tracker) stay safe.
 * - Sentry's session replay integration is loaded lazily via addIntegration.
 *   Sentry error capture itself runs from boot (operational necessity) but
 *   with sendDefaultPii: false in instrumentation-client.ts.
 * - Revoking analytics consent calls posthog.opt_out_capturing() and resets
 *   the flag; we don't force-reload because the gated <Analytics /> and
 *   <UtmCapture /> components unmount on their own via the consent value.
 */
export function AnalyticsRuntime() {
  const { consent, markPosthogReady } = useConsent();
  const posthogInitedRef = useRef(false);
  const replayAddedRef = useRef(false);

  useEffect(() => {
    if (!consent?.analytics) return;
    if (posthogInitedRef.current) return;

    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (process.env.NODE_ENV !== 'production' || !key) return;

    let cancelled = false;
    void import('posthog-js').then(({ default: posthog }) => {
      if (cancelled || posthogInitedRef.current) return;
      posthog.init(key, {
        api_host: '/ingest',
        ui_host: 'https://us.posthog.com',
        defaults: '2026-01-30',
        loaded: ph => {
          ph.register({ web_role: 'marketing_visitor' });
          // Unblock one-shot captures (UtmCapture's deep_link_opened) that
          // mounted before this async init resolved — see usePostHogReady.
          markPosthogReady();
        },
      });
      posthogInitedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [consent?.analytics, markPosthogReady]);

  // Revoke flow: opt out PostHog if consent flips off after a prior opt-in,
  // and purge the ph_* cookie set so a future visitor's session isn't tied
  // to the prior identity. Marketing cookies (rallia_utm, ph_did) are also
  // cleared when marketing consent is withdrawn.
  useEffect(() => {
    if (!consent) return;
    if (!consent.analytics && posthogInitedRef.current) {
      void import('posthog-js').then(({ default: posthog }) => {
        try {
          posthog.opt_out_capturing();
        } catch {
          // SDK may not be ready; harmless.
        }
      });
      clearPostHogCookies();
    }
    if (!consent.marketing) {
      clearUtmCookie();
      clearDistinctIdCookie();
    }
  }, [consent]);

  // Lazy-attach Sentry session replay only with analytics consent.
  useEffect(() => {
    if (!consent?.analytics) return;
    if (replayAddedRef.current) return;
    if (process.env.NODE_ENV !== 'production') return;

    let cancelled = false;
    void import('@sentry/nextjs').then(Sentry => {
      if (cancelled || replayAddedRef.current) return;
      try {
        Sentry.addIntegration(Sentry.replayIntegration());
        replayAddedRef.current = true;
      } catch {
        // Older SDK or already added.
      }
    });

    return () => {
      cancelled = true;
    };
  }, [consent?.analytics]);

  return null;
}
