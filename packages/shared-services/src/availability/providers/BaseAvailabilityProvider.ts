/**
 * Base Availability Provider
 *
 * Abstract base class for all court availability providers.
 * Each provider implements its own fetch logic with appropriate HTTP method and parsing.
 */

import type {
  AvailabilitySlot,
  ProviderConfig,
  FetchAvailabilityParams,
  HttpRequestOptions,
} from '../types';

/**
 * Abstract base class for availability providers.
 *
 * Features:
 * - HTTP method agnostic (supports GET, POST, or custom)
 * - Shared request helper with error handling
 * - Booking URL template substitution
 *
 * To add a new provider:
 * 1. Extend this class
 * 2. Set the `providerType` property
 * 3. Implement `fetchAvailability()` with provider-specific logic
 * 4. Optionally override `buildBookingUrl()` for custom URL formats
 */
export abstract class BaseAvailabilityProvider {
  /** Unique provider type identifier (must match database provider_type) */
  abstract readonly providerType: string;

  constructor(protected readonly config: ProviderConfig) {}

  /**
   * Fetch availability slots from the external API.
   * Each provider implements this with appropriate HTTP method and parsing.
   *
   * @param params - Fetch parameters (dates, times, facility IDs, etc.)
   * @returns Array of normalized availability slots
   */
  abstract fetchAvailability(params: FetchAvailabilityParams): Promise<AvailabilitySlot[]>;

  /**
   * Build a booking URL for a specific slot.
   * Uses the template from config with placeholder substitution.
   *
   * Supported placeholders:
   * - {facilityId} - External facility ID
   * - {startDateTime} - ISO datetime string
   * - {endDateTime} - ISO datetime string
   * - {facilityScheduleId} - Schedule/slot ID
   *
   * @param slot - The availability slot to build URL for
   * @returns Booking URL or null if no template configured
   */
  buildBookingUrl(slot: AvailabilitySlot): string | null {
    if (!this.config.bookingUrlTemplate) {
      return null;
    }

    return this.config.bookingUrlTemplate
      .replace('{facilityId}', encodeURIComponent(slot.facilityId))
      .replace('{startDateTime}', encodeURIComponent(slot.datetime.toISOString()))
      .replace('{endDateTime}', encodeURIComponent(slot.endDateTime.toISOString()))
      .replace('{facilityScheduleId}', encodeURIComponent(slot.facilityScheduleId));
  }

  /**
   * Helper method for making HTTP requests.
   * Providers can use this for consistent request handling.
   *
   * @param endpoint - Full URL to request
   * @param options - Request options (method, body, query params, headers)
   * @returns Parsed JSON response
   * @throws Error if request fails
   */
  protected async makeRequest<T>(endpoint: string, options: HttpRequestOptions): Promise<T> {
    let url = endpoint;

    // Add query parameters for GET requests
    if (options.queryParams && Object.keys(options.queryParams).length > 0) {
      const params = new URLSearchParams(options.queryParams);
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}${params.toString()}`;
    }

    const timeout = options.timeout ?? 10000; // Default 10s timeout

    const allHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };

    const body =
      options.method === 'POST' && options.body ? JSON.stringify(options.body) : undefined;

    // Use XMLHttpRequest instead of fetch — React Native's fetch on Android/Hermes
    // truncates response bodies, causing JSON parse failures
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(options.method, url, true);
      xhr.timeout = timeout;
      xhr.responseType = 'text';

      for (const [key, value] of Object.entries(allHeaders)) {
        xhr.setRequestHeader(key, value);
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as T);
          } catch {
            reject(
              new Error(
                `Provider API returned non-JSON response (${xhr.responseText.length} chars): ${xhr.responseText.slice(0, 200)}`
              )
            );
          }
        } else {
          reject(
            new Error(
              `Provider API error: ${xhr.status} ${xhr.statusText} - ${(xhr.responseText || '').slice(0, 200)}`
            )
          );
        }
      };

      xhr.ontimeout = () => {
        reject(new Error(`Provider API timeout after ${timeout}ms`));
      };

      xhr.onerror = () => {
        reject(new Error(`Provider API network error`));
      };

      xhr.send(body);
    });
  }

  /**
   * Get a config value with type safety.
   * @param key - Config key to retrieve
   * @param defaultValue - Default value if key not found
   */
  protected getConfigValue<T>(key: string, defaultValue: T): T {
    const value = this.config.apiConfig[key];
    return value !== undefined ? (value as T) : defaultValue;
  }
}
