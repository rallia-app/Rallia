/**
 * Logging Service
 *
 * Centralized logging service for the application
 * Provides environment-aware logging with support for error tracking services
 *
 * Features:
 * - Environment-based logging (dev vs production)
 * - Multiple log levels (debug, info, warn, error)
 * - Integration with error tracking services (Sentry)
 * - Structured logging with context
 * - Performance tracking
 *
 * @example
 * ```typescript
 * import { Logger } from '../../services/logger';
 *
 * Logger.info('User signed in', { userId: '123' });
 * Logger.error('Failed to load profile', error, { userId: '123' });
 * Logger.warn('Slow network detected', { latency: 5000 });
 * ```
 */

// Type declaration for React Native's __DEV__ global
declare const __DEV__: boolean;

// Log levels
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

// Log entry structure
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, unknown>;
  error?: Error;
}

// Logger configuration
interface LoggerConfig {
  enableConsole: boolean;
  enableErrorTracking: boolean;
  minLevel: LogLevel;
  includeTimestamp: boolean;
  includeContext: boolean;
}

/**
 * Logger class for centralized logging
 */
class LoggerService {
  private config: LoggerConfig;
  private isDevelopment: boolean;

  constructor() {
    this.isDevelopment = __DEV__;
    this.config = {
      enableConsole: true,
      enableErrorTracking: !this.isDevelopment,
      minLevel: this.isDevelopment ? LogLevel.DEBUG : LogLevel.INFO,
      includeTimestamp: true,
      includeContext: true,
    };
  }

  /**
   * Configure logger settings
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if log level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const minLevelIndex = levels.indexOf(this.config.minLevel);
    const currentLevelIndex = levels.indexOf(level);
    return currentLevelIndex >= minLevelIndex;
  }

  /**
   * Format log message for console output
   */
  private formatMessage(entry: LogEntry): string {
    const parts: string[] = [];

    // Timestamp
    if (this.config.includeTimestamp) {
      parts.push(`[${entry.timestamp.toISOString()}]`);
    }

    // Level
    parts.push(`[${entry.level.toUpperCase()}]`);

    // Message
    parts.push(entry.message);

    return parts.join(' ');
  }

  /**
   * Get console method for log level
   */
  private getConsoleMethod(level: LogLevel): (...args: unknown[]) => void {
    switch (level) {
      case LogLevel.DEBUG:
        return console.debug;
      case LogLevel.INFO:
        return console.info;
      case LogLevel.WARN:
        return console.warn;
      case LogLevel.ERROR:
        return console.error;
      default:
        return console.log;
    }
  }

  /**
   * Get emoji for log level (for better visibility in dev)
   */
  private getLogEmoji(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return '🔍';
      case LogLevel.INFO:
        return 'ℹ️';
      case LogLevel.WARN:
        return '⚠️';
      case LogLevel.ERROR:
        return '🚨';
      default:
        return '📝';
    }
  }

  /**
   * Core logging method
   */
  private log(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    // Console logging
    if (this.config.enableConsole) {
      const consoleMethod = this.getConsoleMethod(entry.level);
      const emoji = this.isDevelopment ? this.getLogEmoji(entry.level) : '';
      const message = `${emoji} ${this.formatMessage(entry)}`;

      consoleMethod(message);

      // Log context if available
      if (this.config.includeContext && entry.context) {
        console.log('Context:', entry.context);
      }

      // Log error stack if available
      if (entry.error) {
        console.error('Error:', entry.error);
        if (entry.error.stack) {
          console.error('Stack:', entry.error.stack);
        }
      }
    }

    // Error tracking service (production only)
    if (this.config.enableErrorTracking && entry.level === LogLevel.ERROR) {
      this.sendToErrorTracking(entry);
    }
  }

  /**
   * Send error to Sentry
   */
  private sendToErrorTracking(entry: LogEntry): void {
    try {
      const Sentry = require('@sentry/react-native');

      if (entry.error) {
        Sentry.captureException(entry.error, {
          extra: entry.context,
        });
      } else {
        Sentry.captureMessage(entry.message, {
          level: 'error',
          extra: entry.context,
        });
      }
    } catch (error) {
      console.error('Failed to send error to Sentry:', error);
    }
  }

  /**
   * Debug level logging
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log({
      level: LogLevel.DEBUG,
      message,
      timestamp: new Date(),
      context,
    });
  }

  /**
   * Info level logging
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log({
      level: LogLevel.INFO,
      message,
      timestamp: new Date(),
      context,
    });
  }

  /**
   * Warning level logging
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log({
      level: LogLevel.WARN,
      message,
      timestamp: new Date(),
      context,
    });
  }

  /**
   * Error level logging
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log({
      level: LogLevel.ERROR,
      message,
      timestamp: new Date(),
      error,
      context,
    });
  }

  /**
   * Log API request
   */
  logApiRequest(method: string, url: string, duration?: number): void {
    this.debug(`API ${method} ${url}`, {
      method,
      url,
      duration,
      type: 'api_request',
    });
  }

  /**
   * Log API error
   */
  logApiError(method: string, url: string, error: Error, statusCode?: number): void {
    this.error(`API ${method} ${url} failed`, error, {
      method,
      url,
      statusCode,
      type: 'api_error',
    });
  }

  /**
   * Log user action
   */
  logUserAction(action: string, details?: Record<string, unknown>): void {
    this.info(`User action: ${action}`, {
      ...details,
      type: 'user_action',
    });
  }

  /**
   * Log navigation event
   */
  logNavigation(screen: string, params?: Record<string, unknown>): void {
    this.debug(`Navigation to ${screen}`, {
      screen,
      params,
      type: 'navigation',
    });
  }

  /**
   * Log performance metric
   */
  logPerformance(operation: string, duration: number, metadata?: Record<string, unknown>): void {
    const level = duration > 1000 ? LogLevel.WARN : LogLevel.DEBUG;
    this.log({
      level,
      message: `Performance: ${operation} took ${duration}ms`,
      timestamp: new Date(),
      context: {
        operation,
        duration,
        ...metadata,
        type: 'performance',
      },
    });
  }

  /**
   * Create a performance timer
   */
  startTimer(operation: string): () => void {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      this.logPerformance(operation, duration);
    };
  }
}

// Export singleton instance
export const Logger = new LoggerService();

// Export class for testing
export { LoggerService };

// Default export
export default Logger;
