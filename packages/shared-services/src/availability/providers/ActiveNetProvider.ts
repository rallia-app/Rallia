/**
 * ActiveNet Provider
 *
 * Provider for court availability from Active Network (activecommunities.com)
 * municipal reservation systems. First deployment: City of Toronto outdoor
 * courts ("Courts" reservation group, id 2).
 *
 * API format (public, no session/CSRF — unlike the bulk quick-reservation POST):
 *   GET {apiBaseUrl}/rest/reservation/resource/availability/daily/{resourceId}
 *       ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&customer_id=0&company_id=0&locale=en-US
 *
 * Each facility maps to one ActiveNet reservation resource id (one court), or a
 * comma-separated list for multi-court parks. Times come back as naive local
 * wall-clock strings, so instants are composed with a per-date offset resolved
 * from api_config.timezone (DST-safe).
 *
 * Domain caveats (see rallia-business market-research/integration notes):
 * - Toronto public courts allow walk-up play even when reservable, so an
 *   available slot means "not booked", not "court is empty".
 * - The anonymous grid understates availability vs an authenticated session;
 *   we poll the anonymous view.
 * - A $5/hr City of Toronto insurance fee applies at booking time and is not
 *   exposed by this endpoint, so slots carry no price.
 *
 * Keep in sync with supabase/functions/refresh-facility-availability/providers.ts.
 */

import { BaseAvailabilityProvider } from './BaseAvailabilityProvider';
import type { AvailabilitySlot, FetchAvailabilityParams } from '../types';

interface ActiveNetDailyTime {
  id?: number | string;
  start_time?: string;
  end_time?: string;
  available?: boolean;
}

interface ActiveNetDailyDetail {
  date?: string;
  /** Observed: 5 = closed for the day (times empty), 7 = open. The `times`
   *  array is authoritative; the status code is not consulted. */
  status?: number;
  times?: ActiveNetDailyTime[];
}

interface ActiveNetDailyResponse {
  headers?: { response_code?: string; response_message?: string };
  body?: { details?: { resource_id?: number; daily_details?: ActiveNetDailyDetail[] } };
}

/** Strip a possible time component: "2026-07-24T…" → "2026-07-24". */
function formatDateParam(dateStr: string): string {
  return dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
}

/** Resolve a naive local wall time to a Date using the zone's offset on that
 *  date (probed at midday so DST transitions don't skew it). */
function localWallTimeToDate(dateStr: string, timeStr: string, tz: string): Date | null {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(probe.getTime())) return null;
  const offsetName = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  })
    .formatToParts(probe)
    .find(p => p.type === 'timeZoneName')?.value;
  const offset = offsetName && offsetName !== 'GMT' ? offsetName.replace('GMT', '') : '+00:00';
  const d = new Date(`${dateStr}T${timeStr}${offset}`);
  return isNaN(d.getTime()) ? null : d;
}

export class ActiveNetProvider extends BaseAvailabilityProvider {
  readonly providerType = 'active_net';

  /**
   * Fetch availability from the ActiveNet per-resource daily endpoint.
   *
   * @param params - Fetch parameters. facilityExternalId is the ActiveNet
   *                 reservation resource id (comma-separated for multi-court parks).
   * @returns Array of normalized availability slots (available slots only)
   */
  async fetchAvailability(params: FetchAvailabilityParams): Promise<AvailabilitySlot[]> {
    const resourceIds = (params.facilityExternalId ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (resourceIds.length === 0) {
      console.error('[ActiveNetProvider] Missing facilityExternalId (resource id)');
      return [];
    }

    const dailyPath = this.getConfigValue(
      'dailyPath',
      '/rest/reservation/resource/availability/daily'
    );
    const tz = this.getConfigValue('timezone', 'America/Toronto');

    const dates = params.dates.map(formatDateParam).sort();
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    const wantedDates = new Set(dates);

    const perResource = await Promise.all(
      resourceIds.map(async resourceId => {
        const url = `${this.config.apiBaseUrl}${dailyPath}/${encodeURIComponent(resourceId)}`;
        try {
          const response = await this.makeRequest<ActiveNetDailyResponse>(url, {
            method: 'GET',
            queryParams: {
              start_date: startDate,
              end_date: endDate,
              customer_id: '0',
              company_id: '0',
              locale: 'en-US',
            },
            headers: {},
            timeout: 15000,
          });
          if (response.headers?.response_code && response.headers.response_code !== '0000') {
            console.error(
              '[ActiveNetProvider] API error',
              response.headers.response_code,
              response.headers.response_message
            );
            return [];
          }
          return this.parseResponse(response, resourceId, tz, wantedDates);
        } catch (error) {
          console.error('[ActiveNetProvider] Failed to fetch availability:', error);
          return [];
        }
      })
    );

    return perResource.flat();
  }

  /** Expand the daily grid into per-slot entries, keeping available slots only. */
  private parseResponse(
    response: ActiveNetDailyResponse,
    resourceId: string,
    tz: string,
    wantedDates: Set<string>
  ): AvailabilitySlot[] {
    const slots: AvailabilitySlot[] = [];
    for (const day of response.body?.details?.daily_details ?? []) {
      if (!day.date || !wantedDates.has(day.date)) continue;
      for (const t of day.times ?? []) {
        if (t.available !== true || !t.start_time || !t.end_time) continue;
        const start = localWallTimeToDate(day.date, t.start_time, tz);
        const end = localWallTimeToDate(day.date, t.end_time, tz);
        if (!start || !end) continue;
        slots.push({
          datetime: start,
          endDateTime: end,
          courtCount: 1,
          facilityId: resourceId,
          // Slot-template ids repeat across dates; namespace by resource + date.
          facilityScheduleId: `${resourceId}-${day.date}-${t.id ?? t.start_time}`,
        });
      }
    }
    return slots;
  }
}
