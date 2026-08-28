/**
 * Weekly Check-In Wizard — Supabase API layer
 *
 * Thin wrappers around the wizard's RPCs plus a query-key registry for
 * TanStack cache management:
 *
 *   • useCheckInContext()       — cold-start: get_check_in_context()
 *   • useCheckInMatchPlan()     — plan preview: get_checkin_match_plan()
 *   • useRecordCheckIn()        — submit: saveAvailability + record_weekly_checkin
 *
 * Migrations: supabase/migrations/20260521120000_weekly_checkin_schema.sql
 *             supabase/migrations/20260708120000_checkin_match_plan_preview.sql
 *             supabase/migrations/20260708120100_record_checkin_match_plan.sql
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { matchKeys } from '@rallia/shared-hooks';
import {
  OnboardingService,
  getCheckInMatchOpportunities,
  getCheckInMatchPlan,
  getUsableSession,
  supabase,
  Logger,
  type CheckInMatchPlan,
  type PlanInvitee,
  type PlanProposal,
} from '@rallia/shared-services';
import type { OnboardingAvailability, DayEnum, Json } from '@rallia/shared-types';

import { cellKey, type HourGrid } from '#/features/onboarding/components/HourlyAvailabilityGrid';

// =============================================================================
// QUERY KEYS
// =============================================================================

export const checkInKeys = {
  all: ['weekly-checkin'] as const,
  contexts: () => [...checkInKeys.all, 'context'] as const,
  context: (sportId: string | null) => [...checkInKeys.contexts(), { sportId }] as const,
  availability: () => [...checkInKeys.all, 'availability'] as const,
  opportunities: (slots: CheckInMatchSlot[], sportId: string | null, timezone: string | null) =>
    [...checkInKeys.all, 'opportunities', { slots, sportId, timezone }] as const,
  plans: () => [...checkInKeys.all, 'plan'] as const,
  plan: (
    slots: CheckInMatchSlot[],
    goal: number,
    sportId: string | null,
    timezone: string | null
  ) => [...checkInKeys.plans(), { slots, goal, sportId, timezone }] as const,
};

/** A declared availability cell: one selected (weekday, hour). */
export interface CheckInMatchSlot {
  day: DayEnum;
  hour: number;
}

/**
 * How many invite candidates the plan step surfaces per proposed game. The
 * preview RPC returns the full ranked pool (up to 50 — the same pool the
 * invite pass draws from); the UI shows and pre-selects only this many, and
 * everyone not selected lands in invite_excluded_player_ids, so exactly the
 * kept players get invited.
 */
export const MAX_PLAN_INVITEES_SHOWN = 2;

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
  /**
   * Per-sport pending trigger for the banner + auto-opener: availability
   * coverage lapsed OR this sport's playing objective has gone stale (not
   * (re)declared within the last 3 months).
   */
  isPendingCheckIn: boolean;
  /** Resolved player timezone (IANA). Used to format the window labels. */
  timezone: string;
  /** Last local date the player declared availability for (= last today+3). */
  availabilityCoveredThrough: string | null;
  /**
   * The playing objective is "fresh" — explicitly (re)declared for this sport
   * within the last 3 months — so the wizard skips the recap+goal step. (Wire
   * name kept from the old weekly regime; it now means "set this quarter".)
   */
  frequencyAlreadySetThisWeek: boolean;
  /**
   * Player-wide: the rolling window rolled past the last declared coverage, so
   * availability needs refreshing. When false, the wizard skips the
   * availability step (it was refreshed recently).
   */
  availabilityRefreshNeeded: boolean;
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

/** A game record_weekly_checkin created from the confirmed plan. */
export interface CreatedMatch {
  matchId: string;
  sportId: string;
  sportName: string;
  matchDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM:SS
  endTime: string;
  facilityName: string | null;
  locationType: 'facility' | 'tbd';
}

export interface CheckInResult {
  newStreak: number;
  freezes: number;
  longestStreak: number;
  /** True iff the new streak landed on a 4-week multiple (achievement). */
  milestoneReached: boolean;
  /** True iff freezes incremented this call. False when capped at freeze_cap. */
  freezeEarned: boolean;
  /** Games created synchronously from the confirmed plan ([] on the legacy path). */
  createdMatches: CreatedMatch[];
}

/** One confirmed proposal, in the shape record_weekly_checkin's plan expects. */
export interface PlanProposalSubmit {
  sport_id: string;
  match_date: string;
  start_hour: number;
  facility_id: string | null;
  invite_excluded_player_ids: string[];
}

export interface RecordCheckInInput {
  frequencyGoal: number;
  /**
   * True when the player actually saw + (re)declared the objective this session
   * (the recap+goal step was shown). Marks the week explicit so the quarterly
   * gate resets; false carries the inherited goal forward without re-arming it.
   */
  goalIsExplicit: boolean;
  /**
   * Sport the check-in's goal + streak apply to (the wizard's sport mode).
   * Null lets the server fall back to the player's primary sport.
   */
  sportId: string | null;
  /** Disables auto_create_matches — no games are auto-included or created. */
  optOut: boolean;
  /** Persist auto_invite_players — deactivated in the wizard UI for now. */
  autoInvite: boolean;
  /**
   * The confirmed plan selection. `null` = the preview failed and the wizard
   * degrades to the legacy autonomous path (server generates from saved
   * availability). An empty proposals array means "create nothing".
   */
  plan: { proposals: PlanProposalSubmit[] } | null;
  /** New HourGrid to persist. Cells outside `windowDays` are ignored on save. */
  availability: HourGrid;
  /** The window's weekdays — the save is scoped to these (others preserved). */
  windowDays: DayEnum[];
}

// =============================================================================
// COLD-START QUERY — get_check_in_context()
// =============================================================================

async function fetchCheckInContext(sportId: string | null): Promise<CheckInContext> {
  // Guard: the RPC is SECURITY DEFINER with an `auth.uid() IS NULL` check.
  // If no session exists yet (splash race, signed-out user, expired token)
  // bail with safe defaults so TanStack doesn't retry 3× and spam the logs.
  // getSession, not getUser: it refreshes the very token the RPC below will
  // use, and stays local while that token is valid.
  const session = await getUsableSession();
  const deviceTimezone = getDeviceTimezone();

  if (!session) {
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
      availabilityRefreshNeeded: false,
      window: [],
    };
  }

  const { data, error } = await supabase.rpc('get_check_in_context', {
    p_timezone: deviceTimezone,
    // Streak/goal/history are per sport. Null (sport mode still resolving)
    // lets the server fall back to the player's primary sport.
    p_sport_id: sportId,
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
      availabilityRefreshNeeded: true,
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
    availabilityRefreshNeeded: row.availability_refresh_needed ?? true,
    window: mapWindow(row.checkin_window),
  };
}

export function useCheckInContext(options?: { enabled?: boolean; sportId?: string | null }) {
  const sportId = options?.sportId ?? null;
  return useQuery({
    queryKey: checkInKeys.context(sportId),
    queryFn: () => fetchCheckInContext(sportId),
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
 * gender), scoped to `sportId` (the wizard's sport mode; null falls back to
 * all active sports), windowed to today…today+3.
 *
 * Gated on having ≥ 1 declared slot; callers should pass `enabled` keyed to the
 * step being reachable so it can prefetch while the player is still on
 * availability.
 */
export function useCheckInMatchOpportunities(params: {
  slots: CheckInMatchSlot[];
  sportId?: string | null;
  timezone?: string | null;
  enabled?: boolean;
}) {
  const { slots, sportId = null, timezone = null, enabled = true } = params;
  return useQuery({
    queryKey: checkInKeys.opportunities(slots, sportId, timezone),
    queryFn: () => getCheckInMatchOpportunities({ slots, sportId, timezone, limit: 20 }),
    staleTime: 60_000,
    enabled: enabled && slots.length > 0,
  });
}

// =============================================================================
// MATCH PLAN PREVIEW — get_checkin_match_plan()
// =============================================================================

/**
 * The games the auto-generator would create from the just-declared (in-memory)
 * slots and chosen goal, each with the named opponents that would be invited.
 * Rendered by the plan step for confirm/edit; the confirmed selection goes back
 * through recordCheckIn's `plan`.
 *
 * Callers pass `enabled` keyed to the step being reachable so the preview
 * prefetches while the player is still on "Games for you".
 */
export function useCheckInMatchPlan(params: {
  slots: CheckInMatchSlot[];
  frequencyGoal: number;
  sportId?: string | null;
  timezone?: string | null;
  enabled?: boolean;
}) {
  const { slots, frequencyGoal, sportId = null, timezone = null, enabled = true } = params;
  return useQuery({
    queryKey: checkInKeys.plan(slots, frequencyGoal, sportId, timezone),
    queryFn: () => getCheckInMatchPlan({ slots, frequencyGoal, sportId, timezone }),
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
    p_auto_create: !input.optOut,
    p_auto_invite: input.autoInvite,
    p_timezone: deviceTimezone,
    p_match_plan: input.plan
      ? ({ version: 1, proposals: input.plan.proposals } as unknown as Json)
      : null,
    p_sport_id: input.sportId,
    p_goal_is_explicit: input.goalIsExplicit,
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
    createdMatches: mapCreatedMatches(row.created_matches),
  };
}

/** Parse the JSONB `created_matches` the RPC returns into typed entries. */
function mapCreatedMatches(raw: unknown): CreatedMatch[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is Record<string, unknown> =>
        !!m && typeof (m as Record<string, unknown>).match_id === 'string'
    )
    .map(m => ({
      matchId: m.match_id as string,
      sportId: (m.sport_id as string) ?? '',
      sportName: (m.sport_name as string) ?? '',
      matchDate: (m.match_date as string) ?? '',
      startTime: (m.start_time as string) ?? '',
      endTime: (m.end_time as string) ?? '',
      facilityName: (m.facility_name as string | null) ?? null,
      locationType: m.location_type === 'facility' ? 'facility' : 'tbd',
    }));
}

export function useRecordCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recordCheckIn,
    onSuccess: (_data, variables) => {
      // Banner + auto-opener now need to refetch — is_pending_check_in flipped.
      // Prefix invalidation: every sport's context (coverage is player-wide).
      qc.invalidateQueries({ queryKey: checkInKeys.contexts() });
      qc.invalidateQueries({ queryKey: checkInKeys.availability() });

      const refreshMatchLists = () => qc.invalidateQueries({ queryKey: matchKeys.lists() });
      refreshMatchLists();

      // Legacy path only (plan preview failed → p_match_plan NULL): matches are
      // generated ASYNCHRONOUSLY by the generate-weekly-matches edge function a
      // few seconds after commit, so refresh again shortly after. On the plan
      // path the matches were created inside the RPC — already committed by the
      // time onSuccess runs, so the immediate invalidation above is enough.
      if (variables.plan == null) {
        setTimeout(refreshMatchLists, 4000);
        setTimeout(refreshMatchLists, 10000);
      }
    },
  });
}

// Helper for callers (the wizard's submit handler in particular).
export { cellKey };
export type { HourGrid };
export type { CheckInMatchPlan, PlanInvitee, PlanProposal };
