/**
 * Availability Provider Types
 *
 * Shared types for the court availability provider system.
 * These types are used across providers, services, and hooks.
 */

// =============================================================================
// AVAILABILITY SLOT
// =============================================================================

/**
 * Normalized availability slot returned by all providers.
 * Each provider transforms their API response into this format.
 */
export interface AvailabilitySlot {
  /** Start time of the slot */
  datetime: Date;
  /** End time of the slot */
  endDateTime: Date;
  /** Number of available courts at this time */
  courtCount: number;
  /** External facility ID used by the provider */
  facilityId: string;
  /** Schedule/slot ID required for booking URL (provider-specific) */
  facilityScheduleId: string;
  /** Optional full court name with location (e.g., "Parc Jeanne-Mance - Tennis Court 1") */
  courtName?: string;
  /** Optional short court name for display in selection UI (e.g., "Tennis Court 1") */
  shortCourtName?: string;
  /** Court number extracted from the name (e.g., 1, 2, 3) for translated display */
  courtNumber?: number;
  /** Pre-built booking URL for this slot (populated after fetch) */
  bookingUrl?: string;
  /** Optional price information */
  price?: number;
  /** Optional currency code */
  currency?: string;

  // =========================================================================
  // LOCAL SLOT FIELDS (for org-managed availability)
  // =========================================================================

  /** Whether this is a local (org-managed) slot vs external provider */
  isLocalSlot?: boolean;
  /** Court UUID for local slots (needed for in-app booking) */
  courtId?: string;
  /**
   * Source of the availability template:
   * - 'court' - From court-specific recurring court_slot template
   * - 'facility' - From facility-wide recurring court_slot template
   * - 'one_time' - From court_one_time_availability (one-time override)
   * - undefined - External provider slot
   */
  templateSource?: 'court' | 'facility' | 'one_time';
}

// =============================================================================
// PROVIDER CONFIGURATION
// =============================================================================

/**
 * Configuration for a data provider, loaded from the database.
 */
export interface ProviderConfig {
  /** Provider ID (UUID from database) */
  id: string;
  /** Provider type identifier (e.g., 'loisir_montreal') */
  providerType: string;
  /** Base URL for API requests */
  apiBaseUrl: string;
  /** Provider-specific configuration (API paths, auth, defaults) */
  apiConfig: Record<string, unknown>;
  /** URL template for booking with placeholders */
  bookingUrlTemplate: string | null;
}

// =============================================================================
// FETCH PARAMETERS
// =============================================================================

/**
 * Parameters for fetching availability from a provider.
 * Different providers may use different subsets of these params.
 */
export interface FetchAvailabilityParams {
  /** External ID used by the provider (from facility.external_provider_id) */
  facilityExternalId?: string;
  /** Site ID for Loisir Montreal */
  siteId?: number;
  /** Array of ISO date strings to fetch availability for */
  dates: string[];
  /** Start time filter (e.g., "09:00") */
  startTime?: string;
  /** End time filter (e.g., "21:00") */
  endTime?: string;
  /** Optional search string */
  searchString?: string;
  /** Maximum number of results */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

// =============================================================================
// PROVIDER RESULT
// =============================================================================

/**
 * Result from fetching availability, including metadata.
 */
export interface AvailabilityResult {
  /** Array of normalized availability slots */
  slots: AvailabilitySlot[];
  /** Whether the fetch was successful */
  success: boolean;
  /** Error message if fetch failed */
  error?: string;
  /** Total count of available slots (for pagination) */
  totalCount?: number;
}

// =============================================================================
// IC3/OTIUM SPECIFIC TYPES
// Used by all IC3/Otium municipalities (Montreal, Boucherville, Blainville, etc.)
// =============================================================================

/**
 * IC3/Otium API search request body.
 *
 * Note: dates must be in ISO format with timezone, e.g., "2025-06-04T00:00:00.000-04:00"
 */
export interface IC3SearchRequest {
  /** Array of ISO date strings with timezone (e.g., "2025-06-04T00:00:00.000-04:00") */
  dates: string[];
  boroughIds: string | null;
  /** Site ID to filter by (e.g., 1726 for a specific park) */
  siteId: number | null;
  facilityTypeIds: string | string[] | null;
  /** Start time filter in HH:mm format (e.g., "09:00") */
  startTime: string | null;
  /** End time filter in HH:mm format (e.g., "21:00") */
  endTime: string | null;
  /** Search string to filter results (e.g., "tennis") */
  searchString: string | null;
  limit: number;
  offset: number;
  sortColumn: string;
  isSortOrderAsc: boolean;
}

/**
 * IC3/Otium API borough.
 */
export interface IC3Borough {
  $id: string;
  id: number;
  name: string;
  externalId: string | null;
}

/**
 * IC3/Otium API site (location/park).
 */
export interface IC3Site {
  $id: string;
  id: number;
  name: string;
  address: string;
  publicPhone: string | null;
  fax: string | null;
  boroughs: IC3Borough[];
}

/**
 * IC3/Otium API facility type.
 */
export interface IC3FacilityType {
  $id: string;
  id: number;
  name: string;
  description: string;
}

/**
 * IC3/Otium API facility (court).
 */
export interface IC3Facility {
  $id: string;
  id: number;
  name: string;
  isMembershipRequired: boolean;
  site: IC3Site;
  facilityType: IC3FacilityType;
}

/**
 * IC3/Otium API reservation status.
 */
export interface IC3CanReserve {
  $id: string;
  value: boolean;
  validationResult: {
    entityType: string | null;
    extraParameter: string | null;
    parameters: unknown[];
    dateTimeParameters: unknown[];
    resultType: string;
    rule: string;
    warning: boolean;
  };
}

/**
 * IC3/Otium API slot response item.
 */
export interface IC3Slot {
  $id: string;
  facility: IC3Facility;
  startDateTime: string;
  endDateTime: string;
  priorNoticeDelayInMinutes: number;
  facilityScheduleId: number;
  totalPrice: number;
  canReserve: IC3CanReserve;
  facilityPricingId: number;
}

/**
 * IC3/Otium API search response.
 */
export interface IC3SearchResponse {
  results: IC3Slot[];
  recordCount: number;
}

// Backward-compatible aliases
export type LoisirMontrealSearchRequest = IC3SearchRequest;
export type LoisirMontrealBorough = IC3Borough;
export type LoisirMontrealSite = IC3Site;
export type LoisirMontrealFacilityType = IC3FacilityType;
export type LoisirMontrealFacility = IC3Facility;
export type LoisirMontrealCanReserve = IC3CanReserve;
export type LoisirMontrealSlot = IC3Slot;
export type LoisirMontrealSearchResponse = IC3SearchResponse;

// =============================================================================
// ACTIVITY MESSENGER SPECIFIC TYPES
// Used by ActivityMessenger-powered facilities (Stade IGA, etc.)
// =============================================================================

/**
 * Single location (court) in an ActivityMessenger availability event.
 */
export interface ActivityMessengerLocation {
  id: number;
  name: string;
  number?: number;
}

/**
 * Availability detail within an ActivityMessenger event.
 */
export interface ActivityMessengerAvailabilityDetail {
  location_ids: number[];
  locations: ActivityMessengerLocation[];
  duration: number;
  pre_buffer: number;
  post_buffer: number;
  allow_choice: boolean;
  display: boolean;
  do_not_reserve: boolean;
}

/**
 * Hint about availability count and court names.
 */
export interface ActivityMessengerHintAvailability {
  count: number;
  locations: string[];
  title: string | null;
  inline: string | null;
}

/**
 * Extended properties of an ActivityMessenger calendar event.
 */
export interface ActivityMessengerExtendedProps {
  package_id: number;
  package_name: string;
  package_category_id: number;
  package_category_name: string;
  price: string;
  step: number;
  duration: number;
  pre_buffer: number;
  post_buffer: number;
  availability: ActivityMessengerAvailabilityDetail[];
  hint_availability: ActivityMessengerHintAvailability;
  requires_coupon: boolean;
  disabled: boolean;
}

/**
 * FullCalendar-compatible event from ActivityMessenger API.
 */
export interface ActivityMessengerEvent {
  id: number;
  start: string;
  end: string;
  title: string;
  url: string;
  borderColor: string;
  extendedProps: ActivityMessengerExtendedProps;
}

// =============================================================================
// HTTP REQUEST OPTIONS
// =============================================================================

/**
 * Options for making HTTP requests via the base provider.
 */
export interface HttpRequestOptions {
  /** HTTP method */
  method: 'GET' | 'POST';
  /** Request body for POST requests */
  body?: Record<string, unknown>;
  /** Query parameters for GET requests */
  queryParams?: Record<string, string>;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
}
