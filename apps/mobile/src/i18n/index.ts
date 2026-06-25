import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import {
  translations,
  defaultLocale,
  getMatchingLocale,
  type Locale,
} from '@rallia/shared-translations';

/**
 * Get the device's preferred locale, matched to our supported locales
 */
export function getDeviceLocale(): Locale {
  const deviceLocales = Localization.getLocales();
  if (deviceLocales.length > 0) {
    const primaryLocale = deviceLocales[0];
    // Try full locale first (e.g., 'en-US'), then language code (e.g., 'en')
    const languageTag = primaryLocale.languageTag || primaryLocale.languageCode || '';
    return getMatchingLocale(languageTag);
  }
  return defaultLocale;
}

const i18nInitOptions = {
  resources: {
    'en-US': { translation: translations['en-US'] },
    'fr-CA': { translation: translations['fr-CA'] },
  },
  fallbackLng: defaultLocale,
  // Use single braces {} to match next-intl format for consistency
  interpolation: {
    escapeValue: false, // React already handles XSS
    prefix: '{',
    suffix: '}',
  },
  // Disable react-i18next suspense for better control
  react: {
    useSuspense: false,
  },
  // Compatibility settings
  compatibilityJSON: 'v4' as const,
  returnNull: false,
  returnEmptyString: false,
};

/**
 * Synchronous bootstrap with the device locale so `useTranslation()` is safe
 * on the first React render. Called at module load from apps/mobile/index.ts.
 */
export function bootstrapI18n(): void {
  if (i18next.isInitialized) return;

  void i18next.use(initReactI18next).init({
    ...i18nInitOptions,
    lng: getDeviceLocale(),
  });
}

/**
 * Ensure i18next is initialized and set the active locale.
 * Safe to call after bootstrap — only changes language when needed.
 */
export async function initI18n(savedLocale?: Locale): Promise<void> {
  bootstrapI18n();

  const locale = savedLocale || getDeviceLocale();
  if (getCurrentLanguage() !== locale) {
    await changeLanguage(locale);
  }
}

/**
 * Change the current language
 */
export async function changeLanguage(locale: Locale): Promise<void> {
  await i18next.changeLanguage(locale);
}

/**
 * Get the current language
 */
export function getCurrentLanguage(): Locale {
  return (i18next.language as Locale) || defaultLocale;
}

export { i18next };

// Side effect: register react-i18next before the React tree mounts.
bootstrapI18n();
