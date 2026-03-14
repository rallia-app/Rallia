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
 * SentryTransport.configure(Sentry);
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

/** Map context.type to a Sentry breadcrumb category */
function getBreadcrumbCategory(context?: Record<string, unknown>): string {
  const type = context?.type as string | undefined;
  if (type === 'user_action') return 'user';
  if (type === 'navigation') return 'navigation';
  if (type === 'api_request' || type === 'api_error') return 'http';
  if (type === 'performance') return 'performance';
  return 'app';
}

export class SentryTransport implements Transport {
  private static sentry: SentryLike | null = null;

  /**
   * Configure the transport with Sentry capture functions.
   * Call this after Sentry.init() in your app entry point.
   */
  static configure(sentry: SentryLike): void {
    SentryTransport.sentry = sentry;
  }

  shouldLog(level: LogLevel): boolean {
    // Accept INFO+ for breadcrumbs, ERROR for capture
    return level !== LogLevel.DEBUG;
  }

  log(entry: LogEntry): void {
    if (!SentryTransport.sentry) return;

    try {
      if (entry.level === LogLevel.ERROR) {
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
