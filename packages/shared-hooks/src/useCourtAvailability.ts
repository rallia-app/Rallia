/**
 * useCourtAvailability Hook
 *
 * Fetches court availability using the unified availability system.
 * Supports both local (org-managed) availability and external providers,
 * with local availability taking priority.
 */

import { useQuery } from '@tanstack/react-query';
import {
  hasLocalTemplates,
  fetchLocalAvailability,
  filterFutureSlots,
  isToday,
  formatSlotTime,
  supabase,
  type AvailabilitySlot,
} from '@rallia/shared-services';

// Mirror the snapshot's coverage window. Anything beyond this is not in
// the snapshot, so the hook would return empty for it anyway.
const SNAPSHOT_HORIZON_DAYS = 3;
const COLD_START_POLL_INTERVAL_MS = 1000;
const COLD_START_POLL_MAX_ATTEMPTS = 10;

// =============================================================================
// TYPES
// =============================================================================

export interface UseCourtAvailabilityOptions {
  /** Facility ID (used as cache key) */
  facilityId: string;
  /** Data provider ID from the facility or organization */
  dataProviderId: string | null;
  /** Provider type for registry lookup (e.g., 'ic3_otium', 'activity_messenger') */
  dataProviderType: string | null;
  /** External provider ID for the facility (e.g., IC3 siteId, ActivityMessenger packageId) */
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
// SNAPSHOT → AvailabilitySlot ADAPTER
// =============================================================================

interface SnapshotRow {
  external_court_id: string;
  slot_start: string;
  slot_end: string;
  external_slot_id: string | null;
  court_name: string | null;
  court_number: number | null;
  price_cents: number | null;
  currency: string | null;
  source: string;
  sport_id: string | null;
}

// Memoize sport.name → sport.id for the session. The sport table has a
// handful of rows and never changes during a session, so one lookup is
// enough. Snapshot rows store sport_id; callers still pass sportName for
// historical reasons.
let sportIdByNameCache: Promise<Map<string, string>> | null = null;
async function getSportIdByName(name: string): Promise<string | null> {
  if (!sportIdByNameCache) {
    sportIdByNameCache = (async () => {
      const { data, error } = await supabase.from('sport').select('id, name');
      if (error || !data) return new Map();
      return new Map(data.map(s => [s.name.toLowerCase(), s.id]));
    })();
  }
  const m = await sportIdByNameCache;
  return m.get(name.toLowerCase()) ?? null;
}

/**
 * Provider-specific booking-URL builder, replicating the logic that
 * `IC3OtiumProvider.buildBookingUrl` and `ActivityMessengerProvider.buildBookingUrl`
 * apply at fetch time. The snapshot stores raw provider data, not the
 * built URL, so we reconstruct here.
 */
function buildSnapshotBookingUrl(
  template: string | null,
  providerType: string | null,
  externalProviderId: string | null,
  row: SnapshotRow
): string | null {
  if (!template) return null;

  if (providerType === 'ic3_otium') {
    if (!row.external_slot_id) return null;
    const formatDT = (s: string) => new Date(s).toISOString().replace(/\.\d{3}Z$/, 'Z');
    return template
      .replace('{facilityId}', row.external_court_id)
      .replace('{startDateTime}', formatDT(row.slot_start))
      .replace('{endDateTime}', formatDT(row.slot_end))
      .replace('{facilityScheduleId}', row.external_slot_id);
  }

  if (providerType === 'activity_messenger') {
    // ActivityMessenger URLs point at the package overview page, not a
    // specific slot — so every slot at this facility shares one URL.
    if (!externalProviderId) return null;
    return template.replace('{packageId}', externalProviderId);
  }

  return null;
}

/**
 * Convert raw snapshot rows into the AvailabilitySlot shape the rest of the
 * hook (groupSlotsByTime, formatting, etc.) already knows how to consume.
 */
function snapshotRowsToAvailabilitySlots(
  rows: SnapshotRow[],
  bookingUrlTemplate: string | null,
  providerType: string | null,
  externalProviderId: string | null
): AvailabilitySlot[] {
  // Sport scoping is handled DB-side via sport_id (stamped at ingestion by
  // the refresh worker). No client-side filter needed here.
  const out: AvailabilitySlot[] = [];
  for (const row of rows) {
    const slotStart = new Date(row.slot_start);
    const slotEnd = new Date(row.slot_end);
    const bookingUrl = buildSnapshotBookingUrl(
      bookingUrlTemplate,
      providerType,
      externalProviderId,
      row
    );
    out.push({
      datetime: slotStart,
      endDateTime: slotEnd,
      courtCount: 1,
      facilityId: row.external_court_id,
      facilityScheduleId: row.external_slot_id ?? row.external_court_id,
      courtName: row.court_name ?? undefined,
      shortCourtName: row.court_name ?? undefined,
      courtNumber: row.court_number ?? undefined,
      bookingUrl: bookingUrl ?? undefined,
      price: row.price_cents != null ? row.price_cents / 100 : undefined,
      currency: row.currency ?? undefined,
    });
  }
  return out;
}

async function readSnapshotRows(
  facilityId: string,
  sportId: string | null
): Promise<SnapshotRow[]> {
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + SNAPSHOT_HORIZON_DAYS * 24 * 60 * 60 * 1000);
  let query = supabase
    .from('facility_availability_snapshot')
    .select(
      'external_court_id, slot_start, slot_end, external_slot_id, court_name, court_number, price_cents, currency, source, sport_id'
    )
    .eq('facility_id', facilityId)
    .eq('is_available', true)
    .gte('slot_start', now.toISOString())
    .lte('slot_start', horizonEnd.toISOString())
    .order('slot_start');
  if (sportId) query = query.eq('sport_id', sportId);
  const { data, error } = await query;
  if (error) {
    console.warn('[useCourtAvailability] snapshot read error:', error.message);
    return [];
  }
  return (data ?? []) as SnapshotRow[];
}

async function readEverRefreshed(facilityId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('facility_refresh_log')
    .select('facility_id')
    .eq('facility_id', facilityId)
    .maybeSingle();
  if (error) {
    console.warn('[useCourtAvailability] refresh log read error:', error.message);
    return false;
  }
  return !!data;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    queryKey: courtAvailabilityKeys.facilityWithDates(facilityId, dates).concat(sportName ?? ''),
    queryFn: async () => {
      try {
        // Local-first: org-managed facilities serve from in-app templates,
        // never go through the snapshot. Same path as before.
        const hasLocal = await hasLocalTemplates(facilityId);
        if (hasLocal) {
          const result = await fetchLocalAvailability(facilityId, dates);
          if (!result.success) {
            console.warn(`[useCourtAvailability] Local fetch error: ${result.error}`);
            return [];
          }
          return result.slots;
        }

        // No local templates AND no external provider → nothing to serve.
        // Preserves the original behavior where the hook was gated off
        // entirely for these facilities.
        if (!hasProvider) {
          return [];
        }

        // Resolve sportName → sport_id once; the snapshot filter uses sport_id.
        const sportId = sportName ? await getSportIdByName(sportName) : null;

        // External-provider path: read the snapshot. Step 1-2 populate it;
        // Step 3 keeps it warm via the suggestion-service SWR trigger.
        // Here we add a focused cold-start poll so a user opening this
        // facility for the first time doesn't see an empty state.
        const [snapshotRows, everRefreshed] = await Promise.all([
          readSnapshotRows(facilityId, sportId),
          readEverRefreshed(facilityId),
        ]);

        if (everRefreshed) {
          // Snapshot has data (possibly empty if the provider had no
          // inventory in the window). Always trigger a refresh: the DB-side
          // RPC filters by snapshot_needs_refresh, so this is a no-op when
          // the data is already fresh. Fire-and-forget.
          void supabase.rpc('request_facility_refresh', {
            p_facility_ids: [facilityId],
          });
          return snapshotRowsToAvailabilitySlots(
            snapshotRows,
            _bookingUrlTemplate,
            dataProviderType,
            externalProviderId
          );
        }

        // Cold start: trigger a refresh and poll briefly for snapshot
        // rows to appear. After the poll budget elapses we return what's
        // there (possibly empty) — TanStack will refetch on the next user
        // interaction.
        await supabase.rpc('request_facility_refresh', {
          p_facility_ids: [facilityId],
        });
        for (let i = 0; i < COLD_START_POLL_MAX_ATTEMPTS; i++) {
          await sleep(COLD_START_POLL_INTERVAL_MS);
          const polled = await readSnapshotRows(facilityId, sportId);
          if (polled.length > 0) {
            return snapshotRowsToAvailabilitySlots(
              polled,
              _bookingUrlTemplate,
              dataProviderType,
              externalProviderId
            );
          }
        }
        return [];
      } catch (error) {
        console.warn('[useCourtAvailability] Failed to fetch availability:', error);
        return [];
      }
    },
    // hasProvider gates the external path; the queryFn handles the local
    // branch internally, so the hook is still enabled when only local
    // templates exist. We can't introspect that here (it's an async
    // check), so we trust the caller's enabled flag.
    enabled: enabled && (hasProvider || !!facilityId),
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
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
