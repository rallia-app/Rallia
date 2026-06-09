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

interface NormalizedCapture {
  error: Error;
  extra: Record<string, unknown>;
  fingerprint?: string[];
}

// Supabase/PostgREST reject with a plain { code, details, hint, message } object
// (not an Error). Sentry can't build a stack from those, so it titles them
// "Object captured as exception with keys: ..." and groups every unrelated
// failure under whichever incidental JS frame is on top (SentryTransport, a
// useMemo, etc). Wrap any non-Error value in a real Error and pin a stable
// fingerprint from the call-site message + code so distinct failures stay split.
function normalizeForCapture(entry: LogEntry): NormalizedCapture {
  const raw = entry.error as unknown;
  const extra: Record<string, unknown> = { ...entry.context };

  if (raw instanceof Error) {
    return { error: raw, extra };
  }

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const code = typeof obj.code === 'string' ? obj.code : undefined;
    const detail =
      (typeof obj.message === 'string' && obj.message) ||
      (typeof obj.error_description === 'string' && obj.error_description) ||
      (typeof obj.details === 'string' && obj.details) ||
      'non-Error object captured';

    extra.originalError = obj;
    const error = new Error(`${entry.message}: ${detail}`);
    error.name = code ? 'SupabaseError' : 'CapturedObjectError';
    return { error, extra, fingerprint: ['logged-object-error', entry.message, code ?? ''] };
  }

  return {
    error: new Error(`${entry.message}: ${String(raw)}`),
    extra,
    fingerprint: ['logged-primitive-error', entry.message],
  };
}

export interface SentryTransportOptions {
  /**
   * Returns the current foreground/background state of the host app. On RN,
   * pass `() => AppState.currentState`. On web, leave undefined. Recorded on
   * suppressed network-noise breadcrumbs for context.
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

// "Network request failed" / "Network request timed out" are transient
// connectivity blips (iOS suspending the runtime mid-fetch, flaky signal),
// never an actionable app bug — match them so they stay out of the issue
// stream. Checked against either an Error instance or the raw object Supabase
// throws on fetch failure.
function isNetworkNoise(entry: LogEntry): boolean {
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
        if (isNetworkNoise(entry)) {
          // Don't surface as an issue — keep a breadcrumb so context survives
          // if a real error fires later in the same session.
          const appState = SentryTransport.getAppState?.();
          const err = entry.error as { name?: unknown; message?: unknown } | undefined;
          SentryTransport.sentry.addBreadcrumb({
            category: 'app',
            message: `[suppressed network error] ${entry.message}`,
            level: 'warning',
            data: {
              ...entry.context,
              appState,
              errorName: err?.name,
              errorMessage: err?.message,
            },
          });
          return;
        }

        // Capture errors as Sentry issues
        if (entry.error) {
          const { error, extra, fingerprint } = normalizeForCapture(entry);
          SentryTransport.sentry.captureException(error, {
            extra,
            ...(fingerprint ? { fingerprint } : {}),
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
