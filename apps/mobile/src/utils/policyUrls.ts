import type { Locale } from '@rallia/shared-translations';

export type PolicyPage = 'privacy' | 'terms';

/**
 * Locale-prefixed policy URL — bare rallia.ca/privacy lets the web pick the
 * language from the browser, which can disagree with the in-app language.
 */
export function getPolicyUrl(page: PolicyPage, locale: Locale): string {
  return `https://rallia.ca/${locale}/${page}`;
}
