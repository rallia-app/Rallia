'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  buildConsent,
  CONSENT_EVENT,
  clearConsent,
  type ConsentState,
  readConsent,
  writeConsent,
} from '@/lib/consent';

interface ConsentContextValue {
  /** null = user has not yet made a choice; banner should be shown. */
  consent: ConsentState | null;
  /** Hydrated from localStorage; false on the very first client paint. */
  ready: boolean;
  /** Set both opt-in categories at once. */
  acceptAll: () => void;
  /** Refuse both opt-in categories (necessary stays on). */
  rejectAll: () => void;
  /** Save a custom selection. */
  save: (prefs: { analytics: boolean; marketing: boolean }) => void;
  /** Clear stored consent — re-prompts the banner on next paint. */
  revoke: () => void;
  /** Open the preferences dialog from anywhere (footer button, etc.). */
  openPreferences: () => void;
  preferencesOpen: boolean;
  setPreferencesOpen: (open: boolean) => void;
  /**
   * True once PostHog has finished its lazy init this session. Consumers that
   * fire a one-shot capture on mount (e.g. UtmCapture) must wait for this —
   * capturing on the not-yet-initialized singleton silently no-ops.
   */
  posthogReady: boolean;
  /** Called by AnalyticsRuntime from posthog's `loaded` callback. */
  markPosthogReady: () => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [ready, setReady] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [posthogReady, setPosthogReady] = useState(false);

  useEffect(() => {
    setConsent(readConsent());
    setReady(true);

    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<ConsentState | null>).detail;
      setConsent(detail ?? null);
    };
    window.addEventListener(CONSENT_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_EVENT, onChange);
  }, []);

  const acceptAll = useCallback(() => {
    writeConsent(buildConsent(true, true));
    setPreferencesOpen(false);
  }, []);

  const rejectAll = useCallback(() => {
    writeConsent(buildConsent(false, false));
    setPreferencesOpen(false);
  }, []);

  const save = useCallback((prefs: { analytics: boolean; marketing: boolean }) => {
    writeConsent(buildConsent(prefs.analytics, prefs.marketing));
    setPreferencesOpen(false);
  }, []);

  const revoke = useCallback(() => {
    clearConsent();
    setPreferencesOpen(false);
  }, []);

  const openPreferences = useCallback(() => setPreferencesOpen(true), []);

  const markPosthogReady = useCallback(() => setPosthogReady(true), []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      consent,
      ready,
      acceptAll,
      rejectAll,
      save,
      revoke,
      openPreferences,
      preferencesOpen,
      setPreferencesOpen,
      posthogReady,
      markPosthogReady,
    }),
    [
      consent,
      ready,
      acceptAll,
      rejectAll,
      save,
      revoke,
      openPreferences,
      preferencesOpen,
      posthogReady,
      markPosthogReady,
    ]
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) {
    throw new Error('useConsent must be used inside <ConsentProvider>');
  }
  return ctx;
}

export function useConsentValue(): ConsentState | null {
  return useConsent().consent;
}

export function useHasAnalyticsConsent(): boolean {
  const ctx = useContext(ConsentContext);
  return ctx?.consent?.analytics === true;
}

export function useHasMarketingConsent(): boolean {
  const ctx = useContext(ConsentContext);
  return ctx?.consent?.marketing === true;
}

export function usePostHogReady(): boolean {
  const ctx = useContext(ConsentContext);
  return ctx?.posthogReady === true;
}
