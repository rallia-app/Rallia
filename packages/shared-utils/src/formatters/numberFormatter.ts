/**
 * Number Formatters
 *
 * Utilities for formatting numbers, currency, etc.
 */

/**
 * Format number with commas (e.g., "1,234,567")
 */
export const formatNumber = (num: number): string => {
  return num.toLocaleString('en-US');
};

/**
 * Format currency (USD) (e.g., "$1,234.56")
 */
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

/**
 * Format percentage (e.g., "75.5%")
 */
export const formatPercentage = (value: number, decimals: number = 1): string => {
  return `${value.toFixed(decimals)}%`;
};

/**
 * Format decimal to fixed places (e.g., "3.14")
 */
export const formatDecimal = (value: number, decimals: number = 2): string => {
  return value.toFixed(decimals);
};

/**
 * Format large numbers with K/M/B suffix (e.g., "1.2K", "3.4M")
 */
export const formatCompactNumber = (num: number): string => {
  if (num < 1000) {
    return num.toString();
  } else if (num < 1000000) {
    return `${(num / 1000).toFixed(1)}K`;
  } else if (num < 1000000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  } else {
    return `${(num / 1000000000).toFixed(1)}B`;
  }
};

/**
 * Format phone number (US format) (e.g., "(514) 123-4567")
 */
export const formatPhoneNumber = (phone: string): string => {
  // Remove all non-digits
  const cleaned = phone.replace(/\D/g, '');

  // Format as (XXX) XXX-XXXX
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }

  // Return as-is if not 10 digits
  return phone;
};

/**
 * Format rating (e.g., "4.5" or "4.0")
 */
export const formatRating = (rating: number): string => {
  return rating.toFixed(1);
};

/**
 * Format ordinal number (e.g., "1st", "2nd", "3rd", "4th")
 */
export const formatOrdinal = (num: number): string => {
  const j = num % 10;
  const k = num % 100;

  if (j === 1 && k !== 11) {
    return `${num}st`;
  }
  if (j === 2 && k !== 12) {
    return `${num}nd`;
  }
  if (j === 3 && k !== 13) {
    return `${num}rd`;
  }
  return `${num}th`;
};
