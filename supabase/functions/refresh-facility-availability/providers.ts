/**
 * Deno-portable provider adapters for the snapshot refresh worker.
 *
 * Mirrors `packages/shared-services/src/availability/providers/` but trimmed
 * to what the snapshot pipeline needs:
 *   - No booking-URL building (callers consume snapshot rows by joining
 *     facility metadata; URLs are built downstream).
 *   - No abstract base class — single function per provider.
 *   - Returns a flat, snapshot-shaped row, not the app's AvailabilitySlot.
 *
 * Keep this file in sync with the originals whenever provider response
 * shapes change.
 */

export interface SnapshotRow {
  external_court_id: string;
  slot_start: string;
  slot_end: string;
  is_available: boolean;
  external_slot_id: string | null;
  court_name: string | null;
  court_number: number | null;
  price_cents: number | null;
  currency: string | null;
  /** Resolved by the orchestrator from facility_sport (and court_name for
   *  multi-sport sites). Providers leave this null. */
  sport_id: string | null;
  /** Resolved per-provider booking URL. Set by buildBookingUrl after the
   *  fetch. Stored on the snapshot row so the client can use it directly
   *  without any template knowledge. */
  booking_url: string | null;
  /** Provider's facility-type identifier (IC3 `facility.facilityType.id`,
   *  ActivityMessenger package id). Transient: consumed by the orchestrator's
   *  sport-resolution step and by buildBookingUrl, not persisted to the
   *  snapshot table. */
  external_facility_type_id?: string | null;
  /** Human-readable label for the facility type (e.g. "Terrain tennis ext").
   *  Used as a substring fallback when no id-based mapping exists. */
  external_facility_type_name?: string | null;
}

export interface ProviderConfig {
  providerType: 'ic3_otium' | 'activity_messenger' | string;
  apiBaseUrl: string;
  apiConfig: Record<string, unknown>;
  /** Optional booking-URL template — placeholders resolved by buildBookingUrl. */
  bookingUrlTemplate?: string | null;
  /** External provider id (e.g. IC3 siteId, AM packageId). Needed for AM URLs. */
  externalProviderId?: string | null;
}

export interface FetchParams {
  /** External facility ID (IC3 siteId, or ActivityMessenger packageId —
   *  possibly a comma-separated list for multi-package facilities). */
  externalProviderId: string;
  /** ISO date strings (YYYY-MM-DD), inclusive. Computed in `timezone`. */
  dates: string[];
  /** IANA timezone of the facility (e.g., 'America/Toronto'). Used to keep
   *  date arithmetic in the facility's local calendar instead of UTC. */
  timezone: string | null;
  /** Invocation-wide deadline from the worker. When it fires, in-flight
   *  provider fetches abort so a slow upstream can't blow the wall-clock
   *  budget. Combined with the per-fetch timeout below. */
  signal?: AbortSignal;
}

export interface FetchResult {
  rows: SnapshotRow[];
  /** Best-effort label for the snapshot.source column. */
  source: string;
}

function cleanIC3Name(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  return name.replace(/^#a/i, '').trim();
}

// Mirrors parseCourtNumber in packages/shared-hooks/src/useCourtAvailability.ts —
// keep the two in sync. Handles Montreal IC3 names: "Terrain de tennis no.1",
// "Tennis #8", "Terrain 2"; lettered courts (pickleball "A") yield undefined.
function extractCourtNumber(name: string | null | undefined): number | undefined {
  if (!name) return undefined;
  const cleaned = name.replace(/\([^()]*\)/g, ' '); // drop "(4)"-style court counts (linear, no ReDoS)
  let m = cleaned.match(/(?:n[o°]\.?\s*|#\s*)(\d{1,3})\b/i); // no.N / no N / n°N / #N
  if (!m) m = cleaned.match(/(?:tennis|pickleball|badminton|squash|terrain|court)\D*?(\d{1,3})\b/i);
  return m && m[1] ? parseInt(m[1], 10) : undefined;
}

function priceToCents(p: unknown): number | null {
  if (typeof p !== 'number' || !isFinite(p)) return null;
  return Math.round(p * 100);
}

/**
 * Resolve a provider's booking_url_template against the row + provider config.
 *
 * IC3 templates encode start/end times and the per-slot schedule id, so the
 * URL is per-row. AM templates only need orgId + packageId, so every row at a
 * facility shares one URL. Both shapes are handled here so the worker can
 * stamp `booking_url` on every snapshot row.
 *
 * Returns null when required placeholders can't be filled.
 */
export function buildBookingUrl(config: ProviderConfig, row: SnapshotRow): string | null {
  const template = config.bookingUrlTemplate;
  if (!template) return null;

  if (config.providerType === 'ic3_otium') {
    if (!row.external_slot_id) return null;
    const formatDT = (s: string) => new Date(s).toISOString().replace(/\.\d{3}Z$/, 'Z');
    return template
      .replace('{facilityId}', row.external_court_id)
      .replace('{startDateTime}', formatDT(row.slot_start))
      .replace('{endDateTime}', formatDT(row.slot_end))
      .replace('{facilityScheduleId}', row.external_slot_id);
  }

  if (config.providerType === 'activity_messenger') {
    const orgId = config.apiConfig.orgId as string | undefined;
    // Rows carry the package they came from (multi-package facilities store a
    // comma-separated list in external_provider_id, so the config-level id is
    // only a single-package fallback).
    const packageId =
      row.external_facility_type_id ??
      (config.externalProviderId?.includes(',') ? null : config.externalProviderId);
    if (!packageId) return null;
    let url = template.replace('{packageId}', packageId);
    if (orgId) url = url.replace('{orgId}', orgId);
    return url;
  }

  return null;
}

// =============================================================================
// FETCH HELPERS
// =============================================================================

/** Per-fetch timeout. A single hung upstream caps here instead of dragging the
 *  worker toward its wall-clock ceiling. */
const FETCH_TIMEOUT_MS = 15_000;

/** Signal for one provider fetch: aborts at FETCH_TIMEOUT_MS, or earlier if the
 *  invocation-wide deadline (`parent`) fires first. */
function fetchSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return parent ? AbortSignal.any([timeout, parent]) : timeout;
}

// =============================================================================
// IC3 / Otium
// =============================================================================

interface IC3Slot {
  startDateTime?: string;
  endDateTime?: string;
  facilityScheduleId?: string | number;
  totalPrice?: number;
  canReserve?: { value?: boolean };
  facility?: {
    id?: string | number;
    name?: string;
    site?: { name?: string };
    facilityType?: { id?: string | number; name?: string };
  };
}

interface IC3SearchResponse {
  results?: IC3Slot[];
}

async function fetchIC3(config: ProviderConfig, params: FetchParams): Promise<FetchResult> {
  const searchPath = (config.apiConfig.searchPath as string | undefined) ?? '/public/search';
  const pageSize = (config.apiConfig.defaultLimit as number | undefined) ?? 500;
  const url = `${config.apiBaseUrl}${searchPath}?_=${Date.now()}`;
  const siteId = parseInt(params.externalProviderId, 10);
  // Date format the IC3 endpoints expect — Eastern Time offset, midnight.
  const formattedDates = params.dates.map(d => (d.includes('T') ? d : `${d}T00:00:00.000-04:00`));

  // IC3 truncates at `limit` server-side with no "total" hint, so paginate
  // until we get a short page. Hard cap iterations as a safety net against a
  // bad offset implementation.
  const MAX_PAGES = 20;
  const rows: SnapshotRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = {
      dates: formattedDates,
      siteId: Number.isFinite(siteId) ? siteId : null,
      startTime: null,
      endTime: null,
      boroughIds: null,
      facilityTypeIds: null,
      searchString: null,
      limit: pageSize,
      offset: page * pageSize,
      sortColumn: 'facility.name',
      isSortOrderAsc: true,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: fetchSignal(params.signal),
    });
    if (!res.ok) throw new Error(`IC3 HTTP ${res.status}`);
    const json: IC3SearchResponse = await res.json();

    const results = json.results ?? [];
    for (const item of results) {
      if (!item.startDateTime || !item.endDateTime || !item.facilityScheduleId) continue;
      if (item.canReserve && item.canReserve.value === false) continue;

      const externalCourtId =
        item.facility?.id != null ? String(item.facility.id) : String(item.facilityScheduleId);
      const shortCourtName = cleanIC3Name(item.facility?.name);
      const siteName = cleanIC3Name(item.facility?.site?.name);
      const ftId = item.facility?.facilityType?.id;
      const ftName = item.facility?.facilityType?.name;
      rows.push({
        external_court_id: externalCourtId,
        slot_start: new Date(item.startDateTime).toISOString(),
        slot_end: new Date(item.endDateTime).toISOString(),
        is_available: true,
        external_slot_id: String(item.facilityScheduleId),
        court_name:
          siteName && shortCourtName ? `${siteName} - ${shortCourtName}` : (shortCourtName ?? null),
        court_number: extractCourtNumber(item.facility?.name) ?? null,
        price_cents: priceToCents(item.totalPrice),
        currency: 'CAD',
        sport_id: null,
        booking_url: null,
        external_facility_type_id: ftId != null ? String(ftId) : null,
        external_facility_type_name: ftName ?? null,
      });
    }

    if (results.length < pageSize) break;
  }

  return { rows, source: 'ic3_otium' };
}

// =============================================================================
// ActivityMessenger
// =============================================================================

interface AMLocation {
  id: string | number;
  name?: string;
  number?: number;
}

interface AMAvailability {
  locations?: AMLocation[];
  location_ids?: Array<string | number>;
}

interface AMExtendedProps {
  disabled?: boolean;
  price?: string;
  package_name?: string;
  availability?: AMAvailability[];
}

interface AMEvent {
  id: string | number;
  start: string;
  end: string;
  extendedProps?: AMExtendedProps;
}

async function fetchActivityMessenger(
  config: ProviderConfig,
  params: FetchParams
): Promise<FetchResult> {
  // AM's public availability endpoint requires orgId + a start/end window.
  // Keep this in sync with packages/shared-services/.../ActivityMessengerProvider.ts.
  const orgId = config.apiConfig.orgId as string | undefined;
  if (!orgId) throw new Error('ActivityMessenger: missing api_config.orgId');

  // A facility may span several AM packages (e.g. ATSOM parks run separate
  // tennis and pickleball packages on the same courts) — external_provider_id
  // is then a comma-separated package-id list.
  const packageIds = params.externalProviderId
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Membership-gated orgs (e.g. ATSOM, org 4866) return every slot with
  // disabled=true for anonymous sessions even when courts are free — the
  // flag tracks purchasability for the current session, not occupancy.
  // Such providers opt in to keeping those slots via api_config.
  const includeDisabled = config.apiConfig.includeDisabledSlots === true;

  const sortedDates = [...params.dates].sort();
  const start = sortedDates[0];
  const end = sortedDates[sortedDates.length - 1];

  const perPackage = await Promise.all(
    packageIds.map(async packageId => {
      const url =
        `${config.apiBaseUrl}/org/${orgId}/package/${packageId}/availability` +
        `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: fetchSignal(params.signal),
      });
      if (!res.ok) throw new Error(`ActivityMessenger HTTP ${res.status}`);
      const events: AMEvent[] = await res.json();
      return { packageId, events };
    })
  );

  const rows: SnapshotRow[] = [];
  const wantedDates = new Set(params.dates);
  // wantedDates is already in the facility's local timezone (built by the
  // orchestrator). Format slot dates in the same TZ to compare apples-to-
  // apples, otherwise a late-evening Montreal slot whose UTC date is
  // tomorrow gets filtered out.
  const tz = params.timezone || 'UTC';
  const localDateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  for (const { packageId, events } of perPackage) {
    for (const event of events ?? []) {
      if (event.extendedProps?.disabled && !includeDisabled) continue;
      const slotStart = new Date(event.start);
      const slotEnd = new Date(event.end);
      if (isNaN(slotStart.getTime()) || isNaN(slotEnd.getTime())) continue;

      // Only keep events whose local date falls in the requested window.
      const dateKey = localDateFmt.format(slotStart);
      if (!wantedDates.has(dateKey)) continue;

      const availability = event.extendedProps?.availability?.[0];
      if (!availability) continue;
      const priceCents = priceToCents(
        event.extendedProps?.price != null ? parseFloat(event.extendedProps.price) : undefined
      );
      // The package doubles as AM's facility-type: sport resolution can
      // substring-match the package name ("… Tennis 1h …" / "… Terrain
      // Pickleball 1h …"), and buildBookingUrl reads the id so multi-package
      // facilities link each row to the package it came from.
      const packageName = event.extendedProps?.package_name ?? null;
      // Dual-lined courts share one AM location id across the sport packages
      // (SJM "Terrain 1" is location 9417 in both the tennis and pickleball
      // feeds), and event ids are only unique within a package feed. The
      // snapshot PK is (facility, external_court_id, slot_start), so
      // multi-package facilities must namespace both ids by package or the
      // batch upsert dies on a same-row double-update. Single-package
      // facilities keep the legacy format to avoid churning existing ids.
      const courtId = (locId: string | number) =>
        packageIds.length > 1 ? `${packageId}-${locId}` : String(locId);
      const slotId = (locId: string | number) =>
        packageIds.length > 1 ? `${packageId}-${event.id}-${locId}` : `${event.id}-${locId}`;

      if (availability.locations && availability.locations.length > 0) {
        for (const loc of availability.locations) {
          rows.push({
            external_court_id: courtId(loc.id),
            slot_start: slotStart.toISOString(),
            slot_end: slotEnd.toISOString(),
            is_available: true,
            external_slot_id: slotId(loc.id),
            court_name: loc.name ?? null,
            court_number: loc.number ?? extractCourtNumber(loc.name) ?? null,
            price_cents: priceCents,
            currency: 'CAD',
            sport_id: null,
            booking_url: null,
            external_facility_type_id: packageId,
            external_facility_type_name: packageName,
          });
        }
      } else if (availability.location_ids && availability.location_ids.length > 0) {
        for (const locId of availability.location_ids) {
          rows.push({
            external_court_id: courtId(locId),
            slot_start: slotStart.toISOString(),
            slot_end: slotEnd.toISOString(),
            is_available: true,
            external_slot_id: slotId(locId),
            court_name: null,
            court_number: null,
            price_cents: priceCents,
            currency: 'CAD',
            sport_id: null,
            booking_url: null,
            external_facility_type_id: packageId,
            external_facility_type_name: packageName,
          });
        }
      }
    }
  }

  return { rows, source: 'activity_messenger' };
}

// =============================================================================
// ActiveNet (Active Network / activecommunities.com — City of Toronto courts)
// =============================================================================

interface ANDailyTime {
  id?: number | string;
  start_time?: string;
  end_time?: string;
  available?: boolean;
}

interface ANDailyDetail {
  date?: string;
  /** Observed values: 5 = closed for the day (times empty), 7 = open. Treat
   *  the `times` array as the source of truth rather than the status code. */
  status?: number;
  times?: ANDailyTime[];
}

interface ANDailyResponse {
  headers?: { response_code?: string; response_message?: string };
  body?: { details?: { resource_id?: number; daily_details?: ANDailyDetail[] } };
}

/** ISO instant for a provider-local wall time. ActiveNet returns naive
 *  date + time strings in the facility's local zone, so the UTC offset must be
 *  resolved per-date (DST) before composing an instant. */
function localWallTimeToIso(dateStr: string, timeStr: string, tz: string): string | null {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(probe.getTime())) return null;
  const offsetName = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  })
    .formatToParts(probe)
    .find(p => p.type === 'timeZoneName')?.value; // e.g. "GMT-04:00"
  const offset = offsetName && offsetName !== 'GMT' ? offsetName.replace('GMT', '') : '+00:00';
  const d = new Date(`${dateStr}T${timeStr}${offset}`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * ActiveNet per-resource daily availability.
 *
 * `external_provider_id` is the ActiveNet reservation resource id (one court),
 * or a comma-separated list for multi-court parks. The endpoint is public
 * (no session/CSRF — unlike the bulk quick-reservation POST) and returns an
 * hourly grid per date.
 *
 * Caveats baked into the data (documented in
 * rallia-business/data-and-material/market-research/integration/):
 * - Toronto public courts allow walk-up play even when reservable, so an
 *   `available` slot means "not booked", not "empty court".
 * - Pre-login the API reflects the anonymous view; accuracy improves with an
 *   authenticated session but the anonymous grid is what we poll.
 */
async function fetchActiveNet(config: ProviderConfig, params: FetchParams): Promise<FetchResult> {
  const dailyPath =
    (config.apiConfig.dailyPath as string | undefined) ??
    '/rest/reservation/resource/availability/daily';
  const tz = params.timezone || (config.apiConfig.timezone as string | undefined) || 'UTC';

  const resourceIds = params.externalProviderId
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const sortedDates = [...params.dates].sort();
  const start = sortedDates[0];
  const end = sortedDates[sortedDates.length - 1];
  const wantedDates = new Set(params.dates);

  const perResource = await Promise.all(
    resourceIds.map(async resourceId => {
      const url =
        `${config.apiBaseUrl}${dailyPath}/${encodeURIComponent(resourceId)}` +
        `?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}` +
        `&customer_id=0&company_id=0&locale=en-US`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: fetchSignal(params.signal),
      });
      if (!res.ok) throw new Error(`ActiveNet HTTP ${res.status}`);
      const json: ANDailyResponse = await res.json();
      if (json.headers?.response_code && json.headers.response_code !== '0000') {
        throw new Error(
          `ActiveNet API ${json.headers.response_code}: ${json.headers.response_message ?? 'unknown'}`
        );
      }
      return { resourceId, details: json.body?.details?.daily_details ?? [] };
    })
  );

  const rows: SnapshotRow[] = [];
  for (const { resourceId, details } of perResource) {
    for (const day of details) {
      if (!day.date || !wantedDates.has(day.date)) continue;
      for (const t of day.times ?? []) {
        // Snapshot rows are the *open* inventory — mirror IC3/AM, which only
        // emit reservable slots.
        if (t.available !== true || !t.start_time || !t.end_time) continue;
        const slotStart = localWallTimeToIso(day.date, t.start_time, tz);
        const slotEnd = localWallTimeToIso(day.date, t.end_time, tz);
        if (!slotStart || !slotEnd) continue;
        rows.push({
          external_court_id: resourceId,
          slot_start: slotStart,
          slot_end: slotEnd,
          is_available: true,
          // Slot-template ids repeat across dates, so namespace by date (and
          // resource, for multi-court parks) to keep the snapshot PK unique.
          external_slot_id: `${resourceId}-${day.date}-${t.id ?? t.start_time}`,
          court_name: null, // daily endpoint carries no resource name
          court_number: null,
          price_cents: null, // fees not exposed pre-auth ($5/hr city insurance applies at booking)
          currency: 'CAD',
          sport_id: null,
          booking_url: null,
        });
      }
    }
  }

  return { rows, source: 'active_net' };
}

// =============================================================================
// Dispatcher
// =============================================================================

export async function fetchProviderAvailability(
  config: ProviderConfig,
  params: FetchParams
): Promise<FetchResult> {
  switch (config.providerType) {
    case 'ic3_otium':
      return fetchIC3(config, params);
    case 'activity_messenger':
      return fetchActivityMessenger(config, params);
    case 'active_net':
      return fetchActiveNet(config, params);
    default:
      throw new Error(`Unsupported provider_type: ${config.providerType}`);
  }
}
