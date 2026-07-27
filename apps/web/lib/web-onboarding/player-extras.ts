import type { SupabaseClient } from '@supabase/supabase-js';
import { ORDERED_DAYS, SUPPORTED_HOURS } from '@rallia/shared-utils';

import type { Database } from '@/types';

/**
 * The parts of onboarding that `writeWebOnboardingProfile` does not cover, because the
 * join and booking gates never collect them: the weekly availability grid and favourite
 * facilities.
 *
 * Both are mandatory in mobile onboarding, and for good reason — availability is what
 * the matchmaking engine matches on, and favourites gate auto-invites. A player created
 * without them completes signup and then quietly receives nothing.
 *
 * Write shapes mirror mobile exactly (see OnboardingService.saveAvailability and the
 * favourites block of OnboardingWizard) so a web-created account is indistinguishable
 * from a mobile-created one.
 */

export type AvailabilityCell = { day: string; hour: number };

/**
 * Upserts the selected cells, then deletes any the player no longer has.
 * Mobile does the same desired-set reconciliation; onboarding only ever writes into an
 * empty set, but keeping the semantics identical means this is safe to reuse for edits.
 */
export async function writePlayerAvailability(
  admin: SupabaseClient<Database>,
  userId: string,
  cells: AvailabilityCell[]
): Promise<void> {
  const confirmedAt = new Date().toISOString();

  const rows = cells.map(cell => ({
    player_id: userId,
    day: cell.day as Database['public']['Enums']['day_enum'],
    hour_of_day: cell.hour,
    is_active: true,
    last_confirmed_at: confirmedAt,
  }));

  if (rows.length > 0) {
    const { error } = await admin
      .from('player_availability')
      .upsert(rows, { onConflict: 'player_id,day,hour_of_day' });
    if (error) throw new Error(`Failed to save availability: ${error.message}`);
  }

  const keep = new Set(cells.map(cell => `${cell.day}-${cell.hour}`));
  const { data: existing, error: readError } = await admin
    .from('player_availability')
    .select('id, day, hour_of_day')
    .eq('player_id', userId);

  if (readError) throw new Error(`Failed to read availability: ${readError.message}`);

  const stale = (existing ?? [])
    .filter(row => !keep.has(`${row.day}-${row.hour_of_day}`))
    .map(row => row.id);

  if (stale.length > 0) {
    const { error } = await admin.from('player_availability').delete().in('id', stale);
    if (error) throw new Error(`Failed to prune availability: ${error.message}`);
  }
}

/**
 * Replaces the player's favourites with one row per (facility × sport).
 *
 * Mobile deletes everything first and re-inserts; the same is done here so display_order
 * stays a dense 1-based sequence per sport rather than drifting on repeat runs.
 */
export async function writeFavoriteFacilities(
  admin: SupabaseClient<Database>,
  userId: string,
  sportId: string,
  facilityIds: string[]
): Promise<void> {
  const { error: deleteError } = await admin
    .from('player_favorite_facility')
    .delete()
    .eq('player_id', userId);

  if (deleteError) throw new Error(`Failed to reset favorites: ${deleteError.message}`);
  if (facilityIds.length === 0) return;

  const rows = facilityIds.map((facilityId, index) => ({
    player_id: userId,
    facility_id: facilityId,
    sport_id: sportId,
    display_order: index + 1,
  }));

  const { error } = await admin.from('player_favorite_facility').insert(rows);
  if (error) throw new Error(`Failed to save favorites: ${error.message}`);
}

/** Guards against a client sending cells outside the grid the UI can even render. */
export function isValidAvailabilityCell(cell: AvailabilityCell): boolean {
  return (
    ORDERED_DAYS.includes(cell.day as (typeof ORDERED_DAYS)[number]) &&
    SUPPORTED_HOURS.includes(cell.hour)
  );
}
