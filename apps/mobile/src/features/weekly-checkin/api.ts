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
import { matchKeys } from '@rallia/shared-hooks';
import {
  OnboardingService,
  getCheckInMatchOpportunities,
  supabase,
  Logger,
} from '@rallia/shared-services';
import type { OnboardingAvailability, DayEnum } from '@rallia/shared-types';

import { cellKey, type HourGrid } from '#/features/onboarding/components/HourlyAvailabilityGrid';

// =============================================================================
// QUERY KEYS
// =============================================================================

export const checkInKeys = {
  all: ['weekly-checkin'] as const,
  context: () => [...checkInKeys.all, 'context'] as const,
  availability: () => [...checkInKeys.all, 'availability'] as const,
  opportunities: (slots: CheckInMatchSlot[], timezone: string | null) =>
    [...checkInKeys.all, 'opportunities', { slots, timezone }] as const,
};

/** A declared availability cell: one selected (weekday, hour). */
export interface CheckInMatchSlot {
  day: DayEnum;
  hour: number;
}

/**
 * Device IANA timezone (e.g. 'America/Toronto'), or null if it can't resolve.
 * Sent to both RPCs so the server's date math stays anchored to the player's
 * actual local frame and `player.timezone` stays current across travel.
 */
function getDeviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// =============================================================================
// TYPES (mirror the RPC return shapes)
// =============================================================================

/** One day of the rolling availability window, server-computed in player tz. */
export interface CheckInWindowDay {
  /** ISO date `YYYY-MM-DD` (player-local). */
  date: string;
  dayOfWeek: DayEnum;
}

/** Streak-history marker for one completed week. */
export type WeekStatus = 'hit' | 'frozen' | 'miss' | 'none';

/** One completed week in the streak strip, keyed by its real start date. */
export interface HistoryWeek {
  /** ISO date `YYYY-MM-DD` of that week's Monday (player-local). */
  weekStart: string;
  status: WeekStatus;
}

export interface CheckInContext {
  currentStreak: number;
  longestStreak: number;
  freezeInventory: number;
  freezeCap: number;
  lastWeekFrequencyGoal: number | null;
  lastWeekSessionsPlayed: number | null;
  /** Last 4 completed weeks, newest-first, each with its real date + status. */
  historyWeeks: HistoryWeek[];
  lastFrequencyGoal: number | null;
  /** Coverage-based: the player is past the last date they declared for. */
  isPendingCheckIn: boolean;
  /** Resolved player timezone (IANA). Used to format the window labels. */
  timezone: string;
  /** Last local date the player declared availability for (= last today+3). */
  availabilityCoveredThrough: string | null;
  /** True once a real (non-rescue) check-in exists for the current ISO week. */
  frequencyAlreadySetThisWeek: boolean;
  /** Rolling window: today + next 3 days, computed server-side in player tz. */
  window: CheckInWindowDay[];
}

/** Parse the JSONB `checkin_window` the RPC returns into typed entries. */
function mapWindow(raw: unknown): CheckInWindowDay[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (d): d is { date: string; day_of_week: string } =>
        !!d && typeof d.date === 'string' && typeof d.day_of_week === 'string'
    )
    .map(d => ({ date: d.date, dayOfWeek: d.day_of_week as DayEnum }));
}

/** Parse the JSONB `history_weeks` the RPC returns into typed entries. */
function mapHistoryWeeks(raw: unknown): HistoryWeek[] {
  if (!Array.isArray(raw)) return [];
  const valid: WeekStatus[] = ['hit', 'frozen', 'miss', 'none'];
  return raw
    .filter(
      (w): w is { week_start: string; status: string } =>
        !!w && typeof w.week_start === 'string' && typeof w.status === 'string'
    )
    .map(w => ({
      weekStart: w.week_start,
      status: (valid.includes(w.status as WeekStatus) ? w.status : 'none') as WeekStatus,
    }));
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
  /** New HourGrid to persist. Cells outside `windowDays` are ignored on save. */
  availability: HourGrid;
  /** The window's weekdays — the save is scoped to these (others preserved). */
  windowDays: DayEnum[];
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
  const deviceTimezone = getDeviceTimezone();

  if (!user) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      freezeInventory: 0,
      freezeCap: 2,
      lastWeekFrequencyGoal: null,
      lastWeekSessionsPlayed: null,
      historyWeeks: [],
      lastFrequencyGoal: null,
      isPendingCheckIn: false, // no user → don't trigger the wizard
      timezone: deviceTimezone ?? 'UTC',
      availabilityCoveredThrough: null,
      frequencyAlreadySetThisWeek: false,
      window: [],
    };
  }

  const { data, error } = await supabase.rpc('get_check_in_context', {
    p_timezone: deviceTimezone,
  });
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
      historyWeeks: [],
      lastFrequencyGoal: null,
      isPendingCheckIn: true,
      timezone: deviceTimezone ?? 'UTC',
      availabilityCoveredThrough: null,
      frequencyAlreadySetThisWeek: false,
      window: [],
    };
  }

  return {
    currentStreak: row.current_streak ?? 0,
    longestStreak: row.longest_streak ?? 0,
    freezeInventory: row.freeze_inventory ?? 0,
    freezeCap: row.freeze_cap ?? 2,
    lastWeekFrequencyGoal: row.last_week_frequency_goal,
    lastWeekSessionsPlayed: row.last_week_sessions_played,
    historyWeeks: mapHistoryWeeks(row.history_weeks),
    lastFrequencyGoal: row.last_frequency_goal,
    isPendingCheckIn: row.is_pending_check_in ?? true,
    timezone: row.timezone ?? deviceTimezone ?? 'UTC',
    availabilityCoveredThrough: row.availability_covered_through ?? null,
    frequencyAlreadySetThisWeek: row.frequency_already_set_this_week ?? false,
    window: mapWindow(row.checkin_window),
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
// "GAMES FOR YOU" OPPORTUNITIES — get_checkin_match_opportunities()
// =============================================================================

/**
 * Public matches with open spots that fit the availability the player just
 * declared (in-memory `slots`, not yet persisted). The RPC enforces all four
 * criteria server-side (favorite/distance, exact rating, declared day+hour,
 * gender) across the player's active sports, windowed to today…today+3.
 *
 * Gated on having ≥ 1 declared slot; callers should pass `enabled` keyed to the
 * step being reachable so it can prefetch while the player is still on
 * availability.
 */
export function useCheckInMatchOpportunities(params: {
  slots: CheckInMatchSlot[];
  timezone?: string | null;
  enabled?: boolean;
}) {
  const { slots, timezone = null, enabled = true } = params;
  return useQuery({
    queryKey: checkInKeys.opportunities(slots, timezone),
    queryFn: () => getCheckInMatchOpportunities({ slots, timezone, limit: 20 }),
    staleTime: 60_000,
    enabled: enabled && slots.length > 0,
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

  // Scope the save to the window's weekdays only — the rolling check-in must
  // not wipe availability the player declared for days outside the window.
  const { error: availError } = await OnboardingService.saveAvailabilityForDays(
    input.windowDays,
    availabilityRows
  );
  if (availError) {
    Logger.error('Weekly check-in: saveAvailabilityForDays failed', new Error(availError.message));
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

      // Auto-create (+ auto-invite) generate matches ASYNCHRONOUSLY: the check-in
      // write fires a DB trigger → generate-weekly-matches edge function, which
      // inserts the matches a few seconds after commit. Refresh the player's
      // match lists now and again shortly after so Home's "My games" updates on
      // its own — no manual pull-to-refresh. Home's usePlayerMatches stays
      // mounted behind the wizard modal, so these invalidations refetch it in
      // the background and it's current by the time the wizard dismisses.
      const refreshMatchLists = () => qc.invalidateQueries({ queryKey: matchKeys.lists() });
      refreshMatchLists();
      setTimeout(refreshMatchLists, 4000);
      setTimeout(refreshMatchLists, 10000);
    },
  });
}

// Helper for callers (the wizard's submit handler in particular).
export { cellKey };
export type { HourGrid };
