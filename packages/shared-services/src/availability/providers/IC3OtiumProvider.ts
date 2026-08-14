/**
 * IC3/Otium Provider
 *
 * Provider for fetching court availability from IC3/Otium municipal platforms.
 * Used by Montreal, Boucherville, Blainville, and other Quebec municipalities.
 * Uses POST requests to the IC3 U6510 facility reservation API.
 *
 * Each municipality is a separate data_provider row with its own api_base_url
 * and booking_url_template, but they all share this provider class.
 */

import { BaseAvailabilityProvider } from './BaseAvailabilityProvider';
import { Logger } from '../../logger';
import type {
  AvailabilitySlot,
  FetchAvailabilityParams,
  IC3SearchRequest,
  IC3SearchResponse,
  IC3Slot,
} from '../types';

/**
 * Clean IC3 facility/site names by removing internal prefixes.
 * The API returns names like "#aPickleball ESMR.droit - Terrain 2" which we clean to "Pickleball ESMR.droit - Terrain 2"
 */
function cleanIC3Name(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  // Remove "#a" prefix that IC3/Otium uses internally
  return name.replace(/^#a/i, '').trim();
}

/**
 * Extract court number from facility name.
 * Handles patterns like "Terrain 2", "Court 1", "Terrain pickleball 1", etc.
 * Returns undefined if no number found.
 */
function extractCourtNumber(name: string | undefined | null): number | undefined {
  if (!name) return undefined;
  const match = name.match(/(?:terrain|court)\s*(?:\w+\s+)?(\d+)/i) || name.match(/(\d+)\s*$/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * Canonical IC3 search path: always trailing-slashed.
 *
 * IC3 hosts canonicalize the search endpoint to a trailing slash and 301 the
 * slash-less form. A redirected POST is re-issued as a GET and answered with
 * 405, so ask for the canonical form directly. Every municipality accepts it
 * (verified against Montréal, Boucherville, Blainville).
 *
 * Keep in sync with normalizeIC3SearchPath in
 * supabase/functions/refresh-facility-availability/providers.ts.
 */
export function normalizeIC3SearchPath(configured: string | undefined | null): string {
  const path = configured && configured.length > 0 ? configured : '/public/search';
  return path.endsWith('/') ? path : `${path}/`;
}

export class IC3OtiumProvider extends BaseAvailabilityProvider {
  readonly providerType = 'ic3_otium';

  /**
   * Fetch availability from an IC3/Otium API.
   *
   * @param params - Fetch parameters including dates, siteId, and time filters
   * @returns Array of normalized availability slots
   */
  async fetchAvailability(params: FetchAvailabilityParams): Promise<AvailabilitySlot[]> {
    const searchPath = normalizeIC3SearchPath(this.getConfigValue('searchPath', '/public/search'));
    const defaultLimit = this.getConfigValue('defaultLimit', 500);

    // Build the URL with cache-busting timestamp
    const url = `${this.config.apiBaseUrl}${searchPath}?_=${Date.now()}`;

    // Derive siteId from facilityExternalId if not explicitly provided
    const siteId =
      params.siteId ?? (params.facilityExternalId ? parseInt(params.facilityExternalId, 10) : null);

    // Format dates as ISO strings with timezone (as expected by the API)
    // Input: "2025-06-04" -> Output: "2025-06-04T00:00:00.000-04:00"
    const formattedDates = params.dates.map(dateStr => {
      if (dateStr.includes('T')) {
        return dateStr;
      }
      // Add time and timezone offset for Eastern Time
      // Note: This is a simplified approach - in production, consider using a proper timezone library
      return `${dateStr}T00:00:00.000-04:00`;
    });

    const requestBody: IC3SearchRequest = {
      dates: formattedDates,
      siteId: siteId ?? null,
      startTime: params.startTime ?? null,
      endTime: params.endTime ?? null,
      boroughIds: null,
      facilityTypeIds: null,
      searchString: params.searchString ?? null,
      limit: params.limit ?? defaultLimit,
      offset: params.offset ?? 0,
      sortColumn: 'facility.name',
      isSortOrderAsc: true,
    };

    try {
      const response = await this.makeRequest<IC3SearchResponse>(url, {
        method: 'POST',
        body: requestBody as unknown as Record<string, unknown>,
        headers: {},
        timeout: 30000,
      });

      return this.parseResponse(response);
    } catch (error) {
      // Route through Logger so SentryTransport surfaces this in production.
      // Sentry RN auto-tags os.name (Android/iOS), giving us platform partitioning.
      Logger.error(
        '[IC3OtiumProvider] Failed to fetch availability',
        error instanceof Error ? error : new Error(String(error)),
        {
          provider: 'ic3_otium',
          apiBaseUrl: this.config.apiBaseUrl,
          siteId,
          dates: params.dates,
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        }
      );
      return [];
    }
  }

  /**
   * Parse IC3/Otium API response into normalized slots.
   */
  private parseResponse(response: IC3SearchResponse): AvailabilitySlot[] {
    if (!response?.results || !Array.isArray(response.results)) {
      return [];
    }

    const slots: AvailabilitySlot[] = [];

    for (const item of response.results) {
      try {
        const slot = this.parseSlot(item);
        if (slot) {
          slot.bookingUrl = this.buildBookingUrl(slot) ?? undefined;
          slots.push(slot);
        }
      } catch (error) {
        console.warn('[IC3OtiumProvider] Failed to parse slot:', item, error);
      }
    }

    return slots;
  }

  /**
   * Parse a single slot from the IC3 API response.
   */
  private parseSlot(item: IC3Slot): AvailabilitySlot | null {
    if (!item.startDateTime || !item.endDateTime || !item.facilityScheduleId) {
      return null;
    }

    if (item.canReserve && !item.canReserve.value) {
      return null;
    }

    const datetime = new Date(item.startDateTime);
    const endDateTime = new Date(item.endDateTime);

    if (isNaN(datetime.getTime()) || isNaN(endDateTime.getTime())) {
      return null;
    }

    const facility = item.facility;
    const facilityId = facility?.id ? String(facility.id) : String(item.facilityScheduleId);
    const shortCourtName = cleanIC3Name(facility?.name);
    const siteName = cleanIC3Name(facility?.site?.name);
    const courtNumber = extractCourtNumber(facility?.name);

    return {
      datetime,
      endDateTime,
      courtCount: 1,
      facilityId,
      courtNumber,
      facilityScheduleId: String(item.facilityScheduleId),
      courtName: siteName ? `${siteName} - ${shortCourtName}` : shortCourtName,
      shortCourtName,
      price: typeof item.totalPrice === 'number' ? item.totalPrice : undefined,
      currency: 'CAD',
    };
  }

  /**
   * Override booking URL builder for IC3/Otium specific format.
   * Uses path segments with ISO datetime (no milliseconds).
   *
   * Example: https://loisirs.montreal.ca/IC3/#/U6510/view/12345/2024-01-20T09:00:00Z/2024-01-20T10:00:00Z/67890
   */
  override buildBookingUrl(slot: AvailabilitySlot): string | null {
    if (!this.config.bookingUrlTemplate) {
      return null;
    }

    const formatDateTime = (date: Date): string => {
      return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    };

    return this.config.bookingUrlTemplate
      .replace('{facilityId}', slot.facilityId)
      .replace('{startDateTime}', formatDateTime(slot.datetime))
      .replace('{endDateTime}', formatDateTime(slot.endDateTime))
      .replace('{facilityScheduleId}', slot.facilityScheduleId);
  }
}

// Backward-compatible alias
export const LoisirMontrealProvider = IC3OtiumProvider;
