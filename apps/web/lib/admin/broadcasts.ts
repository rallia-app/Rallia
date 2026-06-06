import { requireApiRole } from '@/lib/supabase/check-admin';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import type { Database } from '@/types';

// Email broadcasts are a high-impact action (can reach every user) — super_admin only.
export const BROADCAST_ALLOWED_ROLES = ['super_admin'];

export interface Recipient {
  userId: string | null;
  email: string;
  firstName: string | null;
  locale: string | null;
}

export type ActivityFilter =
  | 'any'
  | 'active_7'
  | 'active_30'
  | 'active_90'
  | 'inactive_30'
  | 'inactive_90';
export type JoinedFilter = 'any' | 'last_7' | 'last_30' | 'last_90' | 'over_90';
export type SubscriptionFilter = 'all' | 'subscribers' | 'non_subscribers';

/** Audience filters that map 1:1 onto the get_broadcast_recipients RPC. */
export interface SegmentFilters {
  sportIds: string[];
  locales: string[];
  city: string | null;
  province: string | null;
  country: string | null;
  activity: ActivityFilter;
  joined: JoinedFilter;
  subscription: SubscriptionFilter;
  genders: string[];
  minAge: number | null;
  maxAge: number | null;
}

type AdminDb = ReturnType<typeof createServiceRoleClient>;
type SegmentArgs = Database['public']['Functions']['get_broadcast_recipients']['Args'];

const ACTIVITY_VALUES = new Set([
  'active_7',
  'active_30',
  'active_90',
  'inactive_30',
  'inactive_90',
]);
const JOINED_VALUES = new Set(['last_7', 'last_30', 'last_90', 'over_90']);
const LOCALE_VALUES = new Set(['en-US', 'en-CA', 'fr-CA', 'fr-FR']);
const GENDER_VALUES = new Set(['male', 'female', 'other']);

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map(x => x.trim());
  }
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);
  }
  return [];
}

function toTrimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function toAge(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 120 ? Math.floor(n) : null;
}

/**
 * Authenticate the caller, confirm super_admin, and return a service-role DB
 * client plus the admin's session token (forwarded to the send-broadcast edge
 * function). Shared by every /api/admin/broadcasts* route.
 */
export async function getAuthedAdminBroadcastDb(): Promise<{
  user: Awaited<
    ReturnType<Awaited<ReturnType<typeof createClient>>['auth']['getUser']>
  >['data']['user'];
  adminDb: AdminDb | null;
  accessToken: string | null;
  error: 'Unauthorized' | 'Forbidden' | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { user: null, adminDb: null, accessToken: null, error: 'Unauthorized' };
  }

  const { allowed } = await requireApiRole(user.id, BROADCAST_ALLOWED_ROLES);
  if (!allowed) {
    return { user: null, adminDb: null, accessToken: null, error: 'Forbidden' };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    user,
    adminDb: createServiceRoleClient(),
    accessToken: session?.access_token ?? null,
    error: null,
  };
}

/** Coerce an arbitrary JSON body's `segment` object into validated SegmentFilters. */
export function parseSegment(raw: unknown): SegmentFilters {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const activity =
    typeof s.activity === 'string' && ACTIVITY_VALUES.has(s.activity)
      ? (s.activity as ActivityFilter)
      : 'any';
  const joined =
    typeof s.joined === 'string' && JOINED_VALUES.has(s.joined)
      ? (s.joined as JoinedFilter)
      : 'any';
  const subscription =
    s.subscription === 'subscribers' || s.subscription === 'non_subscribers'
      ? (s.subscription as SubscriptionFilter)
      : 'all';
  return {
    sportIds: toStringArray(s.sportIds),
    locales: toStringArray(s.locales).filter(v => LOCALE_VALUES.has(v)),
    city: toTrimmed(s.city),
    province: toTrimmed(s.province),
    country: toTrimmed(s.country),
    activity,
    joined,
    subscription,
    genders: toStringArray(s.genders).filter(v => GENDER_VALUES.has(v)),
    minAge: toAge(s.minAge),
    maxAge: toAge(s.maxAge),
  };
}

/** Same as parseSegment but reading from URL query params (the count endpoint). */
export function parseSegmentFromQuery(params: URLSearchParams): SegmentFilters {
  return parseSegment({
    sportIds: params.get('sportIds') ?? undefined,
    locales: params.get('locales') ?? undefined,
    city: params.get('city') ?? undefined,
    province: params.get('province') ?? undefined,
    country: params.get('country') ?? undefined,
    activity: params.get('activity') ?? undefined,
    joined: params.get('joined') ?? undefined,
    subscription: params.get('subscription') ?? undefined,
    genders: params.get('genders') ?? undefined,
    minAge: params.get('minAge') ?? undefined,
    maxAge: params.get('maxAge') ?? undefined,
  });
}

/** Translate filters into RPC args, omitting unset filters so defaults apply. */
function buildSegmentArgs(f: SegmentFilters): SegmentArgs {
  const args: SegmentArgs = {};
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  if (f.sportIds.length) args.p_sport_ids = f.sportIds;
  if (f.locales.length) args.p_locales = f.locales;
  if (f.city) args.p_city = f.city;
  if (f.province) args.p_province = f.province;
  if (f.country) args.p_country = f.country;

  if (f.activity === 'active_7') args.p_active_since = ago(7);
  else if (f.activity === 'active_30') args.p_active_since = ago(30);
  else if (f.activity === 'active_90') args.p_active_since = ago(90);
  else if (f.activity === 'inactive_30') args.p_inactive_before = ago(30);
  else if (f.activity === 'inactive_90') args.p_inactive_before = ago(90);

  if (f.joined === 'last_7') args.p_joined_since = ago(7);
  else if (f.joined === 'last_30') args.p_joined_since = ago(30);
  else if (f.joined === 'last_90') args.p_joined_since = ago(90);
  else if (f.joined === 'over_90') args.p_joined_before = ago(90);

  if (f.subscription === 'subscribers') args.p_subscription = 'subscribers';
  else if (f.subscription === 'non_subscribers') args.p_subscription = 'non_subscribers';

  if (f.genders.length) args.p_genders = f.genders;
  if (f.minAge != null) args.p_min_age = f.minAge;
  if (f.maxAge != null) args.p_max_age = f.maxAge;
  return args;
}

/**
 * Resolve the eligible recipient list for a segment. The RPC already enforces
 * onboarding/active/healthy-email and the admin_broadcast opt-out, so the rows
 * map straight onto Recipient without further filtering.
 */
export async function resolveSegmentRecipients(
  adminDb: AdminDb,
  filters: SegmentFilters
): Promise<Recipient[]> {
  const { data, error } = await adminDb.rpc('get_broadcast_recipients', buildSegmentArgs(filters));
  if (error) {
    throw new Error(`segment recipient resolution failed: ${error.message}`);
  }
  return (data ?? []).map(r => ({
    userId: r.user_id,
    email: r.email,
    firstName: r.first_name,
    locale: r.preferred_locale,
  }));
}

/**
 * Count of eligible recipients for a segment (drives the live audience size).
 * Reuses the row-resolution path for guaranteed parity with what actually gets
 * sent; the audience tops out in the hundreds so resolving rows is cheap.
 */
export async function countSegmentRecipients(
  adminDb: AdminDb,
  filters: SegmentFilters
): Promise<number> {
  const recipients = await resolveSegmentRecipients(adminDb, filters);
  return recipients.length;
}
