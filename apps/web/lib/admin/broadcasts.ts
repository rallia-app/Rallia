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

/** Audience filters that map 1:1 onto the get_broadcast_recipients RPC. */
export interface SegmentFilters {
  sportId: string | null;
  city: string | null;
  locale: string | null;
  activeWithinDays: number | null;
  onlySubscribers: boolean;
}

type AdminDb = ReturnType<typeof createServiceRoleClient>;
type SegmentArgs = Database['public']['Functions']['get_broadcast_recipients']['Args'];

const VALID_ACTIVE_DAYS = new Set([7, 30, 90]);
const VALID_LOCALES = new Set(['en-US', 'fr-CA']);

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
  const days = typeof s.activeWithinDays === 'number' ? s.activeWithinDays : null;
  return {
    sportId: typeof s.sportId === 'string' && s.sportId.trim() ? s.sportId.trim() : null,
    city: typeof s.city === 'string' && s.city.trim() ? s.city.trim() : null,
    locale: typeof s.locale === 'string' && VALID_LOCALES.has(s.locale) ? s.locale : null,
    activeWithinDays: days !== null && VALID_ACTIVE_DAYS.has(days) ? days : null,
    onlySubscribers: s.onlySubscribers === true,
  };
}

/** Same as parseSegment but reading from URL query params (the count endpoint). */
export function parseSegmentFromQuery(params: URLSearchParams): SegmentFilters {
  const days = Number(params.get('activeWithinDays'));
  const locale = params.get('locale');
  return {
    sportId: params.get('sportId')?.trim() || null,
    city: params.get('city')?.trim() || null,
    locale: locale && VALID_LOCALES.has(locale) ? locale : null,
    activeWithinDays: VALID_ACTIVE_DAYS.has(days) ? days : null,
    onlySubscribers: params.get('onlySubscribers') === 'true',
  };
}

/** Translate filters into RPC args, omitting unset filters so defaults apply. */
function buildSegmentArgs(f: SegmentFilters): SegmentArgs {
  const args: SegmentArgs = {};
  if (f.sportId) args.p_sport_id = f.sportId;
  if (f.city) args.p_city = f.city;
  if (f.locale) args.p_locale = f.locale;
  if (f.activeWithinDays) {
    args.p_active_since = new Date(Date.now() - f.activeWithinDays * 86_400_000).toISOString();
  }
  if (f.onlySubscribers) args.p_only_subscribers = true;
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
