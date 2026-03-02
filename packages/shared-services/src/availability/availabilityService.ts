/**
 * Availability Service
 *
 * Main service for fetching court availability using the provider system.
 * Handles provider config caching and orchestrates availability fetching.
 */

import { supabase } from '../supabase';
import { getProvider, isProviderRegistered } from './providers';
import { hasLocalTemplates, fetchLocalAvailability } from './localAvailabilityFetcher';
import type {
  AvailabilitySlot,
  ProviderConfig,
  FetchAvailabilityParams,
  AvailabilityResult,
} from './types';

// Re-export for external access
export {
  hasLocalTemplates,
  fetchLocalAvailability,
  clearLocalTemplatesCache,
} from './localAvailabilityFetcher';

// =============================================================================
// PROVIDER CONFIG CACHE
// =============================================================================

/**
 * In-memory cache for provider configurations.
 * Avoids repeated database queries for the same provider.
 */
const providerConfigCache = new Map<string, ProviderConfig>();

/**
 * Cache TTL in milliseconds (5 minutes).
 * Provider configs rarely change, so a longer TTL is acceptable.
 */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Cache entry timestamps for TTL checking.
 */
const cacheTimestamps = new Map<string, number>();

/**
 * Check if a cached config is still valid.
 */
function isCacheValid(providerId: string): boolean {
  const timestamp = cacheTimestamps.get(providerId);
  if (!timestamp) return false;
  return Date.now() - timestamp < CACHE_TTL;
}

// =============================================================================
// PROVIDER CONFIG FETCHING
// =============================================================================

/**
 * Fetch provider configuration from database.
 * Uses caching to minimize database queries.
 *
 * @param providerId - UUID of the data_provider record
 * @returns Provider configuration or null if not found
 */
export async function fetchProviderConfig(providerId: string): Promise<ProviderConfig | null> {
  // Check cache first
  if (isCacheValid(providerId)) {
    const cached = providerConfigCache.get(providerId);
    if (cached) return cached;
  }

  try {
    const { data, error } = await supabase
      .from('data_provider')
      .select('id, provider_type, api_base_url, api_config, booking_url_template')
      .eq('id', providerId)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      console.warn(`[AvailabilityService] Provider not found: ${providerId}`, error);
      return null;
    }

    const config: ProviderConfig = {
      id: data.id,
      providerType: data.provider_type,
      apiBaseUrl: data.api_base_url,
      apiConfig: (data.api_config as Record<string, unknown>) || {},
      bookingUrlTemplate: data.booking_url_template,
    };

    // Cache the config
    providerConfigCache.set(providerId, config);
    cacheTimestamps.set(providerId, Date.now());

    return config;
  } catch (error) {
    console.error('[AvailabilityService] Error fetching provider config:', error);
    return null;
  }
}

/**
 * Clear the provider config cache.
 * Useful for testing or after admin updates.
 */
export function clearProviderCache(): void {
  providerConfigCache.clear();
  cacheTimestamps.clear();
}

// =============================================================================
// AVAILABILITY FETCHING
// =============================================================================

/**
 * Fetch availability slots for a facility from an external provider.
 *
 * @param providerId - UUID of the data_provider
 * @param params - Fetch parameters
 * @returns Availability result with slots or error
 */
export async function fetchAvailability(
  providerId: string,
  params: FetchAvailabilityParams
): Promise<AvailabilityResult> {
  try {
    // Get provider config
    const config = await fetchProviderConfig(providerId);
    if (!config) {
      return {
        slots: [],
        success: false,
        error: 'Provider configuration not found',
      };
    }

    // Check if provider type is registered
    if (!isProviderRegistered(config.providerType)) {
      return {
        slots: [],
        success: false,
        error: `Provider type not supported: ${config.providerType}`,
      };
    }

    // Get provider instance and fetch availability
    const provider = getProvider(config);
    const slots = await provider.fetchAvailability(params);

    return {
      slots,
      success: true,
      totalCount: slots.length,
    };
  } catch (error) {
    console.error('[AvailabilityService] Error fetching availability:', error);
    return {
      slots: [],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fetch availability for today and optionally tomorrow.
 * Convenience method for common use case.
 *
 * @param providerId - UUID of the data_provider
 * @param facilityExternalId - External facility ID (e.g., siteId)
 * @param includeTomorrow - Whether to include tomorrow's slots
 * @returns Availability result
 */
export async function fetchTodayAvailability(
  providerId: string,
  facilityExternalId: string | undefined,
  includeTomorrow = true
): Promise<AvailabilityResult> {
  // Format date in local timezone to avoid UTC conversion issues
  const formatDateLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const today = new Date();
  const dates = [formatDateLocal(today)];

  if (includeTomorrow) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    dates.push(formatDateLocal(tomorrow));
  }

  return fetchAvailability(providerId, {
    dates,
    siteId: facilityExternalId ? parseInt(facilityExternalId, 10) : undefined,
  });
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get the current date and time in a specific timezone as a comparable string.
 * Returns format: "YYYY-MM-DD HH:MM:SS" for easy string comparison.
 *
 * @param timezone - IANA timezone identifier (e.g., "America/Toronto")
 * @returns Current datetime string in the specified timezone
 */
function getCurrentDateTimeInTimezone(timezone: string): string {
  const now = new Date();

  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // en-CA gives YYYY-MM-DD, en-GB gives HH:MM:SS in 24h format
  return `${dateFormatter.format(now)} ${timeFormatter.format(now)}`;
}

/**
 * Extract the date and time string from a slot's datetime for comparison.
 * The slot's datetime was created by parsing "YYYY-MM-DDTHH:MM:SS" as local time,
 * but it actually represents the facility's local time.
 *
 * @param slotDatetime - The slot's datetime (created from facility-local time string)
 * @returns DateTime string in "YYYY-MM-DD HH:MM:SS" format
 */
function getSlotDateTimeString(slotDatetime: Date): string {
  // Extract the date/time components as they were stored
  // This works because the slot was created by parsing a string without timezone,
  // so JavaScript stored it as-if it were local time, preserving the original values
  const year = slotDatetime.getFullYear();
  const month = String(slotDatetime.getMonth() + 1).padStart(2, '0');
  const day = String(slotDatetime.getDate()).padStart(2, '0');
  const hours = String(slotDatetime.getHours()).padStart(2, '0');
  const minutes = String(slotDatetime.getMinutes()).padStart(2, '0');
  const seconds = String(slotDatetime.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Filter slots to only future times.
 *
 * When facilityTimezone is provided, the comparison is done based on the
 * current time at the facility's location. This is important when users
 * are in a different timezone than the facility they're viewing.
 *
 * @param slots - Array of availability slots
 * @param facilityTimezone - Optional IANA timezone identifier (e.g., "America/Toronto")
 * @returns Slots that start after now (in facility timezone if provided)
 */
export function filterFutureSlots(
  slots: AvailabilitySlot[],
  facilityTimezone?: string | null
): AvailabilitySlot[] {
  if (facilityTimezone) {
    // Compare based on the current time at the facility's location
    const nowAtFacility = getCurrentDateTimeInTimezone(facilityTimezone);

    return slots.filter(slot => {
      // The slot's datetime represents facility-local time
      const slotDateTime = getSlotDateTimeString(slot.datetime);
      return slotDateTime > nowAtFacility;
    });
  }

  // Fallback: simple comparison (works when user and facility are in same timezone)
  const now = new Date();
  return slots.filter(slot => slot.datetime > now);
}

/**
 * Get the next N available slots.
 *
 * @param slots - Array of availability slots
 * @param count - Number of slots to return
 * @returns Next N slots starting from now
 */
export function getNextSlots(slots: AvailabilitySlot[], count: number = 3): AvailabilitySlot[] {
  return filterFutureSlots(slots)
    .sort((a, b) => a.datetime.getTime() - b.datetime.getTime())
    .slice(0, count);
}

// =============================================================================
// UNIFIED AVAILABILITY FETCHING (LOCAL-FIRST)
// =============================================================================

/**
 * Parameters for unified availability fetching.
 */
export interface UnifiedAvailabilityParams {
  /** Facility UUID */
  facilityId: string;
  /** Dates to fetch (YYYY-MM-DD format) */
  dates: string[];
  /** External provider ID (from data_provider table) */
  dataProviderId?: string | null;
  /** External facility ID (e.g., Loisir Montreal siteId) */
  externalProviderId?: string | null;
  /** Search string to filter results by sport (e.g., "tennis", "pickleball") */
  searchString?: string;
}

/**
 * Fetch availability with local-first priority.
 *
 * Priority:
 * 1. Local templates (court_slot, court_one_time_availability) → use Supabase RPC
 * 2. External provider (data_provider configured) → use provider system
 * 3. Neither → return empty result
 *
 * This unified entry point abstracts away the source of availability,
 * allowing consumers to fetch availability without knowing whether it
 * comes from local templates or external providers.
 *
 * @param params - Unified fetch parameters
 * @returns Availability result with slots
 */
export async function fetchUnifiedAvailability(
  params: UnifiedAvailabilityParams
): Promise<AvailabilityResult> {
  const { facilityId, dates, dataProviderId, externalProviderId, searchString } = params;

  try {
    // 1. Check for local templates (cached for 5 minutes)
    const hasLocal = await hasLocalTemplates(facilityId);

    // 2. Local templates take priority
    if (hasLocal) {
      return fetchLocalAvailability(facilityId, dates);
    }

    // 3. Fall back to external provider
    if (dataProviderId && externalProviderId) {
      return fetchAvailability(dataProviderId, {
        dates,
        siteId: parseInt(externalProviderId, 10),
        searchString,
      });
    }

    // 4. No availability source configured
    return { slots: [], success: true };
  } catch (error) {
    console.error('[AvailabilityService] Error in unified fetch:', error);
    return {
      slots: [],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
