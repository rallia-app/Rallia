import { useCallback } from 'react';
import { useTranslation as useI18nextTranslation } from 'react-i18next';
import type { TranslationKey, Locale } from '@rallia/shared-translations';

interface TranslationOptions {
  [key: string]: string | number | boolean;
}

/**
 * Translation function type with autocomplete support
 * Uses function overloads to support both literal keys (with autocomplete) and dynamic keys
 */
type TranslationFunction = {
  // Overload 1: Literal keys get autocomplete (most common case)
  (key: TranslationKey, options?: TranslationOptions): string;
  // Overload 2: Accept any string for dynamic keys without type error
  // (key: string, options?: TranslationOptions): string;
};

interface UseTranslationReturn {
  /**
   * Translate a key to the current locale
   * @param key - Translation key (dot notation path, e.g., 'common.loading')
   * @param options - Optional interpolation values
   * @returns Translated string
   * @remarks
   * Supports both literal keys (with autocomplete) and dynamic keys (template literals).
   * Keys are validated:
   * - At compile time for literal strings (TypeScript autocomplete)
   * - At runtime by i18next (dev warnings)
   * - At CI time by validate-translations.js script
   */
  t: TranslationFunction;
  /**
   * Current locale code
   */
  locale: Locale;
  /**
   * Whether translations are ready
   */
  ready: boolean;
}

/**
 * Hook for accessing translations in components
 *
 * @example
 * ```tsx
 * const { t, locale } = useTranslation();
 *
 * return (
 *   <Text>{t('common.loading')}</Text>
 *   <Text>{t('auth.codeSent', { email: 'user@example.com' })}</Text>
 * );
 * ```
 */
export function useTranslation(): UseTranslationReturn {
  const { t: i18nextT, i18n, ready } = useI18nextTranslation();

  // Create a stable wrapper around t function with overload support
  // The type assertion to TranslationFunction enables autocomplete while accepting any string
  const t = useCallback(
    (key: TranslationKey, options?: TranslationOptions): string => {
      return i18nextT(key, options);
    },
    [i18nextT]
  );

  return {
    t,
    locale: (i18n.language as Locale) || 'en-US',
    ready,
  };
}

export type { TranslationKey, TranslationOptions };
