/**
 * Loisir Montreal Provider
 *
 * Provider for fetching court availability from Loisir Montreal public courts.
 * Uses POST requests to the IC3 API.
 *
 * API Documentation:
 * - Search endpoint: POST https://loisirs.montreal.ca/IC3/api/U6510/public/search
 * - Booking URL: https://loisirs.montreal.ca/IC3/#/U6510/view/{facilityId}/{startDateTime}/{endDateTime}/{facilityScheduleId}
 */

import { BaseAvailabilityProvider } from './BaseAvailabilityProvider';
// Removed unused import: generateMockLoisirMontrealResponse
import type {
  AvailabilitySlot,
  FetchAvailabilityParams,
  LoisirMontrealSearchRequest,
  LoisirMontrealSearchResponse,
  LoisirMontrealSlot,
} from '../types';

/**
 * Clean Loisir Montreal facility/site names by removing internal prefixes.
 * The API returns names like "#aPickleball ESMR.droit - Terrain 2" which we clean to "Pickleball ESMR.droit - Terrain 2"
 */
function cleanLoisirName(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  // Remove "#a" prefix that Loisir Montreal uses internally
  return name.replace(/^#a/i, '').trim();
}

/**
 * Extract court number from facility name.
 * Handles patterns like "Terrain 2", "Court 1", "Terrain pickleball 1", etc.
 * Returns undefined if no number found.
 */
function extractCourtNumber(name: string | undefined | null): number | undefined {
  if (!name) return undefined;
  // Match patterns like "Terrain 2", "Court 1", "Terrain pickleball 1", etc.
  // Look for a number at the end or after "Terrain" or "Court"
  const match = name.match(/(?:terrain|court)\s*(?:\w+\s+)?(\d+)/i) || name.match(/(\d+)\s*$/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

export class LoisirMontrealProvider extends BaseAvailabilityProvider {
  readonly providerType = 'loisir_montreal';

  /**
   * Fetch availability from Loisir Montreal API.
   *
   * @param params - Fetch parameters including dates, siteId, and time filters
   * @returns Array of normalized availability slots
   */
  async fetchAvailability(params: FetchAvailabilityParams): Promise<AvailabilitySlot[]> {
    // Check for mock mode (useful for testing during winter when no real slots exist)

    // const useMockData =
    //   false ||
    //   this.getConfigValue('useMockData', false) ||
    //   process.env.EXPO_PUBLIC_USE_MOCK_AVAILABILITY === 'true';

    // if (useMockData) {
    //   console.log('[LoisirMontrealProvider] Using mock data (EXPO_PUBLIC_USE_MOCK_AVAILABILITY)');
    //   const mockResponse = generateMockLoisirMontrealResponse(params.dates, params.siteId);
    //   return this.parseResponse(mockResponse);
    // }

    const searchPath = this.getConfigValue('searchPath', '/public/search');
    const defaultLimit = this.getConfigValue('defaultLimit', 500);

    // Build the URL with cache-busting timestamp
    const url = `${this.config.apiBaseUrl}${searchPath}?_=${Date.now()}`;

    // Format dates as ISO strings with timezone (as expected by the API)
    // Input: "2025-06-04" -> Output: "2025-06-04T00:00:00.000-04:00"
    const formattedDates = params.dates.map(dateStr => {
      // If already in ISO format with time, use as-is
      if (dateStr.includes('T')) {
        return dateStr;
      }
      // Otherwise, add time and timezone offset for Montreal (Eastern Time)
      // Note: This is a simplified approach - in production, consider using a proper timezone library
      return `${dateStr}T00:00:00.000-04:00`;
    });

    // Build request body matching Postman format exactly
    const requestBody: LoisirMontrealSearchRequest = {
      dates: formattedDates,
      siteId: params.siteId ?? null,
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
      const response = await this.makeRequest<LoisirMontrealSearchResponse>(url, {
        method: 'POST',
        body: requestBody as unknown as Record<string, unknown>,
        headers: {
          // Additional headers that might be required by the API
          'User-Agent': 'Rallia/1.0',
          Origin: 'https://loisirs.montreal.ca',
          Referer: 'https://loisirs.montreal.ca/',
        },
        timeout: 30000, // 30s timeout for external API
      });

      return this.parseResponse(response);
    } catch (error) {
      console.error('[LoisirMontrealProvider] Failed to fetch availability:', error);
      // Log more details for debugging
      if (error instanceof Error) {
        console.error('[LoisirMontrealProvider] Error details:', error.message, error.name);
      }
      return []; // Graceful degradation
    }
  }

  /**
   * Parse Loisir Montreal API response into normalized slots.
   *
   * @param response - Raw API response
   * @returns Array of normalized availability slots
   */
  private parseResponse(response: LoisirMontrealSearchResponse): AvailabilitySlot[] {
    if (!response?.results || !Array.isArray(response.results)) {
      return [];
    }

    const slots: AvailabilitySlot[] = [];

    for (const item of response.results) {
      try {
        const slot = this.parseSlot(item);
        if (slot) {
          // Build booking URL for each slot
          slot.bookingUrl = this.buildBookingUrl(slot) ?? undefined;
          slots.push(slot);
        }
      } catch (error) {
        // Skip malformed slots, log for debugging
        console.warn('[LoisirMontrealProvider] Failed to parse slot:', item, error);
      }
    }

    return slots;
  }

  /**
   * Parse a single slot from the API response.
   *
   * API Response structure:
   * - facility.id: The court/facility ID
   * - facility.name: Court name (e.g., "Tennis Court 1")
   * - facility.site.id: Site ID (park/location)
   * - facility.site.name: Site name (e.g., "Parc Jarry")
   * - startDateTime/endDateTime: ISO strings
   * - facilityScheduleId: Required for booking URL
   * - totalPrice: Price in CAD
   * - canReserve.value: Whether booking is possible
   *
   * @param item - Raw slot data from API
   * @returns Normalized availability slot or null if invalid
   */
  private parseSlot(item: LoisirMontrealSlot): AvailabilitySlot | null {
    // Validate required fields
    if (!item.startDateTime || !item.endDateTime || !item.facilityScheduleId) {
      return null;
    }

    // Skip slots that cannot be reserved
    if (item.canReserve && !item.canReserve.value) {
      return null;
    }

    const datetime = new Date(item.startDateTime);
    const endDateTime = new Date(item.endDateTime);

    // Validate dates are valid
    if (isNaN(datetime.getTime()) || isNaN(endDateTime.getTime())) {
      return null;
    }

    // Extract facility info from nested structure
    const facility = item.facility;
    const facilityId = facility?.id ? String(facility.id) : String(item.facilityScheduleId);
    // Clean names by removing "#a" prefix used by Loisir Montreal
    const shortCourtName = cleanLoisirName(facility?.name);
    const siteName = cleanLoisirName(facility?.site?.name);
    // Extract court number for translated display (e.g., "Terrain 2" → 2)
    const courtNumber = extractCourtNumber(facility?.name);

    return {
      datetime,
      endDateTime,
      courtCount: 1, // Each Loisir Montreal slot represents one court
      facilityId,
      courtNumber,
      facilityScheduleId: String(item.facilityScheduleId),
      courtName: siteName ? `${siteName} - ${shortCourtName}` : shortCourtName,
      shortCourtName, // Just the court name without facility prefix (e.g., "Tennis Court 1")
      price: typeof item.totalPrice === 'number' ? item.totalPrice : undefined,
      currency: 'CAD',
    };
  }

  /**
   * Override booking URL builder for Loisir Montreal specific format.
   * The URL format uses path segments instead of query params.
   *
   * Example: https://loisirs.montreal.ca/IC3/#/U6510/view/12345/2024-01-20T09:00:00Z/2024-01-20T10:00:00Z/67890
   */
  override buildBookingUrl(slot: AvailabilitySlot): string | null {
    if (!this.config.bookingUrlTemplate) {
      return null;
    }

    // Loisir Montreal uses ISO datetime format without milliseconds
    // Format: 2024-01-20T09:00:00Z (with 'Z' suffix, no milliseconds)
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
