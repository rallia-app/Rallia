/**
 * useCourtAvailability Hook
 *
 * Fetches court availability using the unified availability system.
 * Supports both local (org-managed) availability and external providers,
 * with local availability taking priority.
 */

import { useQuery } from '@tanstack/react-query';
import {
  fetchUnifiedAvailability,
  filterFutureSlots,
  isToday,
  formatSlotTime,
  type AvailabilitySlot,
} from '@rallia/shared-services';

// =============================================================================
// TYPES
// =============================================================================

export interface UseCourtAvailabilityOptions {
  /** Facility ID (used as cache key) */
  facilityId: string;
  /** Data provider ID from the facility or organization */
  dataProviderId: string | null;
  /** Provider type for registry lookup (e.g., 'loisir_montreal') */
  dataProviderType: string | null;
  /** External provider ID for the facility (e.g., Loisir Montreal siteId) */
  externalProviderId: string | null;
  /** Booking URL template with placeholders */
  bookingUrlTemplate: string | null;
  /** Facility timezone (IANA format, e.g., "America/Toronto") for accurate future slot filtering */
  facilityTimezone?: string | null;
  /** Dates to fetch availability for (defaults to today and tomorrow) */
  dates?: string[];
  /** Sport name to filter availability by (e.g., "tennis", "pickleball") */
  sportName?: string;
  /** Enable/disable the query (default: true) */
  enabled?: boolean;
  /** Maximum number of slots to return (default: 3) */
  maxSlots?: number;
}

/** Individual court option for selection */
export interface CourtOption {
  /** Court name (e.g., "Tennis Court 1") */
  courtName: string;
  /** Court number extracted from the name (e.g., 1, 2, 3) for translated display */
  courtNumber?: number;
  /** Booking URL for this specific court (null for local slots) */
  bookingUrl: string | null;
  /** Schedule ID (for tracking) */
  facilityScheduleId: string;
  /** External court ID from the provider (e.g., Montreal's facility.id like "172601") */
  externalCourtId: string;
  /** Optional price */
  price?: number;
  /** Court UUID for local slots (for in-app booking) */
  courtId?: string;
  /** Whether this is a local (org-managed) slot */
  isLocalSlot?: boolean;
}

export interface FormattedSlot {
  /** Formatted start time string (e.g., "9:00 AM") */
  time: string;
  /** Formatted end time string (e.g., "10:00 AM") */
  endTime: string;
  /** Number of available courts */
  courtCount: number;
  /** Whether this slot is today */
  isToday: boolean;
  /** Booking URL for this specific slot (first available, null for local slots) */
  bookingUrl: string | null;
  /** Schedule ID (for tracking) */
  facilityScheduleId: string;
  /** External court ID from the provider (e.g., Montreal's facility.id like "172601") */
  externalCourtId: string;
  /** Start datetime (for sorting and calculations) */
  datetime: Date;
  /** End datetime (for duration calculations) */
  endDateTime: Date;
  /** Optional price */
  price?: number;
  /** Available court options when multiple courts at same time */
  courtOptions: CourtOption[];

  // =========================================================================
  // LOCAL SLOT FIELDS (for org-managed availability)
  // =========================================================================

  /** Whether this is a local (org-managed) slot */
  isLocalSlot?: boolean;
  /** Court UUID for local slots (for in-app booking) */
  courtId?: string;
  /** Template source for local slots */
  templateSource?: 'court' | 'facility' | 'one_time';
}

/** Slots grouped by date for sectioned display */
export interface DateGroupedSlots {
  /** Date label (e.g., "Today", "Tomorrow", "Mon, Jan 6") */
  dateLabel: string;
  /** Date string in YYYY-MM-DD format */
  dateKey: string;
  /** Whether this is today */
  isToday: boolean;
  /** Slots for this date */
  slots: FormattedSlot[];
}

export interface UseCourtAvailabilityReturn {
  /** Formatted availability slots for display */
  slots: FormattedSlot[];
  /** Slots grouped by date for sectioned display */
  slotsByDate: DateGroupedSlots[];
  /** Raw availability slots from provider */
  rawSlots: AvailabilitySlot[];
  /** Whether the query is loading */
  isLoading: boolean;
  /** Whether data is being fetched (initial or refetch) */
  isFetching: boolean;
  /** Error if fetch failed */
  error: Error | null;
  /** Whether a provider is available to fetch from */
  hasProvider: boolean;
  /** Refetch the availability data */
  refetch: () => void;
}

// =============================================================================
// QUERY KEYS
// =============================================================================

export const courtAvailabilityKeys = {
  all: ['court-availability'] as const,
  facility: (facilityId: string) => [...courtAvailabilityKeys.all, facilityId] as const,
  facilityWithDates: (facilityId: string, dates: string[]) =>
    [...courtAvailabilityKeys.facility(facilityId), dates.join(',')] as const,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get default dates (today and next 2 days) for availability fetching.
 * Returns the next 3 days: today, tomorrow, and the day after tomorrow.
 */
function getDefaultDates(): string[] {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

  return [
    today.toISOString().split('T')[0],
    tomorrow.toISOString().split('T')[0],
    dayAfterTomorrow.toISOString().split('T')[0],
  ];
}

/**
 * Format a slot time for display.
 */
function formatTime(date: Date): string {
  return formatSlotTime(date);
}

/**
 * Get date key in YYYY-MM-DD format.
 */
function getDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a date label for display (e.g., "Today", "Tomorrow", "Mon, Jan 6").
 */
function formatDateLabel(date: Date): string {
  const now = new Date();
  const today = getDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = getDateKey(tomorrow);
  const dateKey = getDateKey(date);

  if (dateKey === today) {
    return 'Today';
  }
  if (dateKey === tomorrowKey) {
    return 'Tomorrow';
  }

  // Format as "Mon, Jan 6"
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Group formatted slots by date for sectioned display.
 */
function groupSlotsByDate(slots: FormattedSlot[]): DateGroupedSlots[] {
  const grouped = new Map<string, { slots: FormattedSlot[]; date: Date }>();

  for (const slot of slots) {
    const dateKey = getDateKey(slot.datetime);
    const existing = grouped.get(dateKey);

    if (existing) {
      existing.slots.push(slot);
    } else {
      grouped.set(dateKey, { slots: [slot], date: slot.datetime });
    }
  }

  // Convert to array and sort by date
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, { slots: dateSlots, date }]) => ({
      dateLabel: formatDateLabel(date),
      dateKey,
      isToday: isToday(date),
      slots: dateSlots,
    }));
}

/** Extended slot with court options for grouping */
interface GroupedSlot extends AvailabilitySlot {
  courtOptions: CourtOption[];
  /** Map to track unique courts by facilityScheduleId during grouping */
  _courtOptionsMap?: Map<string, CourtOption>;
}

/**
 * Group slots by datetime and endDateTime, collecting unique court options.
 * This prevents duplicate time displays when multiple courts are available at the same time.
 * Courts are deduplicated by facilityScheduleId to ensure each court only appears once.
 *
 * Handles both external slots (with booking URLs) and local slots (with courtId).
 */
function groupSlotsByTime(slots: AvailabilitySlot[]): GroupedSlot[] {
  // Create a map keyed by datetime and endDateTime
  const grouped = new Map<string, GroupedSlot>();

  for (const slot of slots) {
    // Create a unique key from datetime and endDateTime timestamps
    const key = `${slot.datetime.getTime()}-${slot.endDateTime.getTime()}`;

    // Create court option for this slot
    // Local slots may not have booking URLs but should still be included
    // Use shortCourtName for display (e.g., "Court 1") instead of full name
    const hasBookableOption = slot.bookingUrl || slot.isLocalSlot;
    const courtOption: CourtOption | null = hasBookableOption
      ? {
          courtName: slot.shortCourtName || slot.courtName || `Court ${slot.facilityScheduleId}`,
          courtNumber: slot.courtNumber,
          bookingUrl: slot.bookingUrl ?? null,
          facilityScheduleId: slot.facilityScheduleId,
          externalCourtId: slot.facilityId,
          price: slot.price,
          // Local slot fields
          courtId: slot.courtId,
          isLocalSlot: slot.isLocalSlot,
        }
      : null;

    const existing = grouped.get(key);
    if (existing) {
      // Add court option if available and not already added (deduplicate by facilityScheduleId)
      if (courtOption && existing._courtOptionsMap) {
        if (!existing._courtOptionsMap.has(courtOption.facilityScheduleId)) {
          existing._courtOptionsMap.set(courtOption.facilityScheduleId, courtOption);
        }
      }
      // Keep the first booking URL we find (or prefer one with a booking URL)
      if (!existing.bookingUrl && slot.bookingUrl) {
        existing.bookingUrl = slot.bookingUrl;
        existing.facilityScheduleId = slot.facilityScheduleId;
      }
    } else {
      // First slot at this time, create with court options map for deduplication
      const courtOptionsMap = new Map<string, CourtOption>();
      if (courtOption) {
        courtOptionsMap.set(courtOption.facilityScheduleId, courtOption);
      }
      grouped.set(key, {
        ...slot,
        courtOptions: [], // Will be populated from map later
        _courtOptionsMap: courtOptionsMap,
      });
    }
  }

  // Convert court options maps to arrays and calculate court counts
  return Array.from(grouped.values()).map(groupedSlot => {
    const courtOptions = groupedSlot._courtOptionsMap
      ? Array.from(groupedSlot._courtOptionsMap.values())
      : [];
    return {
      ...groupedSlot,
      courtCount: courtOptions.length || 1, // At least 1 if no court options
      courtOptions,
      _courtOptionsMap: undefined, // Remove internal property
    };
  });
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook for fetching court availability using the unified availability system.
 *
 * Features:
 * - Local-first priority: org-managed templates take precedence over external providers
 * - Falls back to external providers (e.g., Loisir Montreal) if no local templates
 * - Returns slots with booking URLs (external) or courtId (local)
 * - Graceful degradation on errors
 * - Short cache time (30s) since availability changes frequently
 *
 * @example
 * ```tsx
 * const { slots, isLoading, hasProvider } = useCourtAvailability({
 *   facilityId: facility.id,
 *   dataProviderId: facility.data_provider_id,
 *   dataProviderType: facility.data_provider_type,
 *   externalProviderId: facility.external_provider_id,
 *   bookingUrlTemplate: facility.booking_url_template,
 * });
 * ```
 */
export function useCourtAvailability(
  options: UseCourtAvailabilityOptions
): UseCourtAvailabilityReturn {
  const {
    facilityId,
    dataProviderId,
    dataProviderType,
    externalProviderId,
    bookingUrlTemplate: _bookingUrlTemplate,
    facilityTimezone,
    sportName,
    dates = getDefaultDates(),
    enabled = true,
    maxSlots = 20, // Increased to show more slots for date-sectioned display
  } = options;

  // Check if we have all required provider configuration:
  // 1. A data provider (from facility or organization)
  // 2. An external provider ID (to filter results for this specific facility)
  const hasProvider = !!dataProviderId && !!dataProviderType && !!externalProviderId;

  const query = useQuery<AvailabilitySlot[], Error>({
    queryKey: courtAvailabilityKeys.facilityWithDates(facilityId, dates),
    queryFn: async () => {
      try {
        // Use unified availability service (local-first)
        const result = await fetchUnifiedAvailability({
          facilityId,
          dates,
          dataProviderId,
          externalProviderId,
          searchString: sportName,
        });

        if (!result.success) {
          console.warn(`[useCourtAvailability] Unified fetch error: ${result.error}`);
          return [];
        }

        return result.slots;
      } catch (error) {
        console.warn('[useCourtAvailability] Failed to fetch availability:', error);
        return []; // Graceful degradation
      }
    },
    // Always enabled - unified service handles both local and external
    enabled: enabled,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });

  // Get future slots, group by time, then limit to maxSlots
  // Use facility timezone to correctly filter slots based on current time at the facility
  const rawSlots = query.data ?? [];
  const futureSlots = filterFutureSlots(rawSlots, facilityTimezone).sort(
    (a, b) => a.datetime.getTime() - b.datetime.getTime()
  );

  // Group slots by datetime/endDateTime to merge multiple courts at the same time
  const groupedSlots = groupSlotsByTime(futureSlots)
    .sort((a, b) => a.datetime.getTime() - b.datetime.getTime())
    .slice(0, maxSlots);

  // Format slots for display
  const formattedSlots: FormattedSlot[] = groupedSlots.map(slot => ({
    time: formatTime(slot.datetime),
    endTime: formatTime(slot.endDateTime),
    courtCount: slot.courtCount,
    isToday: isToday(slot.datetime),
    bookingUrl: slot.bookingUrl ?? null,
    facilityScheduleId: slot.facilityScheduleId,
    externalCourtId: slot.facilityId,
    datetime: slot.datetime,
    endDateTime: slot.endDateTime,
    price: slot.price,
    courtOptions: slot.courtOptions,
    // Local slot fields
    isLocalSlot: slot.isLocalSlot,
    courtId: slot.courtId,
    templateSource: slot.templateSource,
  }));

  // Group slots by date for sectioned display
  const slotsByDate = groupSlotsByDate(formattedSlots);

  return {
    slots: formattedSlots,
    slotsByDate,
    rawSlots,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ?? null,
    hasProvider,
    refetch: query.refetch,
  };
}

export default useCourtAvailability;
