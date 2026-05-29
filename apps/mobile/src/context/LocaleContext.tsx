import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type Locale,
  locales,
  localeConfigs,
  defaultLocale,
  isValidLocale,
} from '@rallia/shared-translations';

import { supabase } from '#/lib/supabase';
import { initI18n, changeLanguage, getDeviceLocale } from '#/i18n';

const LOCALE_STORAGE_KEY = '@rallia/locale';

// TEMP perf instrumentation (REMOVE after diagnosis). Shared global clock.
function perfLog(label: string, extra?: Record<string, unknown>) {
  const g = globalThis as unknown as { __ralliaPerfLast?: number };
  const now = Date.now();
  const since = g.__ralliaPerfLast ? now - g.__ralliaPerfLast : 0;
  g.__ralliaPerfLast = now;
  // eslint-disable-next-line no-console
  console.log(
    `[perf⏱] ${new Date(now).toISOString().slice(11, 23)} +${String(since).padStart(6)}ms  ${label}`,
    extra ?? ''
  );
}

interface LocaleContextValue {
  /** Current active locale */
  locale: Locale;
  /** Whether a custom locale was set (vs auto-detected) */
  isManuallySet: boolean;
  /** Whether i18n is initialized and ready */
  isReady: boolean;
  /** Set the locale manually */
  setLocale: (locale: Locale) => Promise<void>;
  /** Reset to device's default locale */
  resetToDeviceLocale: () => Promise<void>;
  /** List of all available locales */
  availableLocales: typeof locales;
  /** Locale configurations with display names */
  localeConfigs: typeof localeConfigs;
  /** Sync locale to database for a specific user */
  syncLocaleToDatabase: (userId: string) => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

interface LocaleProviderProps {
  children: ReactNode;
}

export function LocaleProvider({ children }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [isManuallySet, setIsManuallySet] = useState(false);
  const [isReady, setIsReady] = useState(false);
  // Track current user ID for syncing locale to database
  const currentUserIdRef = useRef<string | null>(null);

  /**
   * Sync the current locale to the database and to auth user_metadata.
   * Profile preferred_locale is used for server-side notifications; auth user_metadata.locale
   * is used by Supabase auth email templates (OTP/magic link) so the next email is in the right language.
   */
  const syncLocaleToDatabase = useCallback(
    async (userId: string) => {
      if (!userId) return;

      const __t0 = Date.now();
      perfLog('LocaleCtx.syncLocaleToDatabase START', { userId });
      try {
        const { error: profileError } = await supabase
          .from('profile')
          .update({ preferred_locale: locale })
          .eq('id', userId);
        perfLog('LocaleCtx  profile.update done', { ms: Date.now() - __t0 });

        if (profileError) {
          console.error('Failed to sync locale to database:', profileError);
        } else {
          currentUserIdRef.current = userId;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
        perfLog('LocaleCtx  getSession done', { ms: Date.now() - __t0 });
        // Only write auth user_metadata when the locale actually changed.
        // `auth.updateUser` acquires the GoTrue auth lock; calling it
        // unconditionally on every sign-in serialized ~9s of token contention
        // during the cold-start load storm (the whole client stalls behind it).
        // The metadata copy only feeds OTP/magic-link email language, so it is
        // safe to skip when it already matches the current locale.
        const currentMetaLocale = session?.user?.user_metadata?.locale as string | undefined;
        if (session && currentMetaLocale !== locale) {
          perfLog('LocaleCtx  auth.updateUser START (locale changed)', { from: currentMetaLocale });
          const { error: authError } = await supabase.auth.updateUser({
            data: { locale },
          });
          perfLog('LocaleCtx  auth.updateUser DONE', { ms: Date.now() - __t0 });
          if (authError) {
            console.error('Failed to sync locale to auth user_metadata:', authError);
          }
        } else {
          perfLog('LocaleCtx  auth.updateUser SKIPPED (locale unchanged)');
        }
      } catch (error) {
        console.error('Failed to sync locale to database:', error);
      }
    },
    [locale]
  );

  // Initialize i18n on mount
  useEffect(() => {
    async function initialize() {
      try {
        // Check for saved locale preference
        const savedLocale = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
        let initialLocale: Locale;
        let manuallySet = false;

        if (savedLocale && isValidLocale(savedLocale)) {
          // Use saved preference
          initialLocale = savedLocale;
          manuallySet = true;
        } else {
          // Auto-detect from device
          initialLocale = getDeviceLocale();
        }

        // Initialize i18next with the determined locale
        await initI18n(initialLocale);

        setLocaleState(initialLocale);
        setIsManuallySet(manuallySet);
        setIsReady(true);
      } catch (error) {
        console.error('Failed to initialize i18n:', error);
        // Fallback to default
        await initI18n(defaultLocale);
        setLocaleState(defaultLocale);
        setIsReady(true);
      }
    }

    initialize();
  }, []);

  const setLocale = useCallback(async (newLocale: Locale) => {
    try {
      // Save to storage
      await AsyncStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
      // Change i18next language
      await changeLanguage(newLocale);
      // Update state
      setLocaleState(newLocale);
      setIsManuallySet(true);

      // Sync to profile and auth user_metadata for signed-in users (so notifications and next OTP email use this locale)
      const userId =
        currentUserIdRef.current ??
        (await supabase.auth.getSession()).data.session?.user?.id ??
        null;
      if (userId) {
        if (!currentUserIdRef.current) currentUserIdRef.current = userId;

        const { error } = await supabase
          .from('profile')
          .update({ preferred_locale: newLocale })
          .eq('id', userId);

        if (error) {
          console.error('Failed to sync locale to database:', error);
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          const { error: authError } = await supabase.auth.updateUser({
            data: { locale: newLocale },
          });
          if (authError) {
            console.error('Failed to sync locale to auth user_metadata:', authError);
          }
        }
      }
    } catch (error) {
      console.error('Failed to set locale:', error);
      throw error;
    }
  }, []);

  const resetToDeviceLocale = useCallback(async () => {
    try {
      // Remove saved preference
      await AsyncStorage.removeItem(LOCALE_STORAGE_KEY);
      // Get device locale
      const deviceLocale = getDeviceLocale();
      // Change i18next language
      await changeLanguage(deviceLocale);
      // Update state
      setLocaleState(deviceLocale);
      setIsManuallySet(false);

      // Sync to profile and auth user_metadata for signed-in users
      const userId =
        currentUserIdRef.current ??
        (await supabase.auth.getSession()).data.session?.user?.id ??
        null;
      if (userId) {
        if (!currentUserIdRef.current) currentUserIdRef.current = userId;

        const { error } = await supabase
          .from('profile')
          .update({ preferred_locale: deviceLocale })
          .eq('id', userId);

        if (error) {
          console.error('Failed to sync locale to database:', error);
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          const { error: authError } = await supabase.auth.updateUser({
            data: { locale: deviceLocale },
          });
          if (authError) {
            console.error('Failed to sync locale to auth user_metadata:', authError);
          }
        }
      }
    } catch (error) {
      console.error('Failed to reset locale:', error);
      throw error;
    }
  }, []);

  const value: LocaleContextValue = {
    locale,
    isManuallySet,
    isReady,
    setLocale,
    resetToDeviceLocale,
    availableLocales: locales,
    localeConfigs,
    syncLocaleToDatabase,
  };

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Hook to access locale context
 */
export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (context === undefined) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}

export { LocaleContext };
