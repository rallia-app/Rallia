/**
 * Sentry Transport
 *
 * Sends error logs to Sentry and adds breadcrumbs for non-error logs.
 * - ERROR level: captured as exceptions/messages (shows up in Sentry issues)
 * - INFO/WARN level: added as breadcrumbs (provides context trail for errors)
 *
 * Platform-agnostic: call SentryTransport.configure() after Sentry.init()
 * in the app entry point to wire up the capture functions.
 *
 * @example
 * ```typescript
 * import * as Sentry from '@sentry/react-native'; // or '@sentry/nextjs'
 * import { SentryTransport } from '@rallia/shared-services';
 *
 * Sentry.init({ dsn: '...' });
 * SentryTransport.configure(Sentry, { getAppState: () => AppState.currentState });
 * ```
 */

import { LogEntry, LogLevel, Transport } from './Logger';

interface SentryBreadcrumb {
  category?: string;
  message?: string;
  level?: 'debug' | 'info' | 'warning' | 'error' | 'fatal';
  data?: Record<string, unknown>;
}

interface SentryLike {
  captureException: (error: unknown, hint?: Record<string, unknown>) => void;
  captureMessage: (message: string, captureContext?: Record<string, unknown>) => void;
  addBreadcrumb: (breadcrumb: SentryBreadcrumb) => void;
}

export interface SentryTransportOptions {
  /**
   * Returns the current foreground/background state of the host app. On RN,
   * pass `() => AppState.currentState`. On web, leave undefined — every entry
   * is treated as foreground. Used to drop network-failure noise that fires
   * only because iOS suspended the JS runtime mid-fetch.
   */
  getAppState?: () => string;
}

/** Map context.type to a Sentry breadcrumb category */
function getBreadcrumbCategory(context?: Record<string, unknown>): string {
  const type = context?.type as string | undefined;
  if (type === 'user_action') return 'user';
  if (type === 'navigation') return 'navigation';
  if (type === 'api_request' || type === 'api_error') return 'http';
  if (type === 'performance') return 'performance';
  return 'app';
}

// iOS pauses XHRs when the app suspends, then resumes with "Network request
// failed" or a fired wall-clock timeout. Those aren't real failures — drop
// them when we know the app wasn't in front. Pattern is checked against
// either an Error instance or the raw object Supabase throws on fetch failure.
function isBackgroundNetworkNoise(entry: LogEntry): boolean {
  const err = entry.error as unknown;
  if (!err || typeof err !== 'object') return false;

  const name = (err as { name?: unknown }).name;
  if (name === 'NetworkTimeoutError') return true;

  // RN/Hermes surfaces fetch failures as "Network request failed" and timeouts
  // as "Network request timed out" — both fire when iOS suspends the runtime.
  const matchesNetworkNoise = (s: unknown): boolean =>
    typeof s === 'string' &&
    (s.includes('Network request failed') || s.includes('Network request timed out'));

  if (matchesNetworkNoise((err as { message?: unknown }).message)) return true;

  // Supabase wraps fetch failures into a PostgrestError-shaped object whose
  // `details` carries the underlying TypeError string.
  if (matchesNetworkNoise((err as { details?: unknown }).details)) return true;

  return false;
}

export class SentryTransport implements Transport {
  private static sentry: SentryLike | null = null;
  private static getAppState: (() => string) | null = null;

  /**
   * Configure the transport with Sentry capture functions.
   * Call this after Sentry.init() in your app entry point.
   */
  static configure(sentry: SentryLike, options: SentryTransportOptions = {}): void {
    SentryTransport.sentry = sentry;
    SentryTransport.getAppState = options.getAppState ?? null;
  }

  shouldLog(level: LogLevel): boolean {
    // Accept INFO+ for breadcrumbs, ERROR for capture
    return level !== LogLevel.DEBUG;
  }

  log(entry: LogEntry): void {
    if (!SentryTransport.sentry) return;

    try {
      if (entry.level === LogLevel.ERROR) {
        const appState = SentryTransport.getAppState?.();
        if (appState === 'background' && isBackgroundNetworkNoise(entry)) {
          // Don't surface as an issue — keep a breadcrumb so context survives
          // if a real error fires later in the same session.
          const err = entry.error as { name?: unknown; message?: unknown } | undefined;
          SentryTransport.sentry.addBreadcrumb({
            category: 'app',
            message: `[suppressed bg network error] ${entry.message}`,
            level: 'warning',
            data: {
              ...entry.context,
              errorName: err?.name,
              errorMessage: err?.message,
            },
          });
          return;
        }

        // Capture errors as Sentry issues
        if (entry.error) {
          SentryTransport.sentry.captureException(entry.error, {
            extra: entry.context,
          });
        } else {
          SentryTransport.sentry.captureMessage(entry.message, {
            level: 'error',
            extra: entry.context,
          });
        }
      } else {
        // Add non-error logs as breadcrumbs for context trail
        SentryTransport.sentry.addBreadcrumb({
          category: getBreadcrumbCategory(entry.context),
          message: entry.message,
          level: entry.level === LogLevel.WARN ? 'warning' : 'info',
          data: entry.context,
        });
      }
    } catch (error) {
      console.error('SentryTransport: failed to send to Sentry:', error);
    }
  }
}
