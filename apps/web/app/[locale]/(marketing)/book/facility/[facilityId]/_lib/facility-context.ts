import { createServiceRoleClient } from '@/lib/supabase/server';

/** One bookable court inside a time group — carries its own exact provider URL. */
export type WebBookCourtOption = {
  externalCourtId: string;
  externalSlotId: string | null;
  courtName: string | null;
  /** `courtName` with the facility prefix/echo stripped, for use as a button label. */
  shortCourtName: string | null;
  courtNumber: number | null;
  priceCents: number | null;
  currency: string | null;
  bookingUrl: string | null;
};

/**
 * All courts open at one start–end time. Mirrors the mobile FormattedSlot
 * grouping (groupSlotsByTime keys on datetime+endDateTime), so a /courts chip
 * maps 1:1 onto a group here.
 */
export type WebBookSlotGroup = {
  slotStart: string;
  slotEnd: string;
  courts: WebBookCourtOption[];
};

export type WebBookFacilityContext = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  organization_nature: string | null;
  is_first_come_first_serve: boolean;
  membership_required: boolean;
  /** Sport the rating step collects a level for (the facility's first active sport). */
  sport: { id: string; name: string; slug: string } | null;
  /** The time group the visitor clicked, when `?start=` resolved to open rows. */
  selectedGroup: WebBookSlotGroup | null;
  /** A slot was requested but no longer has open rows (booked out or stale link). */
  slotMissing: boolean;
  /** Upcoming open time groups, for the facility summary panel. */
  upcomingGroups: WebBookSlotGroup[];
  /**
   * Facility-level booking entry point rendered from the provider template.
   * Used ONLY when no specific slot was clicked — a clicked slot redirects to
   * its own court's URL, never to this. Resolved server-side from our own
   * provider rows, so the page can't be turned into an open redirect.
   */
  facilityBookingUrl: string | null;
};

const SNAPSHOT_HORIZON_DAYS = 14;
const UPCOMING_GROUP_LIMIT = 8;

type SnapshotRow = {
  external_court_id: string;
  external_slot_id: string | null;
  slot_start: string;
  slot_end: string;
  court_name: string | null;
  court_number: number | null;
  price_cents: number | null;
  currency: string | null;
  booking_url: string | null;
};

/**
 * Only ever hand back an absolute http(s) URL. Provider rows are ours, but a
 * malformed template shouldn't be able to produce a `javascript:` or relative
 * destination that we then send a visitor to.
 */
function normalizeBookingUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Providers hand us fully-qualified court names, e.g. "Parc La Fontaine,
 * terrains sportifs - Terrain de tennis #1, La Fontaine". Rendered as-is,
 * a dozen of those are unreadable in a picker, and court_number alone is
 * ambiguous (pickleball 9 Est and 9 Ouest are both number 9). So keep the
 * court's own segment and drop the facility noise around it.
 */
function shortenCourtName(name: string): string {
  const dash = name.lastIndexOf(' - ');
  let label = name;

  if (dash !== -1) {
    const tail = name.slice(dash + 3);
    const head = name.slice(0, dash);
    // Strip the prefix when the head reads like a qualified facility name
    // ("Parc X, terrains sportifs") or the tail still carries a court number.
    // Both signals are needed: La Fontaine's volleyball court has no number,
    // and "Tennis Court 3 - North" has no qualified head, so requiring either
    // one alone would mangle a real case.
    if (head.includes(', ') || /\d/.test(tail)) {
      const comma = tail.lastIndexOf(', ');
      const suffix = comma > 0 ? tail.slice(comma + 2).trim() : '';
      // A trailing segment echoing the facility name is noise.
      label =
        suffix && head.toLowerCase().includes(suffix.toLowerCase()) ? tail.slice(0, comma) : tail;
    }
  }

  return label.trim();
}

function toCourtOption(row: SnapshotRow): WebBookCourtOption {
  return {
    externalCourtId: row.external_court_id,
    externalSlotId: row.external_slot_id,
    courtName: row.court_name,
    shortCourtName: row.court_name ? shortenCourtName(row.court_name) : null,
    courtNumber: row.court_number,
    priceCents: row.price_cents,
    currency: row.currency,
    bookingUrl: normalizeBookingUrl(row.booking_url),
  };
}

/**
 * Group rows into time groups the same way the mobile groupSlotsByTime does:
 * key on start+end, dedupe courts within a group (by slot id, falling back to
 * court id), keep chronological order.
 */
function groupRowsByTime(rows: SnapshotRow[]): WebBookSlotGroup[] {
  const groups = new Map<string, WebBookSlotGroup & { _seen: Set<string> }>();

  for (const row of rows) {
    const key = `${row.slot_start}|${row.slot_end}`;
    const courtKey = row.external_slot_id ?? row.external_court_id;
    let group = groups.get(key);
    if (!group) {
      group = { slotStart: row.slot_start, slotEnd: row.slot_end, courts: [], _seen: new Set() };
      groups.set(key, group);
    }
    if (!group._seen.has(courtKey)) {
      group._seen.add(courtKey);
      group.courts.push(toCourtOption(row));
    }
  }

  return Array.from(groups.values()).map(({ _seen: _ignored, ...group }) => group);
}

/**
 * Facility-level fallback for the "Book" button when no specific slot was
 * clicked. IC3 templates need per-slot placeholders we don't have here, so
 * they collapse to the provider's base URL; Activity Messenger templates only
 * need org/package ids and render in full. Mirrors buildBookingUrl in the
 * refresh-facility-availability worker.
 */
function renderFacilityTemplate(
  providerType: string | null,
  template: string | null,
  apiConfig: Record<string, unknown> | null,
  externalProviderId: string | null
): string | null {
  if (!template) return null;

  if (providerType === 'activity_messenger') {
    if (!externalProviderId) return null;
    let url = template.replace('{packageId}', externalProviderId);
    const orgId = apiConfig?.orgId;
    if (typeof orgId === 'string') url = url.replace('{orgId}', orgId);
    return url.includes('{') ? null : normalizeBookingUrl(url);
  }

  // Everything before the first placeholder is the provider's own entry point.
  const placeholderIndex = template.indexOf('{');
  const base = placeholderIndex === -1 ? template : template.slice(0, placeholderIndex);
  return normalizeBookingUrl(base.replace(/[#/?]+$/, ''));
}

/** Parse a `?start=` / `?end=` param into a comparable ISO instant, or null. */
function parseInstant(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export async function getFacilityForWebBooking(
  facilityId: string,
  slotStart: string | null,
  slotEnd: string | null
): Promise<WebBookFacilityContext | null> {
  const supabase = createServiceRoleClient();

  const { data: facility } = await supabase
    .from('facility')
    .select(
      `id, name, city, address, latitude, longitude, timezone, is_active,
       is_first_come_first_serve, membership_required,
       data_provider_id, external_provider_id,
       organization:organization_id (data_provider_id, nature),
       facility_sports:facility_sport (sport:sport_id (id, name, slug, is_active))`
    )
    .eq('id', facilityId)
    .maybeSingle();

  if (!facility || facility.is_active === false) return null;

  const organization = Array.isArray(facility.organization)
    ? facility.organization[0]
    : facility.organization;

  // Facility-level provider wins over the organization's, same precedence as
  // search_facilities_nearby and facilityService.getFacilityById.
  const providerId =
    facility.data_provider_id ??
    (organization && typeof organization === 'object' && 'data_provider_id' in organization
      ? (organization.data_provider_id as string | null)
      : null);

  let providerType: string | null = null;
  let bookingUrlTemplate: string | null = null;
  let apiConfig: Record<string, unknown> | null = null;

  if (providerId) {
    const { data: provider } = await supabase
      .from('data_provider')
      .select('provider_type, booking_url_template, api_config')
      .eq('id', providerId)
      .maybeSingle();

    if (provider) {
      providerType = provider.provider_type;
      bookingUrlTemplate = provider.booking_url_template;
      apiConfig = (provider.api_config as Record<string, unknown> | null) ?? null;
    }
  }

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + SNAPSHOT_HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const { data: snapshotRows } = await supabase
    .from('facility_availability_snapshot')
    .select(
      'external_court_id, external_slot_id, slot_start, slot_end, court_name, court_number, price_cents, currency, booking_url'
    )
    .eq('facility_id', facilityId)
    .eq('is_available', true)
    .gte('slot_start', now.toISOString())
    .lte('slot_start', horizonEnd.toISOString())
    .order('slot_start')
    .limit(400);

  const groups = groupRowsByTime((snapshotRows ?? []) as SnapshotRow[]);

  // The clicked chip identifies its time group by start (+end when the chip
  // sent one). Matched against our own rows — never trusted as a destination.
  const wantedStart = parseInstant(slotStart);
  const wantedEnd = parseInstant(slotEnd);
  const selectedGroup = wantedStart
    ? (groups.find(
        g =>
          new Date(g.slotStart).toISOString() === wantedStart &&
          (!wantedEnd || new Date(g.slotEnd).toISOString() === wantedEnd)
      ) ?? null)
    : null;

  const sports = (facility.facility_sports ?? [])
    .map(fs => (Array.isArray(fs.sport) ? fs.sport[0] : fs.sport))
    .filter((s): s is { id: string; name: string; slug: string; is_active: boolean | null } =>
      Boolean(s && s.is_active !== false)
    );
  const sport = sports[0] ?? null;

  return {
    id: facility.id,
    name: facility.name,
    city: facility.city,
    address: facility.address,
    latitude: facility.latitude != null ? Number(facility.latitude) : null,
    longitude: facility.longitude != null ? Number(facility.longitude) : null,
    timezone: facility.timezone,
    organization_nature:
      organization && typeof organization === 'object' && 'nature' in organization
        ? (organization.nature as string | null)
        : null,
    is_first_come_first_serve: facility.is_first_come_first_serve ?? false,
    membership_required: facility.membership_required ?? false,
    sport: sport ? { id: sport.id, name: sport.name, slug: sport.slug } : null,
    selectedGroup,
    slotMissing: wantedStart !== null && selectedGroup === null,
    upcomingGroups: groups.slice(0, UPCOMING_GROUP_LIMIT),
    facilityBookingUrl: renderFacilityTemplate(
      providerType,
      bookingUrlTemplate,
      apiConfig,
      facility.external_provider_id
    ),
  };
}
