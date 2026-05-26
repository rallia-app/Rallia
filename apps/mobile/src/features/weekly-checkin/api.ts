/**
 * Weekly Check-In Wizard — Supabase API layer
 *
 * Two thin wrappers around the wizard's RPCs plus a query-key registry for
 * TanStack cache management:
 *
 *   • useCheckInContext()  — cold-start: get_check_in_context()
 *   • useRecordCheckIn()   — submit: saveAvailability + record_weekly_checkin
 *
 * Migrations: supabase/migrations/20260521120000_weekly_checkin_schema.sql
 *             supabase/migrations/20260521120100_weekly_checkin_rpcs.sql
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OnboardingService, supabase, Logger } from '@rallia/shared-services';
import type { OnboardingAvailability, DayEnum } from '@rallia/shared-types';

import { cellKey, type HourGrid } from '#/features/onboarding/components/HourlyAvailabilityGrid';

// =============================================================================
// QUERY KEYS
// =============================================================================

export const checkInKeys = {
  all: ['weekly-checkin'] as const,
  context: () => [...checkInKeys.all, 'context'] as const,
  availability: () => [...checkInKeys.all, 'availability'] as const,
};

// =============================================================================
// TYPES (mirror the RPC return shapes)
// =============================================================================

export interface CheckInContext {
  currentStreak: number;
  longestStreak: number;
  freezeInventory: number;
  freezeCap: number;
  lastWeekFrequencyGoal: number | null;
  lastWeekSessionsPlayed: number | null;
  goalsHitLast4Weeks: boolean[];
  lastFrequencyGoal: number | null;
  isPendingCheckIn: boolean;
}

export interface CheckInResult {
  newStreak: number;
  freezes: number;
  longestStreak: number;
  /** True iff the new streak landed on a 4-week multiple (achievement). */
  milestoneReached: boolean;
  /** True iff freezes incremented this call. False when capped at freeze_cap. */
  freezeEarned: boolean;
}

export interface RecordCheckInInput {
  frequencyGoal: number;
  autoCreate: boolean;
  autoInvite: boolean;
  /** New HourGrid to persist. Diffs against existing rows via OnboardingService.saveAvailability. */
  availability: HourGrid;
}

// =============================================================================
// COLD-START QUERY — get_check_in_context()
// =============================================================================

async function fetchCheckInContext(): Promise<CheckInContext> {
  // Guard: the RPC is SECURITY DEFINER with an `auth.uid() IS NULL` check.
  // If no session exists yet (splash race, signed-out user, expired token)
  // bail with safe defaults so TanStack doesn't retry 3× and spam the logs.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      freezeInventory: 0,
      freezeCap: 2,
      lastWeekFrequencyGoal: null,
      lastWeekSessionsPlayed: null,
      goalsHitLast4Weeks: [],
      lastFrequencyGoal: null,
      isPendingCheckIn: false, // no user → don't trigger the wizard
    };
  }

  const { data, error } = await supabase.rpc('get_check_in_context');
  if (error) {
    Logger.error('[weekly-checkin] get_check_in_context failed', error);
    throw error;
  }

  // The RPC returns a SETOF table with exactly one row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    // Brand-new user with no streak row yet — RPC still returns defaults.
    // Defensive: zero out everything if we somehow got nothing.
    return {
      currentStreak: 0,
      longestStreak: 0,
      freezeInventory: 0,
      freezeCap: 2,
      lastWeekFrequencyGoal: null,
      lastWeekSessionsPlayed: null,
      goalsHitLast4Weeks: [],
      lastFrequencyGoal: null,
      isPendingCheckIn: true,
    };
  }

  return {
    currentStreak: row.current_streak ?? 0,
    longestStreak: row.longest_streak ?? 0,
    freezeInventory: row.freeze_inventory ?? 0,
    freezeCap: row.freeze_cap ?? 2,
    lastWeekFrequencyGoal: row.last_week_frequency_goal,
    lastWeekSessionsPlayed: row.last_week_sessions_played,
    goalsHitLast4Weeks: row.goals_hit_last_4_weeks ?? [],
    lastFrequencyGoal: row.last_frequency_goal,
    isPendingCheckIn: row.is_pending_check_in ?? true,
  };
}

export function useCheckInContext(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: checkInKeys.context(),
    queryFn: fetchCheckInContext,
    staleTime: 60_000, // 1 min — banner and auto-opener both read this; avoid refetch storms
    enabled: options?.enabled ?? true,
  });
}

// =============================================================================
// CURRENT AVAILABILITY GRID — needed to pre-populate Step 2
// =============================================================================

// NOTE: returns a plain string[] (array of cell keys), NOT a Set.
// TanStack Query's structural-sharing pass clones data through JSON-like
// traversal, which turns a Set into something un-iterable. Callers should
// `new Set(keys)` themselves.
async function fetchAvailabilityKeys(): Promise<string[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('player_availability')
    .select('day, hour_of_day, is_active')
    .eq('player_id', user.id)
    .eq('is_active', true);

  if (error) {
    Logger.error('Weekly check-in: fetchAvailabilityKeys failed', error);
    throw error;
  }

  return (data ?? []).map(row => cellKey(row.day as DayEnum, row.hour_of_day as number));
}

export function useAvailabilityKeys(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: checkInKeys.availability(),
    queryFn: fetchAvailabilityKeys,
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}

// =============================================================================
// SUBMIT MUTATION — saveAvailability + record_weekly_checkin
// =============================================================================

async function recordCheckIn(input: RecordCheckInInput): Promise<CheckInResult> {
  // 1. Persist availability changes (diff-sync + last_confirmed_at bump).
  //    Reuses the exact same write path the UserProfile availability edit uses.
  //
  //    We use Set.forEach instead of Array.from(input.availability) to dodge
  //    a Hermes iterator-protocol edge case (see useWeeklyCheckInWizard
  //    "seeded availability" comment).
  const availabilityRows: OnboardingAvailability[] = [];
  input.availability.forEach(key => {
    const sepIdx = key.lastIndexOf('-');
    const day = key.slice(0, sepIdx) as DayEnum;
    const hour = Number(key.slice(sepIdx + 1));
    availabilityRows.push({ day, hour_of_day: hour, is_active: true });
  });

  const { error: availError } = await OnboardingService.saveAvailability(availabilityRows);
  if (availError) {
    Logger.error('Weekly check-in: saveAvailability failed', new Error(availError.message));
    throw new Error(availError.message);
  }

  // 2. Record the check-in. RPC also re-bumps last_confirmed_at (idempotent
  //    with step 1) and runs the Option-C streak math.
  //
  // We send the device's IANA timezone on every check-in. The RPC lazily
  // updates player.timezone with it, so server-side week math (which anchors
  // to the player's local Monday) stays accurate across travel and
  // relocation. Falls back to UTC if the device can't resolve a name.
  let deviceTimezone: string | null = null;
  try {
    deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    deviceTimezone = null;
  }

  const { data, error } = await supabase.rpc('record_weekly_checkin', {
    p_frequency_goal: input.frequencyGoal,
    p_auto_create: input.autoCreate,
    p_auto_invite: input.autoInvite,
    p_timezone: deviceTimezone,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('record_weekly_checkin returned no row');

  return {
    newStreak: row.new_streak,
    freezes: row.freezes,
    longestStreak: row.longest_streak,
    milestoneReached: row.milestone_reached,
    freezeEarned: row.freeze_earned,
  };
}

export function useRecordCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recordCheckIn,
    onSuccess: () => {
      // Banner + auto-opener now need to refetch — is_pending_check_in flipped.
      qc.invalidateQueries({ queryKey: checkInKeys.context() });
      qc.invalidateQueries({ queryKey: checkInKeys.availability() });
    },
  });
}

// Helper for callers (the wizard's submit handler in particular).
export { cellKey };
export type { HourGrid };
