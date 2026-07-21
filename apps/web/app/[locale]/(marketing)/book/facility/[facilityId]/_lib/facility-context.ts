import { createServiceRoleClient } from '@/lib/supabase/server';

export type WebBookSlot = {
  externalSlotId: string | null;
  externalCourtId: string;
  slotStart: string;
  slotEnd: string;
  courtName: string | null;
  priceCents: number | null;
  currency: string | null;
  bookingUrl: string | null;
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
  /** The specific slot the visitor clicked, when `?slot=` resolved to one. */
  selectedSlot: WebBookSlot | null;
  /** Next few open slots, for the facility summary panel. */
  upcomingSlots: WebBookSlot[];
  /**
   * Where the visitor is sent once they're signed up. Resolved server-side from
   * our own snapshot rows / provider template — never from a query parameter,
   * so this endpoint can't be turned into an open redirect.
   */
  bookingUrl: string | null;
};

const SNAPSHOT_HORIZON_DAYS = 14;
const UPCOMING_SLOT_LIMIT = 8;

type SnapshotRow = {
  external_court_id: string;
  external_slot_id: string | null;
  slot_start: string;
  slot_end: string;
  court_name: string | null;
  price_cents: number | null;
  currency: string | null;
  booking_url: string | null;
};

function toSlot(row: SnapshotRow): WebBookSlot {
  return {
    externalSlotId: row.external_slot_id,
    externalCourtId: row.external_court_id,
    slotStart: row.slot_start,
    slotEnd: row.slot_end,
    courtName: row.court_name,
    priceCents: row.price_cents,
    currency: row.currency,
    bookingUrl: normalizeBookingUrl(row.booking_url),
  };
}

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
 * Facility-level fallback when no slot carries a URL. IC3 templates need
 * per-slot placeholders we don't have here, so they collapse to the provider's
 * base URL; Activity Messenger templates only need org/package ids and render
 * in full. Mirrors buildBookingUrl in the refresh-facility-availability worker.
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

export async function getFacilityForWebBooking(
  facilityId: string,
  slotId: string | null
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
      'external_court_id, external_slot_id, slot_start, slot_end, court_name, price_cents, currency, booking_url'
    )
    .eq('facility_id', facilityId)
    .eq('is_available', true)
    .gte('slot_start', now.toISOString())
    .lte('slot_start', horizonEnd.toISOString())
    .order('slot_start')
    .limit(200);

  const slots = ((snapshotRows ?? []) as SnapshotRow[]).map(toSlot);

  // The slot id comes from the card the visitor clicked, so it's matched
  // against our own rows rather than trusted as a destination.
  const selectedSlot = slotId ? (slots.find(s => s.externalSlotId === slotId) ?? null) : null;

  const bookingUrl =
    selectedSlot?.bookingUrl ??
    slots.find(s => s.bookingUrl)?.bookingUrl ??
    renderFacilityTemplate(
      providerType,
      bookingUrlTemplate,
      apiConfig,
      facility.external_provider_id
    );

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
    selectedSlot,
    upcomingSlots: slots.slice(0, UPCOMING_SLOT_LIMIT),
    bookingUrl,
  };
}
