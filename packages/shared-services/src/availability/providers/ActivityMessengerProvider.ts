/**
 * ActivityMessenger Provider
 *
 * Provider for fetching court availability from ActivityMessenger-powered facilities.
 * Used by Stade IGA (Tennis Canada - Stade Jarry) and other AM-based venues.
 * Uses GET requests to the ActivityMessenger public availability API.
 *
 * API format:
 *   GET https://activitymessenger.com/org/{orgId}/package/{packageId}/availability?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Each facility maps to one or more package IDs (stored as external_provider_id,
 * comma-separated when a facility spans several packages — e.g. ATSOM parks run
 * separate tennis and pickleball packages on the same courts).
 * The org ID is shared across all facilities for the venue (stored in api_config.orgId).
 *
 * Membership-gated orgs (e.g. ATSOM) return every slot with disabled=true for
 * anonymous sessions even when courts are free; they opt in to keeping those
 * slots via api_config.includeDisabledSlots.
 *
 * Keep in sync with supabase/functions/refresh-facility-availability/providers.ts.
 */

import { BaseAvailabilityProvider } from './BaseAvailabilityProvider';
import type { AvailabilitySlot, FetchAvailabilityParams, ActivityMessengerEvent } from '../types';

/**
 * Extract court number from an ActivityMessenger location name.
 * Handles patterns like "Intérieur 11", "Terre battue 3", etc.
 */
function extractCourtNumber(name: string | undefined | null): number | undefined {
  if (!name) return undefined;
  const match = name.match(/(\d+)\s*$/);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Format a date string for the ActivityMessenger API query parameter.
 * Input: "2026-04-15" or "2026-04-15T00:00:00.000-04:00"
 * Output: "2026-04-15"
 */
function formatDateParam(dateStr: string): string {
  // If it contains 'T', extract just the date part
  if (dateStr.includes('T')) {
    return dateStr.split('T')[0];
  }
  return dateStr;
}

export class ActivityMessengerProvider extends BaseAvailabilityProvider {
  readonly providerType = 'activity_messenger';

  /**
   * Fetch availability from ActivityMessenger API.
   *
   * @param params - Fetch parameters. facilityExternalId is the package ID.
   * @returns Array of normalized availability slots (one per available court per time slot)
   */
  async fetchAvailability(params: FetchAvailabilityParams): Promise<AvailabilitySlot[]> {
    const orgId = this.getConfigValue('orgId', '');
    const packageIds = (params.facilityExternalId ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (!orgId || packageIds.length === 0) {
      console.error('[ActivityMessengerProvider] Missing orgId or packageId (facilityExternalId)');
      return [];
    }

    // Determine date range from params
    const dates = params.dates.map(formatDateParam);
    const startDate = dates[0];
    // Use last date or default to 7 days after start
    const endDate = dates.length > 1 ? dates[dates.length - 1] : this.addDays(startDate, 7);

    const perPackage = await Promise.all(
      packageIds.map(async packageId => {
        const url = `${this.config.apiBaseUrl}/org/${orgId}/package/${packageId}/availability`;
        try {
          const events = await this.makeRequest<ActivityMessengerEvent[]>(url, {
            method: 'GET',
            queryParams: {
              start: startDate,
              end: endDate,
            },
            headers: {},
            timeout: 30000,
          });

          return this.parseResponse(events, packageId, packageIds.length > 1);
        } catch (error) {
          console.error('[ActivityMessengerProvider] Failed to fetch availability:', error);
          if (error instanceof Error) {
            console.error('[ActivityMessengerProvider] Error details:', error.message, error.name);
          }
          return [];
        }
      })
    );

    return perPackage.flat();
  }

  /**
   * Parse ActivityMessenger events into normalized availability slots.
   * Each event is expanded into individual per-court slots to match the IC3 model.
   */
  private parseResponse(
    events: ActivityMessengerEvent[],
    packageId: string,
    namespaceIds: boolean
  ): AvailabilitySlot[] {
    if (!Array.isArray(events)) {
      return [];
    }

    const slots: AvailabilitySlot[] = [];
    // Membership-gated orgs mark every anonymous-session slot disabled even
    // when courts are free — the flag tracks purchasability, not occupancy.
    const includeDisabled = this.getConfigValue<boolean>('includeDisabledSlots', false) === true;

    for (const event of events) {
      try {
        // Skip disabled events (unless the org opted in via api_config)
        if (event.extendedProps?.disabled && !includeDisabled) {
          continue;
        }

        const parsed = this.parseEvent(event, packageId, namespaceIds);
        slots.push(...parsed);
      } catch (error) {
        console.warn('[ActivityMessengerProvider] Failed to parse event:', event, error);
      }
    }

    return slots;
  }

  /**
   * Parse a single ActivityMessenger event into one or more availability slots.
   * Expands per-court: each available location becomes its own slot.
   */
  private parseEvent(
    event: ActivityMessengerEvent,
    packageId: string,
    namespaceIds: boolean
  ): AvailabilitySlot[] {
    const datetime = new Date(event.start);
    const endDateTime = new Date(event.end);

    if (isNaN(datetime.getTime()) || isNaN(endDateTime.getTime())) {
      return [];
    }

    const props = event.extendedProps;
    const price = props?.price ? parseFloat(props.price) : undefined;
    const availability = props?.availability?.[0];

    if (!availability) {
      return [];
    }

    const slots: AvailabilitySlot[] = [];
    // Dual-lined courts share one AM location id across the sport packages,
    // and event ids are only unique within a package feed — namespace both by
    // package for multi-package facilities so per-court identities stay
    // unique. Single-package facilities keep the legacy format.
    const courtId = (locId: string | number) =>
      namespaceIds ? `${packageId}-${locId}` : String(locId);
    const slotId = (locId: string | number) =>
      namespaceIds ? `${packageId}-${event.id}-${locId}` : `${event.id}-${locId}`;

    // If locations have names, expand into individual court slots
    if (availability.locations && availability.locations.length > 0) {
      for (const location of availability.locations) {
        slots.push({
          datetime,
          endDateTime,
          courtCount: 1,
          facilityId: courtId(location.id),
          facilityScheduleId: slotId(location.id),
          courtName: location.name,
          shortCourtName: location.name,
          courtNumber: location.number ?? extractCourtNumber(location.name),
          bookingUrl:
            this.buildBookingUrl({
              datetime,
              endDateTime,
              courtCount: 1,
              facilityId: packageId,
              facilityScheduleId: slotId(location.id),
            }) ?? undefined,
          price: !isNaN(price ?? NaN) ? price : undefined,
          currency: 'CAD',
        });
      }
    } else if (availability.location_ids && availability.location_ids.length > 0) {
      // Locations array is empty but IDs exist — create slots without court names
      for (const locationId of availability.location_ids) {
        slots.push({
          datetime,
          endDateTime,
          courtCount: 1,
          facilityId: courtId(locationId),
          facilityScheduleId: slotId(locationId),
          bookingUrl:
            this.buildBookingUrl({
              datetime,
              endDateTime,
              courtCount: 1,
              facilityId: packageId,
              facilityScheduleId: slotId(locationId),
            }) ?? undefined,
          price: !isNaN(price ?? NaN) ? price : undefined,
          currency: 'CAD',
        });
      }
    }

    return slots;
  }

  /**
   * Build booking URL for ActivityMessenger.
   * Uses the package page on ActivityMessenger as the booking entry point.
   */
  override buildBookingUrl(slot: AvailabilitySlot): string | null {
    if (!this.config.bookingUrlTemplate) {
      return null;
    }

    const orgId = this.getConfigValue('orgId', '');

    return this.config.bookingUrlTemplate
      .replace('{packageId}', slot.facilityId)
      .replace('{orgId}', orgId);
  }

  /**
   * Add days to a date string.
   */
  private addDays(dateStr: string, days: number): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }
}
