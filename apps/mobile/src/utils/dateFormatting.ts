import type { Locale } from '@rallia/shared-translations';

/**
 * Format a date string to a locale-aware date string
 * @param dateString - ISO date string or null
 * @param locale - Locale code (e.g., 'en-US', 'fr-CA')
 * @returns Formatted date string or empty string if dateString is null
 */
export function formatDate(dateString: string | null, locale: Locale): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * Format a date string to a locale-aware date string (short format)
 * @param dateString - ISO date string or null
 * @param locale - Locale code (e.g., 'en-US', 'fr-CA')
 * @returns Formatted date string or empty string if dateString is null
 */
export function formatDateShort(dateString: string | null, locale: Locale): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Format a date string to show only month and year
 * @param dateString - ISO date string or null
 * @param locale - Locale code (e.g., 'en-US', 'fr-CA')
 * @returns Formatted date string or empty string if dateString is null
 */
export function formatDateMonthYear(dateString: string | null, locale: Locale): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
  }).format(date);
}

/**
 * Format the time-of-day portion of a Date with explicit 12h/24h per locale.
 * en-* → AM/PM, everything else (fr-*) → 24h. We pin `hour12` because iOS
 * otherwise honors the device "24-Hour Time" setting and ignores the locale,
 * so relying on the locale default is not reliable.
 * @param date - Date whose time portion should be formatted
 * @param locale - Locale code (e.g., 'en-US', 'fr-CA')
 * @param options.hour - 'numeric' ("2:00 PM") or '2-digit' ("02:00 PM")
 */
export function formatTimeOfDay(
  date: Date,
  locale: string,
  options?: { hour?: 'numeric' | '2-digit' }
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: options?.hour ?? 'numeric',
    minute: '2-digit',
    hour12: locale.startsWith('en'),
  }).format(date);
}

/**
 * Format a time string to a locale-aware time string
 * @param timeString - Time string (HH:mm format) or null
 * @param locale - Locale code (e.g., 'en-US', 'fr-CA')
 * @returns Formatted time string or empty string if timeString is null
 */
export function formatTime(timeString: string | null, locale: Locale): string {
  if (!timeString) return '';
  // Parse time string (HH:mm format)
  const [hours, minutes] = timeString.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return formatTimeOfDay(date, locale);
}

/**
 * Format a date and time to a locale-aware date-time string
 * @param dateString - ISO date string or null
 * @param locale - Locale code (e.g., 'en-US', 'fr-CA')
 * @returns Formatted date-time string or empty string if dateString is null
 */
export function formatDateTime(dateString: string | null, locale: Locale): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: locale.startsWith('en'),
  }).format(date);
}

/**
 * Format relative time (e.g., "5m ago", "2h ago")
 * Note: This is a simple implementation. For more complex relative time formatting,
 * consider using a library like date-fns with locale support.
 * @param dateString - ISO date string
 * @param locale - Locale code (e.g., 'en-US', 'fr-CA')
 * @returns Formatted relative time string
 */
export function formatRelativeTime(dateString: string, locale: Locale): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  // Hermes-on-iOS does not always include `Intl.RelativeTimeFormat`; calling
  // `new` on it throws "Cannot read property 'prototype' of undefined". Fall
  // back to a small manual formatter for the two locales we ship.
  const rtf =
    typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function'
      ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
      : null;

  const format = (value: number, unit: 'second' | 'minute' | 'hour' | 'day'): string => {
    if (rtf) return rtf.format(value, unit);
    const isFr = locale.startsWith('fr');
    const abs = Math.abs(value);
    if (isFr) {
      const labels = {
        second: ['à l’instant', 'il y a 1 seconde', `il y a ${abs} secondes`],
        minute: ['à l’instant', 'il y a 1 minute', `il y a ${abs} minutes`],
        hour: ['', 'il y a 1 heure', `il y a ${abs} heures`],
        day: ['aujourd’hui', 'hier', `il y a ${abs} jours`],
      } as const;
      if (abs === 0) return labels[unit][0];
      if (abs === 1) return labels[unit][1];
      return labels[unit][2];
    }
    const labels = {
      second: ['just now', '1 second ago', `${abs} seconds ago`],
      minute: ['just now', '1 minute ago', `${abs} minutes ago`],
      hour: ['', '1 hour ago', `${abs} hours ago`],
      day: ['today', 'yesterday', `${abs} days ago`],
    } as const;
    if (abs === 0) return labels[unit][0];
    if (abs === 1) return labels[unit][1];
    return labels[unit][2];
  };

  if (diffSec < 60) return format(-diffSec, 'second');
  if (diffMin < 60) return format(-diffMin, 'minute');
  if (diffHour < 24) return format(-diffHour, 'hour');
  if (diffDay < 7) return format(-diffDay, 'day');
  return formatDateShort(dateString, locale);
}
