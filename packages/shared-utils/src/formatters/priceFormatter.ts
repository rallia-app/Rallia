/**
 * Price Formatter
 *
 * Single home for cents → display-string formatting (was duplicated inline in
 * BookingCard, Paywall, etc.). Money is stored as integer cents + a currency
 * code throughout the app; this renders it for humans.
 */

export interface FormatPriceOptions {
  /** BCP-47 locale. Defaults to en-CA. */
  locale?: string;
  /** Drop the cents on whole-dollar amounts (e.g. "$50" instead of "$50.00"). */
  trimZeroCents?: boolean;
}

/**
 * Format an integer-cents amount as a localized currency string.
 * `formatPrice(5450)` → "$54.50"; `formatPrice(5000, 'CAD', { trimZeroCents: true })` → "$50".
 * Falls back to a plain "$X.XX CUR" string if Intl is unavailable (older Hermes).
 */
export const formatPrice = (
  cents: number,
  currency: string = 'CAD',
  options: FormatPriceOptions = {}
): string => {
  const { locale = 'en-CA', trimZeroCents = false } = options;
  const amount = (cents ?? 0) / 100;
  const fractionDigits = trimZeroCents && Number.isInteger(amount) ? 0 : 2;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(fractionDigits)} ${currency.toUpperCase()}`;
  }
};
