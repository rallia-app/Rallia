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
}

export interface ProviderConfig {
  providerType: 'ic3_otium' | 'activity_messenger' | string;
  apiBaseUrl: string;
  apiConfig: Record<string, unknown>;
}

export interface FetchParams {
  /** External facility ID (IC3 siteId or ActivityMessenger packageId). */
  externalProviderId: string;
  /** ISO date strings (YYYY-MM-DD), inclusive. */
  dates: string[];
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

function extractCourtNumber(name: string | null | undefined): number | undefined {
  if (!name) return undefined;
  const m = name.match(/(?:terrain|court)\s*(?:\w+\s+)?(\d+)/i) || name.match(/(\d+)\s*$/);
  return m && m[1] ? parseInt(m[1], 10) : undefined;
}

function priceToCents(p: unknown): number | null {
  if (typeof p !== 'number' || !isFinite(p)) return null;
  return Math.round(p * 100);
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
  };
}

interface IC3SearchResponse {
  results?: IC3Slot[];
}

async function fetchIC3(config: ProviderConfig, params: FetchParams): Promise<FetchResult> {
  const searchPath = (config.apiConfig.searchPath as string | undefined) ?? '/public/search';
  const defaultLimit = (config.apiConfig.defaultLimit as number | undefined) ?? 500;
  const url = `${config.apiBaseUrl}${searchPath}?_=${Date.now()}`;
  const siteId = parseInt(params.externalProviderId, 10);
  // Date format the IC3 endpoints expect — Eastern Time offset, midnight.
  const formattedDates = params.dates.map(d => (d.includes('T') ? d : `${d}T00:00:00.000-04:00`));

  const body = {
    dates: formattedDates,
    siteId: Number.isFinite(siteId) ? siteId : null,
    startTime: null,
    endTime: null,
    boroughIds: null,
    facilityTypeIds: null,
    searchString: null,
    limit: defaultLimit,
    offset: 0,
    sortColumn: 'facility.name',
    isSortOrderAsc: true,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let json: IC3SearchResponse;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`IC3 HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timeout);
  }

  const rows: SnapshotRow[] = [];
  for (const item of json.results ?? []) {
    if (!item.startDateTime || !item.endDateTime || !item.facilityScheduleId) continue;
    if (item.canReserve && item.canReserve.value === false) continue;

    const externalCourtId =
      item.facility?.id != null ? String(item.facility.id) : String(item.facilityScheduleId);
    const shortCourtName = cleanIC3Name(item.facility?.name);
    const siteName = cleanIC3Name(item.facility?.site?.name);
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
    });
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
  // ActivityMessenger's public endpoint takes a packageId and returns a
  // calendar payload spanning roughly the next ~3 days.
  const url = `${config.apiBaseUrl}/api/v1/calendar/package/${params.externalProviderId}/events`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let events: AMEvent[];
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ActivityMessenger HTTP ${res.status}`);
    events = await res.json();
  } finally {
    clearTimeout(timeout);
  }

  const rows: SnapshotRow[] = [];
  const wantedDates = new Set(params.dates);
  for (const event of events ?? []) {
    if (event.extendedProps?.disabled) continue;
    const slotStart = new Date(event.start);
    const slotEnd = new Date(event.end);
    if (isNaN(slotStart.getTime()) || isNaN(slotEnd.getTime())) continue;

    // Only keep events whose date falls in the requested window.
    const dateKey = slotStart.toISOString().slice(0, 10);
    if (!wantedDates.has(dateKey)) continue;

    const availability = event.extendedProps?.availability?.[0];
    if (!availability) continue;
    const priceCents = priceToCents(
      event.extendedProps?.price != null ? parseFloat(event.extendedProps.price) : undefined
    );

    if (availability.locations && availability.locations.length > 0) {
      for (const loc of availability.locations) {
        rows.push({
          external_court_id: String(loc.id),
          slot_start: slotStart.toISOString(),
          slot_end: slotEnd.toISOString(),
          is_available: true,
          external_slot_id: `${event.id}-${loc.id}`,
          court_name: loc.name ?? null,
          court_number: loc.number ?? extractCourtNumber(loc.name) ?? null,
          price_cents: priceCents,
          currency: 'CAD',
        });
      }
    } else if (availability.location_ids && availability.location_ids.length > 0) {
      for (const locId of availability.location_ids) {
        rows.push({
          external_court_id: String(locId),
          slot_start: slotStart.toISOString(),
          slot_end: slotEnd.toISOString(),
          is_available: true,
          external_slot_id: `${event.id}-${locId}`,
          court_name: null,
          court_number: null,
          price_cents: priceCents,
          currency: 'CAD',
        });
      }
    }
  }

  return { rows, source: 'activity_messenger' };
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
    default:
      throw new Error(`Unsupported provider_type: ${config.providerType}`);
  }
}
