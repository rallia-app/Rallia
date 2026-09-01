/**
 * Match Service
 * Handles all match-related database operations using Supabase.
 */

import { getProfilePictureUrl } from '@rallia/shared-utils';

import { supabase } from '../supabase';
import { startRecurrence } from './recurrenceService';
import {
  attachAvailableCourtSlots,
  fetchAvailableCourtSlotsForMatches,
  applyCourtSlots,
} from './availableCourts';
import { Logger } from '../logger';
import {
  notifyMatchJoinRequest,
  notifyJoinRequestAccepted,
  notifyJoinRequestRejected,
  notifyPlayerJoined,
  notifyPlayerLeft,
  notifyMatchCancelled,
  notifyMatchUpdated,
  notifyPlayerKicked,
  notifyMatchInvitation,
  notifyMatchSpotOpened,
} from '../notifications/notificationFactory';
import {
  createReputationEvent,
  countRecentCancellationEvents,
} from '../reputation/reputationService';
import { calculateCancellationPenalty } from '../reputation/reputationPenalties';
import { syncMatchConversationTitle, updateConversation } from '../chat/chatService';
import type {
  Match,
  TablesInsert,
  MatchWithDetails,
  MatchParticipantWithPlayer,
  MatchParticipant,
  PlayerMatchHistoryItem,
  Profile,
  PlayerWithProfile,
  MatchFormatEnum,
  MatchTypeEnum,
  MatchDurationEnum,
  LocationTypeEnum,
  CourtStatusEnum,
  CostSplitTypeEnum,
  MatchVisibilityEnum,
  MatchJoinModeEnum,
  GenderEnum,
  BadgeStatusEnum,
  DayEnum,
  Json,
  MatchParticipantStatusEnum,
  UpcomingMatchFilter,
  PastMatchFilter,
  FormatFilter,
  MatchTypeFilter,
  DateRangeFilter,
  TimeOfDayFilter,
  SkillLevelFilter,
  GenderFilter,
  CostFilter,
  JoinModeFilter,
  DurationFilter,
  CourtStatusFilter,
  MatchTierFilter,
  SpotsAvailableFilter,
  SpecificTimeFilter,
  ReputationFilter,
} from '@rallia/shared-types';
import { calculateDistanceMeters } from '@rallia/shared-utils';

/**
 * Input data for creating a match
 * Maps from form data to database insert structure
 */
/** Form-level court status values (mapped to DB CourtStatusEnum in createMatch) */
export type FormCourtStatus = 'booked' | 'to_book' | 'tbd';
/** Form-level cost split values (mapped to DB CostSplitTypeEnum in createMatch) */
export type FormCostSplitType = 'equal' | 'creator_pays' | 'custom';

export interface CreateMatchInput {
  // Required fields
  sportId: string;
  createdBy: string;
  matchDate: string; // YYYY-MM-DD format
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  timezone: string; // IANA timezone (e.g., "America/New_York")

  // Match format
  format?: MatchFormatEnum;
  playerExpectation?: MatchTypeEnum;
  duration?: MatchDurationEnum;
  customDurationMinutes?: number;

  // Location
  locationType?: LocationTypeEnum;
  facilityId?: string;
  courtId?: string;
  locationName?: string;
  locationAddress?: string;
  customLatitude?: number;
  customLongitude?: number;

  // Court & cost (form-level values, mapped to DB enums in createMatch)
  courtStatus?: FormCourtStatus;
  isCourtFree?: boolean;
  costSplitType?: FormCostSplitType;
  estimatedCost?: number;

  // Opponent preferences
  minRatingScoreId?: string;
  preferredOpponentGender?: GenderEnum | 'any';

  // Visibility & access
  visibility?: MatchVisibilityEnum;
  /** When private: whether the match is visible in groups the creator is part of */
  visibleInGroups?: boolean;
  /** When private: whether the match is visible in communities the creator is part of */
  visibleInCommunities?: boolean;
  joinMode?: MatchJoinModeEnum;

  /** Repeat this game weekly. The next occurrence is created once this one ends. */
  isRecurring?: boolean;

  // Additional info
  notes?: string;
}

/**
 * Helper to convert empty strings to null (for optional UUID fields)
 * Returns null (not undefined) so the field is actually cleared in the database
 */
function emptyToNull(value: string | null | undefined): string | null {
  return value && typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Create a new match
 */
export async function createMatch(input: CreateMatchInput): Promise<Match> {
  // Map form costSplitType to database enum values
  const costSplitMap: Record<FormCostSplitType, CostSplitTypeEnum> = {
    creator_pays: 'host_pays',
    equal: 'split_equal',
    custom: 'custom',
  };

  // Map form courtStatus to database enum values (null if tbd)
  const courtStatusMap: Record<FormCourtStatus, CourtStatusEnum | null> = {
    booked: 'reserved',
    to_book: 'to_reserve',
    tbd: null,
  };

  // Build the insert object
  // Note: Empty strings are converted to null for UUID fields to avoid "invalid uuid" errors
  const insertData: TablesInsert<'match'> = {
    sport_id: input.sportId,
    created_by: input.createdBy,
    match_date: input.matchDate,
    start_time: input.startTime,
    end_time: input.endTime,
    timezone: input.timezone,
    format: input.format ?? 'singles',
    player_expectation: input.playerExpectation ?? 'both',
    duration: input.duration ?? '60',
    custom_duration_minutes: input.customDurationMinutes,
    location_type: input.locationType ?? 'tbd',
    facility_id: emptyToNull(input.facilityId),
    court_id: emptyToNull(input.courtId),
    location_name: emptyToNull(input.locationName),
    location_address: emptyToNull(input.locationAddress),
    custom_latitude: input.customLatitude,
    custom_longitude: input.customLongitude,
    court_status: input.courtStatus ? courtStatusMap[input.courtStatus] : null,
    is_court_free: input.isCourtFree ?? true,
    cost_split_type: costSplitMap[input.costSplitType ?? 'equal'] ?? 'split_equal',
    estimated_cost: input.estimatedCost,
    min_rating_score_id: emptyToNull(input.minRatingScoreId),
    preferred_opponent_gender:
      input.preferredOpponentGender === 'any' ? null : input.preferredOpponentGender,
    visibility: input.visibility ?? 'public',
    visible_in_groups: input.visibleInGroups ?? true,
    visible_in_communities: input.visibleInCommunities ?? true,
    join_mode: input.joinMode ?? 'direct',
    notes: emptyToNull(input.notes),
  };

  const { data, error } = await supabase.from('match').insert(insertData).select().single();

  if (error) {
    throw new Error(`Failed to create match: ${error.message}`);
  }

  const match = data as Match;

  if (input.isRecurring) {
    // Best-effort: the game is already created, so a failed series must not
    // fail creation. The host can turn recurrence on again from the game.
    try {
      const recurrence = await startRecurrence(match.id, input.createdBy);
      match.recurrence_id = recurrence.id;
    } catch (recurrenceError) {
      Logger.error(
        'createMatch: failed to start recurrence',
        recurrenceError instanceof Error ? recurrenceError : undefined
      );
    }
  }

  return match;
}

/**
 * Get a match by ID
 */
export async function getMatch(matchId: string): Promise<Match | null> {
  const { data, error } = await supabase.from('match').select('*').eq('id', matchId).single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    throw new Error(`Failed to get match: ${error.message}`);
  }

  return data as Match;
}

/**
 * Get a match with full details (sport, facility, court, participants)
 */
export async function getMatchWithDetails(matchId: string) {
  const { data, error } = await supabase
    .from('match')
    .select(
      `
      *,
      sport:sport_id (*),
      facility:facility_id (*),
      court:court_id (*),
      min_rating_score:min_rating_score_id (*),
      created_by_player:created_by (
        id,
        gender,
        playing_hand,
        max_travel_distance,
        player_reputation (reputation_score, total_events),
        notification_match_requests,
        notification_messages,
        notification_reminders,
        privacy_show_age,
        privacy_show_location,
        privacy_show_stats
      ),
      participants:match_participant (
        id,
        match_id,
        player_id,
        status,
        is_host,
        score,
        team_number,
        feedback_completed,
        checked_in_at,
        joined_at,
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score, total_events),
          notification_match_requests,
          notification_messages,
          notification_reminders,
          privacy_show_age,
          privacy_show_location,
          privacy_show_stats
        )
      ),
      result:match_result (
        id,
        winning_team,
        team1_score,
        team2_score,
        is_verified,
        disputed,
        submitted_by,
        confirmation_deadline,
        confirmed_by,
        verified_at,
        created_at,
        updated_at,
        rebuttal_team1_score,
        rebuttal_team2_score,
        rebuttal_winning_team,
        rebuttal_sets,
        rebuttal_submitted_by,
        rebuttal_submitted_at,
        rebuttal_deadline,
        sets:match_set (
          set_number,
          team1_score,
          team2_score
        ),
        confirmations:score_confirmation (
          player_id,
          action
        )
      )
    `
    )
    .eq('id', matchId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get match details: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  // Fetch profiles for all players (creator + participants)
  const playerIds = new Set<string>();
  if (data.created_by_player?.id) {
    playerIds.add(data.created_by_player.id);
  }
  if (data.participants) {
    data.participants.forEach((p: MatchParticipantWithPlayer) => {
      // Handle both array and object formats from Supabase
      const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
      if (playerObj?.id) {
        playerIds.add(playerObj.id);
      }
    });
  }

  // Fetch all profiles at once
  const profileIds = Array.from(playerIds);
  const profilesMap: Record<string, Profile> = {};

  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profile')
      .select('*')
      .in('id', profileIds);

    if (!profilesError && profiles) {
      profiles.forEach(profile => {
        profilesMap[profile.id] = profile;
      });
    }
  }

  // Fetch player ratings for the match's sport (for displaying in request cards)
  const sportId = data.sport_id;
  const ratingsMap: Record<
    string,
    { label: string; value: number | null; badgeStatus?: BadgeStatusEnum }
  > = {}; // playerId -> rating info

  if (profileIds.length > 0 && sportId) {
    const { data: ratingsData, error: ratingsError } = await supabase
      .from('player_rating_score')
      .select(
        `
        player_id,
        badge_status,
        rating_score!player_rating_scores_rating_score_id_fkey!inner (
          label,
          value,
          rating_system!inner (
            sport_id
          )
        )
      `
      )
      .in('player_id', profileIds);

    if (ratingsError) {
      Logger.error('[getMatchWithDetails] Error fetching ratings:', ratingsError);
    }

    if (!ratingsError && ratingsData) {
      type RatingResult = {
        player_id: string;
        badge_status?: BadgeStatusEnum;
        rating_score: { label: string; value: number | null; rating_system: { sport_id: string } };
      };
      (ratingsData as unknown as RatingResult[]).forEach(rating => {
        // Filter to only ratings for this match's sport
        const ratingScore = rating.rating_score;
        const ratingSystem = ratingScore?.rating_system;
        if (ratingSystem?.sport_id === sportId && ratingScore?.label) {
          ratingsMap[rating.player_id] = {
            label: ratingScore.label,
            value: ratingScore.value,
            badgeStatus: rating.badge_status,
          };
        }
      });
    }
  }

  // Attach profiles, ratings, and certification to players
  if (data.created_by_player?.id && profilesMap[data.created_by_player.id]) {
    data.created_by_player.profile = profilesMap[data.created_by_player.id];
    const creatorRating = ratingsMap[data.created_by_player.id];
    if (creatorRating) {
      data.created_by_player.sportRatingLabel = creatorRating.label;
      if (creatorRating.value !== null) {
        data.created_by_player.sportRatingValue = creatorRating.value;
      }
      if (creatorRating.badgeStatus) {
        data.created_by_player.sportCertificationStatus = creatorRating.badgeStatus;
      }
    }
  }

  if (data.participants) {
    data.participants = data.participants.map((p: MatchParticipantWithPlayer) => {
      // Handle both array and object formats from Supabase
      // Supabase can return player as array in some cases
      const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
      const playerId = playerObj?.id;

      if (playerId && profilesMap[playerId]) {
        playerObj.profile = profilesMap[playerId];
      }
      const participantRating = playerId ? ratingsMap[playerId] : undefined;
      if (participantRating && playerObj) {
        (
          playerObj as MatchParticipantWithPlayer['player'] & {
            sportRatingLabel?: string;
            sportRatingValue?: number;
            sportCertificationStatus?: BadgeStatusEnum;
          }
        ).sportRatingLabel = participantRating.label;
        if (participantRating.value !== null) {
          (
            playerObj as MatchParticipantWithPlayer['player'] & {
              sportRatingLabel?: string;
              sportRatingValue?: number;
              sportCertificationStatus?: BadgeStatusEnum;
            }
          ).sportRatingValue = participantRating.value;
        }
        if (participantRating.badgeStatus) {
          (
            playerObj as MatchParticipantWithPlayer['player'] & {
              sportCertificationStatus?: BadgeStatusEnum;
            }
          ).sportCertificationStatus = participantRating.badgeStatus;
        }
      }
      // Ensure player is always an object, not array
      if (Array.isArray(p.player) && playerObj) {
        p.player = playerObj;
      }
      return p;
    });
  }

  // Attach open-court availability (count + raw rows) so MatchDetailSheet's
  // available-courts section can render tiles inline. This path replaces the
  // sheet's match on refetch, so without it the inline slots from the list
  // fetch would be wiped.
  await attachAvailableCourtSlots([data as unknown as MatchWithDetails]);

  return data;
}

/**
 * Get multiple matches with full details (for match discovery/listing)
 */
export async function getMatchesWithDetails(
  options: {
    limit?: number;
    offset?: number;
    visibility?: 'public' | 'private';
    matchDateFrom?: string;
    matchDateTo?: string;
    /** Filter only non-cancelled matches (default: true) */
    excludeCancelled?: boolean;
  } = {}
) {
  const {
    limit = 50,
    offset = 0,
    visibility = 'public',
    matchDateFrom,
    matchDateTo,
    excludeCancelled = true,
  } = options;

  let query = supabase
    .from('match')
    .select(
      `
      *,
      sport:sport_id (*),
      facility:facility_id (*),
      court:court_id (*),
      min_rating_score:min_rating_score_id (*),
      created_by_player:created_by (
        id,
        gender,
        playing_hand,
        max_travel_distance,
        player_reputation (reputation_score, total_events),
        notification_match_requests,
        notification_messages,
        notification_reminders,
        privacy_show_age,
        privacy_show_location,
        privacy_show_stats
      ),
      participants:match_participant (
        id,
        match_id,
        player_id,
        status,
        is_host,
        score,
        team_number,
        feedback_completed,
        checked_in_at,
        joined_at,
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score, total_events),
          notification_match_requests,
          notification_messages,
          notification_reminders,
          privacy_show_age,
          privacy_show_location,
          privacy_show_stats
        )
      )
    `
    )
    .eq('visibility', visibility)
    .order('match_date', { ascending: true })
    .order('start_time', { ascending: true })
    .range(offset, offset + limit - 1);

  // Filter out cancelled matches by checking cancelled_at is null
  // Match status is now derived from cancelled_at, match_date, start_time, end_time
  if (excludeCancelled) {
    query = query.is('cancelled_at', null);
  }

  if (matchDateFrom) {
    query = query.gte('match_date', matchDateFrom);
  }

  if (matchDateTo) {
    query = query.lte('match_date', matchDateTo);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get matches: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Fetch profiles for all players (creator + participants)
  const playerIds = new Set<string>();
  data.forEach((match: MatchWithDetails) => {
    if (match.created_by_player?.id) {
      playerIds.add(match.created_by_player.id);
    }
    if (match.participants) {
      match.participants.forEach((p: MatchParticipantWithPlayer) => {
        // Handle both array and object formats from Supabase
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        if (playerObj?.id) {
          playerIds.add(playerObj.id);
        }
      });
    }
  });

  // Fetch all profiles at once
  const profileIds = Array.from(playerIds);
  const profilesMap: Record<string, Profile> = {};

  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profile')
      .select('*')
      .in('id', profileIds);

    if (!profilesError && profiles) {
      profiles.forEach(profile => {
        profilesMap[profile.id] = profile;
      });
    }
  }

  // Attach profiles to players
  const enrichedData = data.map((match: MatchWithDetails) => {
    // Attach profile to creator
    if (match.created_by_player?.id && profilesMap[match.created_by_player.id]) {
      match.created_by_player.profile = profilesMap[match.created_by_player.id];
    }

    // Attach profiles to participants
    if (match.participants) {
      match.participants = match.participants.map((p: MatchParticipantWithPlayer) => {
        // Handle both array and object formats from Supabase
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        const playerId = playerObj?.id;

        if (playerId && profilesMap[playerId]) {
          playerObj.profile = profilesMap[playerId];
        }
        // Ensure player is always an object, not array
        if (Array.isArray(p.player) && playerObj) {
          p.player = playerObj;
        }
        return p;
      });
    }

    return match;
  });

  // Attach open-court counts for unreserved future matches so MatchCard can
  // surface a "N courts available" chip (parity with suggestion cards). A
  // failed/empty lookup simply leaves the field undefined — the chip hides.
  await attachAvailableCourtSlots(enrichedData);

  return enrichedData;
}

/**
 * Get matches created by a user
 */
export async function getMatchesByCreator(
  userId: string,
  options: { excludeCancelled?: boolean; limit?: number; offset?: number } = {}
): Promise<Match[]> {
  const { excludeCancelled = true, limit = 20, offset = 0 } = options;

  let query = supabase
    .from('match')
    .select('*')
    .eq('created_by', userId)
    .order('match_date', { ascending: true })
    .order('start_time', { ascending: true })
    .range(offset, offset + limit - 1);

  // Filter out cancelled matches by checking cancelled_at is null
  // Match status is now derived from cancelled_at, match_date, start_time, end_time
  if (excludeCancelled) {
    query = query.is('cancelled_at', null);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to get matches: ${error.message}`);
  }

  return data as Match[];
}

/**
 * Error codes for match update validation
 * These are translated on the frontend
 */
export type UpdateMatchErrorCode =
  | 'MATCH_NOT_FOUND'
  | 'FORMAT_CHANGE_BLOCKED'
  | 'GENDER_CHANGE_BLOCKED'
  | 'UNKNOWN_ERROR';

/**
 * Result of match update validation
 */
export interface UpdateMatchValidationResult {
  canUpdate: boolean;
  errorCode?: UpdateMatchErrorCode;
  /** @deprecated Use errorCode instead - this is kept for backwards compatibility */
  error?: string;
  warnings?: {
    type: 'gender_mismatch' | 'rating_mismatch';
    affectedParticipantIds: string[];
    message: string;
  }[];
}

/**
 * Validate match update and return affected participants info
 * This is called before updateMatch to check for issues
 */
export async function validateMatchUpdate(
  matchId: string,
  updates: Partial<CreateMatchInput>
): Promise<UpdateMatchValidationResult> {
  // Fetch current match with participants
  const { data: match, error: matchError } = await supabase
    .from('match')
    .select(
      `
      id,
      format,
      preferred_opponent_gender,
      min_rating_score_id,
      participants:match_participant (
        id,
        player_id,
        status,
        player:player_id (
          id,
          gender
        )
      )
    `
    )
    .eq('id', matchId)
    .single();

  if (matchError || !match) {
    return { canUpdate: false, errorCode: 'MATCH_NOT_FOUND', error: 'Match not found' };
  }

  const joinedParticipants =
    match.participants?.filter((p: { status: string }) => p.status === 'joined') ?? [];
  const joinedCount = joinedParticipants.length;

  const warnings: UpdateMatchValidationResult['warnings'] = [];

  // ========================================
  // FORMAT VALIDATION
  // ========================================
  // Block format change from doubles to singles if more than 2 participants joined
  // (singles supports up to 2: creator + 1 opponent)
  if (updates.format !== undefined && updates.format !== match.format) {
    if (match.format === 'doubles' && updates.format === 'singles' && joinedCount > 2) {
      return {
        canUpdate: false,
        errorCode: 'FORMAT_CHANGE_BLOCKED',
        error:
          'Cannot change from doubles to singles with more than 2 participants. Remove participants first or cancel the match.',
      };
    }
  }

  // ========================================
  // GENDER PREFERENCE VALIDATION
  // ========================================
  // Gender change is allowed when:
  // 1. No participants have joined
  // 2. Widening (specific → any) — always allowed
  // 3. Narrowing from "any" to a specific gender AND all joined participants match that gender
  // Otherwise: blocked
  if (updates.preferredOpponentGender !== undefined && joinedCount > 0) {
    const currentGender = match.preferred_opponent_gender; // null means "any"
    const newGender =
      updates.preferredOpponentGender === 'any' ? null : updates.preferredOpponentGender;

    // Only validate if setting a specific gender (widening to "any" is always fine)
    if (newGender) {
      // Block if changing from one specific gender to a different specific gender
      if (currentGender && currentGender !== newGender) {
        return {
          canUpdate: false,
          errorCode: 'GENDER_CHANGE_BLOCKED',
          error:
            'Cannot change gender preference when participants have joined. Only narrowing from "all" is allowed when all participants match.',
        };
      }

      // Narrowing from "any" to specific — check that all participants match
      const mismatchedParticipants = joinedParticipants.filter(
        (p: { player: { gender: string } | { gender: string }[] | null }) => {
          // Handle both array and object formats from Supabase
          const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
          return playerObj?.gender && playerObj.gender !== newGender;
        }
      );

      if (mismatchedParticipants.length > 0) {
        return {
          canUpdate: false,
          errorCode: 'GENDER_CHANGE_BLOCKED',
          error: `${mismatchedParticipants.length} participant(s) do not match the new gender preference.`,
        };
      }
    }
  }

  return { canUpdate: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Update a match
 */
export async function updateMatch(
  matchId: string,
  updates: Partial<CreateMatchInput>,
  options?: { skipValidation?: boolean }
): Promise<Match> {
  // ========================================
  // VALIDATION (unless skipped)
  // ========================================
  if (!options?.skipValidation) {
    const validation = await validateMatchUpdate(matchId, updates);
    if (!validation.canUpdate) {
      throw new Error(validation.error || 'Update not allowed');
    }
    // Note: Warnings are returned but not blocking - caller can check them first
  }

  // Fetch original match details BEFORE applying updates (for notification with original date)
  const { data: originalMatch } = await supabase
    .from('match')
    .select('sport:sport_id (name), match_date, start_time')
    .eq('id', matchId)
    .single();

  // Map costSplitType to database enum values (same as createMatch)
  const costSplitMap: Record<string, 'host_pays' | 'split_equal' | 'custom'> = {
    creator_pays: 'host_pays',
    equal: 'split_equal',
    custom: 'custom',
  };

  // Map courtStatus to database enum values (same as createMatch)
  const courtStatusMap: Record<string, 'reserved' | 'to_reserve' | null> = {
    booked: 'reserved',
    to_book: 'to_reserve',
    tbd: null,
  };

  // Map input to database fields
  const updateData: Record<string, unknown> = {};

  if (updates.matchDate !== undefined) updateData.match_date = updates.matchDate;
  if (updates.startTime !== undefined) updateData.start_time = updates.startTime;
  if (updates.endTime !== undefined) updateData.end_time = updates.endTime;
  if (updates.timezone !== undefined) updateData.timezone = updates.timezone;
  if (updates.format !== undefined) updateData.format = updates.format;
  if (updates.playerExpectation !== undefined) {
    updateData.player_expectation = updates.playerExpectation;
  }
  if (updates.duration !== undefined) updateData.duration = updates.duration;
  if (updates.customDurationMinutes !== undefined)
    updateData.custom_duration_minutes = updates.customDurationMinutes;
  if (updates.locationType !== undefined) {
    updateData.location_type = updates.locationType;

    // Clear all location-related fields when switching location types
    // This ensures we start fresh with the new location type
    if (updates.locationType === 'tbd') {
      // TBD: clear everything
      updateData.facility_id = null;
      updateData.court_id = null;
      updateData.court_status = null;
      updateData.location_name = null;
      updateData.location_address = null;
      updateData.custom_latitude = null;
      updateData.custom_longitude = null;
    } else if (updates.locationType === 'facility') {
      // Facility: clear custom location fields (facility fields will be set separately)
      updateData.custom_latitude = null;
      updateData.custom_longitude = null;
      // Note: location_name/address may be set from facility, don't clear them here
    } else if (updates.locationType === 'custom') {
      // Custom: clear facility-related fields
      updateData.facility_id = null;
      updateData.court_id = null;
      updateData.court_status = null;
    }
  }
  if (updates.facilityId !== undefined) updateData.facility_id = emptyToNull(updates.facilityId);
  if (updates.courtId !== undefined) updateData.court_id = emptyToNull(updates.courtId);
  if (updates.locationName !== undefined)
    updateData.location_name = emptyToNull(updates.locationName);
  if (updates.locationAddress !== undefined)
    updateData.location_address = emptyToNull(updates.locationAddress);
  // Update custom coordinates if provided (will be cleared above if locationType changes away from 'custom')
  if (updates.customLatitude !== undefined) updateData.custom_latitude = updates.customLatitude;
  if (updates.customLongitude !== undefined) updateData.custom_longitude = updates.customLongitude;
  if (updates.courtStatus !== undefined) {
    updateData.court_status = courtStatusMap[updates.courtStatus] ?? null;
  }
  if (updates.isCourtFree !== undefined) updateData.is_court_free = updates.isCourtFree;
  if (updates.costSplitType !== undefined) {
    updateData.cost_split_type = costSplitMap[updates.costSplitType] ?? 'split_equal';
  }
  if (updates.estimatedCost !== undefined) updateData.estimated_cost = updates.estimatedCost;
  if (updates.minRatingScoreId !== undefined)
    updateData.min_rating_score_id = emptyToNull(updates.minRatingScoreId);
  if (updates.preferredOpponentGender !== undefined)
    updateData.preferred_opponent_gender =
      updates.preferredOpponentGender === 'any' ? null : updates.preferredOpponentGender;
  if (updates.visibility !== undefined) updateData.visibility = updates.visibility;
  if (updates.visibleInGroups !== undefined) updateData.visible_in_groups = updates.visibleInGroups;
  if (updates.visibleInCommunities !== undefined)
    updateData.visible_in_communities = updates.visibleInCommunities;
  if (updates.joinMode !== undefined) updateData.join_mode = updates.joinMode;
  if (updates.notes !== undefined) updateData.notes = emptyToNull(updates.notes);

  // Track when the host explicitly edits the match (used for leave-penalty exception)
  updateData.host_edited_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('match')
    .update(updateData)
    .eq('id', matchId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update match: ${error.message}`);
  }

  // ========================================
  // NOTIFY PARTICIPANTS OF CHANGES
  // ========================================
  // Get list of fields that were updated (for notification content)
  const updatedFields = Object.keys(updates).filter(
    key => updates[key as keyof typeof updates] !== undefined
  );

  // Fields that warrant participant notification
  const notifiableFields = [
    'matchDate',
    'startTime',
    'endTime',
    'duration',
    'customDurationMinutes',
    'timezone',
    'locationType',
    'facilityId',
    'courtId',
    'locationName',
    'locationAddress',
    'isCourtFree',
    'estimatedCost',
    'costSplitType',
    'format',
    'playerExpectation',
  ];

  const hasNotifiableChanges = updatedFields.some(field => notifiableFields.includes(field));

  if (hasNotifiableChanges) {
    // Fetch all joined participants (excluding the match creator who made the update)
    const { data: participantsData } = await supabase
      .from('match_participant')
      .select('player_id')
      .eq('match_id', matchId)
      .eq('status', 'joined');

    if (participantsData && participantsData.length > 0) {
      // Exclude the creator from notifications since they triggered the update
      const creatorId = (data as Match).created_by;
      const participantIds = participantsData.map(p => p.player_id).filter(id => id !== creatorId);

      if (participantIds.length > 0) {
        // Send notifications (fire and forget - don't block on notification)
        notifyMatchUpdated(participantIds, matchId, updatedFields, {
          sportName: (originalMatch?.sport as { name?: string } | null)?.name,
          matchDate: originalMatch?.match_date,
          startTime: originalMatch?.start_time,
        }).catch(err => {
          Logger.error('Failed to send match updated notifications:', err);
        });
      }
    }
  }

  // ========================================
  // SYNC MATCH CONVERSATION TITLE
  // ========================================
  const titleAffectingFields = ['format', 'matchDate', 'startTime'];
  const hasTitleChanges = updatedFields.some(field => titleAffectingFields.includes(field));

  if (hasTitleChanges) {
    const updatedMatch = data as Match;
    syncMatchConversationTitle(
      matchId,
      updatedMatch.format as 'singles' | 'doubles',
      updatedMatch.match_date,
      updatedMatch.created_by
    ).catch((err: unknown) => {
      console.error('[updateMatch] Failed to sync conversation title:', err);
    });
  }

  // ========================================
  // SUPERSEDE PENDING TIME SUGGESTIONS
  // The host directly changed the time window, so any pending counter-
  // proposals are now pointing at the wrong baseline. Mark them superseded
  // so they disappear from the host's pending list and the suggester sees a
  // resolved state. The match-updated push above already informs every
  // joined player (including suggesters) of the new window.
  // ========================================
  const timeAffectingFields = ['matchDate', 'startTime', 'endTime', 'duration', 'timezone'];
  const hasTimeChanges = updatedFields.some(field => timeAffectingFields.includes(field));
  if (hasTimeChanges) {
    supabase
      .from('match_time_suggestion')
      .update({
        status: 'superseded',
        resolved_at: new Date().toISOString(),
        resolved_by: (data as Match).created_by,
      })
      .eq('match_id', matchId)
      .eq('status', 'pending')
      .then(({ error: supersedeError }) => {
        if (supersedeError) {
          Logger.error('Failed to supersede pending time suggestions:', supersedeError);
        }
      });
  }

  return data as Match;
}

/**
 * Cancel a match (host only)
 *
 * @param matchId - The ID of the match to cancel
 * @param userId - The ID of the user attempting to cancel (must be the creator)
 * @throws Error if user is not the creator or match is already cancelled/completed
 */
export async function cancelMatch(matchId: string, userId?: string): Promise<Match> {
  // First, verify the user is authorized to cancel (must be the creator)
  // Include created_at for reputation penalty calculation
  const { data: match, error: fetchError } = await supabase
    .from('match')
    .select(
      'created_by, cancelled_at, created_at, match_date, start_time, end_time, timezone, court_status'
    )
    .eq('id', matchId)
    .single();

  if (fetchError || !match) {
    throw new Error('Match not found');
  }

  // Check authorization if userId is provided
  if (userId && match.created_by !== userId) {
    throw new Error('Only the host can cancel this match');
  }

  // Check if match is already cancelled (use cancelled_at instead of status)
  if (match.cancelled_at) {
    throw new Error('Match is already cancelled');
  }

  // Check if match has already started (can't cancel once it's in progress or completed)
  const { getTimeDifferenceFromNow } = await import('@rallia/shared-utils');
  const msUntilStart = getTimeDifferenceFromNow(
    match.match_date,
    match.start_time,
    match.timezone || 'UTC'
  );
  if (msUntilStart <= 0) {
    throw new Error('Cannot cancel a match that has already started');
  }

  // Perform the cancellation - set cancelled_at timestamp
  const { data, error } = await supabase
    .from('match')
    .update({
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', matchId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to cancel match: ${error.message}`);
  }

  // Create reputation event for cancellation (if userId is provided = host cancelling)
  if (userId) {
    // Use timezone-aware calculation for hours until match
    const msUntilMatch = getTimeDifferenceFromNow(
      match.match_date,
      match.start_time,
      match.timezone || 'UTC'
    );
    const hoursUntilMatch = msUntilMatch / (1000 * 60 * 60);

    // Determine if this is an early (no penalty) or late (graduated penalty) cancellation
    let isLateCancellation = false;

    // Cooling off: if match was created <1h ago, no penalty
    const createdAt = match.created_at ? new Date(match.created_at) : null;
    const hoursSinceCreation = createdAt
      ? (Date.now() - createdAt.getTime()) / (1000 * 60 * 60)
      : Infinity;
    const isCoolingOff = hoursSinceCreation < 1;

    // Check if any other participants are joined (no penalty if solo)
    const { data: joinedParticipants } = await supabase
      .from('match_participant')
      .select('player_id')
      .eq('match_id', matchId)
      .eq('status', 'joined')
      .neq('player_id', userId);
    const hasOtherParticipants = joinedParticipants && joinedParticipants.length > 0;

    // Court must be reserved for penalty to apply
    const courtReserved = match.court_status === 'reserved';

    // Must be a planned match (created 24h+ before start)
    const matchStartMs = getTimeDifferenceFromNow(
      match.match_date,
      match.start_time,
      match.timezone || 'UTC'
    );
    let isPlannedMatch = true;
    if (createdAt) {
      const hoursFromCreationToStart =
        (Date.now() + matchStartMs - createdAt.getTime()) / (1000 * 60 * 60);
      isPlannedMatch = hoursFromCreationToStart >= 24;
    }

    // Must be within 24h of start
    const isWithin24h = hoursUntilMatch < 24;

    if (!isCoolingOff && hasOtherParticipants && courtReserved && isPlannedMatch && isWithin24h) {
      isLateCancellation = true;
    }

    if (isLateCancellation) {
      // Graduated penalty: count recent offenses, compute penalty
      const recentOffenses = await countRecentCancellationEvents(userId);
      const penalty = calculateCancellationPenalty(hoursUntilMatch, 'creator', { recentOffenses });

      createReputationEvent(userId, 'match_cancelled_late', {
        matchId,
        customImpact: penalty,
        metadata: { hoursUntilMatch, courtStatus: match.court_status, recentOffenses },
      }).catch(err => {
        Logger.error('[cancelMatch] Failed to create reputation event:', err);
      });
    } else {
      createReputationEvent(userId, 'match_cancelled_early', { matchId }).catch(err => {
        Logger.error('[cancelMatch] Failed to create reputation event:', err);
      });
    }
  }

  // Notify all joined participants about the cancellation
  // First, get all participant IDs (excluding the host who cancelled)
  const { data: participantsData } = await supabase
    .from('match_participant')
    .select('player_id')
    .eq('match_id', matchId)
    .eq('status', 'joined');

  if (participantsData && participantsData.length > 0) {
    const participantIds = participantsData.map(p => p.player_id).filter(id => id !== userId); // Exclude the host

    if (participantIds.length > 0) {
      // Get sport name and location for better notification
      const { data: matchDetails } = await supabase
        .from('match')
        .select('sport:sport_id (name), location_name, facility:facility_id (name)')
        .eq('id', matchId)
        .single();

      const sportName = (matchDetails?.sport as { name?: string } | null)?.name ?? 'Match';
      const facilityName = (matchDetails?.facility as { name?: string } | null)?.name;
      const locationName =
        facilityName ??
        (matchDetails as { location_name?: string | null })?.location_name ??
        undefined;

      // Extract time in HH:MM format for notification
      const startTime = match.start_time ? match.start_time.slice(0, 5) : undefined;

      // Send notifications (fire and forget)
      notifyMatchCancelled(
        participantIds,
        matchId,
        match.match_date,
        sportName,
        startTime,
        locationName
      ).catch(err => {
        Logger.error('Failed to send match cancelled notifications:', err);
      });
    }
  }

  return data as Match;
}

/**
 * Delete a match (hard delete - use with caution)
 */
export async function deleteMatch(matchId: string): Promise<void> {
  const { error } = await supabase.from('match').delete().eq('id', matchId);

  if (error) {
    throw new Error(`Failed to delete match: ${error.message}`);
  }
}

// =============================================================================
// MATCH PARTICIPANT ACTIONS
// =============================================================================
// Match chat membership is maintained by Postgres triggers on `match` and
// `match_participant`. The TS layer no longer creates, updates, or deletes
// conversation_participant rows for match chats — see migration
// 20260426120000_match_chat_lifecycle_via_triggers.sql.

/**
 * Join match result with status info
 */
export interface JoinMatchResult {
  participant: MatchParticipant;
  status: Extract<MatchParticipantStatusEnum, 'joined' | 'requested' | 'waitlisted'>;
}

/**
 * Join a match as a participant.
 * - For direct join mode: Creates participant with 'joined' status
 * - For request join mode: Creates participant with 'requested' status (pending host approval)
 * - Accepting a pending invitation: lands as 'joined' regardless of join mode
 *
 * @throws Error if match is full, already joined, or match not found
 */
export async function joinMatch(matchId: string, playerId: string): Promise<JoinMatchResult> {
  // First, get match details to check join_mode, capacity, and gender preference
  const { data: match, error: matchError } = await supabase
    .from('match')
    .select(
      `
      id,
      format,
      join_mode,
      cancelled_at,
      match_date,
      start_time,
      end_time,
      timezone,
      created_by,
      facility_id,
      court_status,
      preferred_opponent_gender,
      sport:sport_id (name),
      participants:match_participant (
        id,
        player_id,
        status
      )
    `
    )
    .eq('id', matchId)
    .single();

  if (matchError || !match) {
    throw new Error('Match not found');
  }

  // Check match is still open using derived status logic
  // Match is not available if cancelled or if end_time has passed
  if (match.cancelled_at) {
    throw new Error('Match is no longer available');
  }

  // Check if match has already ended
  const { getMatchEndTimeDifferenceFromNow } = await import('@rallia/shared-utils');
  const endTimeDiff = getMatchEndTimeDifferenceFromNow(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone || 'UTC'
  );
  if (endTimeDiff < 0) {
    throw new Error('Match is no longer available');
  }

  // Check if player is already a host participant (creators can't join their own match)
  const isHost = match.participants?.some(
    (p: { player_id: string; is_host?: boolean | null }) => p.player_id === playerId && p.is_host
  );
  if (isHost) {
    throw new Error('You are the host of this match');
  }

  // Check gender eligibility if the match has a gender preference
  if (match.preferred_opponent_gender) {
    // Fetch the player's gender
    const { data: player, error: playerError } = await supabase
      .from('player')
      .select('gender')
      .eq('id', playerId)
      .single();

    if (playerError) {
      throw new Error('Could not verify player eligibility');
    }

    // If player hasn't set their gender, or gender doesn't match, block the join
    if (!player?.gender || player.gender !== match.preferred_opponent_gender) {
      throw new Error('GENDER_MISMATCH');
    }
  }

  // Check if player already has a participant record
  const existingParticipant = match.participants?.find(
    (p: { player_id: string; status: string }) => p.player_id === playerId
  );

  // If they have an active participation, they can't join again
  // Allow joining/re-joining if:
  // - 'pending': invited by host, accepting the invitation
  // - 'cancelled': invitation was cancelled by host; user can still join the public match
  // - 'left': previously left the match
  // - 'declined': previously declined an invitation
  // - 'refused': host previously rejected their join request
  // - 'kicked': previously kicked from the match
  // - 'waitlisted': on waitlist, spots may have opened up
  const allowedStatuses = [
    'pending',
    'cancelled',
    'left',
    'declined',
    'refused',
    'kicked',
    'waitlisted',
  ];
  if (existingParticipant && !allowedStatuses.includes(existingParticipant.status)) {
    throw new Error('You are already in this match');
  }

  // Calculate spots: format determines total capacity (singles=2, doubles=4)
  // Joined participants (now includes creator who has is_host=true) fill spots
  const totalSpots = match.format === 'doubles' ? 4 : 2;
  const joinedParticipants =
    match.participants?.filter((p: { status: string }) => p.status === 'joined').length ?? 0;
  // Available = total - joined participants (creator is now included in joined participants)
  const availableSpots = totalSpots - joinedParticipants;

  // Determine status based on join mode and availability
  let participantStatus: Extract<MatchParticipantStatusEnum, 'joined' | 'requested' | 'waitlisted'>;

  // An invited player (existing 'pending' row) accepting is standing approval.
  const isAcceptingInvite = existingParticipant?.status === 'pending';

  if (availableSpots <= 0) {
    // Match is full - add to waitlist
    participantStatus = 'waitlisted';
  } else if (match.join_mode === 'request' && !isAcceptingInvite) {
    // Cold request-to-join still needs host approval.
    participantStatus = 'requested';
  } else {
    // Direct-join, or accepting an invite: both land joined.
    participantStatus = 'joined';
  }

  let participant: MatchParticipant;

  // If user previously left/declined, update the existing record instead of inserting
  if (existingParticipant) {
    const { data: updatedParticipant, error: updateError } = await supabase
      .from('match_participant')
      .update({
        status: participantStatus,
        updated_at: new Date().toISOString(),
        ...(participantStatus === 'joined' ? { joined_at: new Date().toISOString() } : {}),
      })
      .eq('match_id', matchId)
      .eq('player_id', playerId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to rejoin match: ${updateError.message}`);
    }
    participant = updatedParticipant as MatchParticipant;
  } else {
    // Insert new participant record
    const { data: newParticipant, error: insertError } = await supabase
      .from('match_participant')
      .insert({
        match_id: matchId,
        player_id: playerId,
        status: participantStatus,
        is_host: false,
        ...(participantStatus === 'joined' ? { joined_at: new Date().toISOString() } : {}),
      })
      .select()
      .single();

    if (insertError) {
      // Handle unique constraint violation (shouldn't happen but just in case)
      if (insertError.code === '23505') {
        throw new Error('You are already in this match');
      }
      throw new Error(`Failed to join match: ${insertError.message}`);
    }
    participant = newParticipant as MatchParticipant;
  }

  // Get player name and avatar for notifications (player.id = profile.id)
  const { data: profileData } = await supabase
    .from('profile')
    .select('first_name, last_name, display_name, profile_picture_url')
    .eq('id', playerId)
    .single();

  // Prefer first_name + last_name for notifications
  const playerName =
    profileData?.first_name && profileData?.last_name
      ? `${profileData.first_name} ${profileData.last_name}`
      : profileData?.first_name || 'A player';
  const playerAvatarUrl = getProfilePictureUrl(profileData?.profile_picture_url) ?? undefined;

  // Send notification to host if this is a join request
  if (participantStatus === 'requested') {
    // Notify the host (fire and forget - don't block on notification)
    const sportName = (match.sport as { name?: string } | null)?.name;
    notifyMatchJoinRequest(match.created_by, matchId, playerName, sportName, match.match_date, {
      playerAvatarUrl,
    }).catch(err => {
      Logger.error('Failed to send join request notification:', err);
    });
  }

  // Send notifications to host and participants when a player directly joins (open access)
  if (participantStatus === 'joined') {
    // Get all joined participants (excluding the new player)
    // Note: The creator is now a participant, so they'll be included in this list if they're joined
    const otherParticipants =
      match.participants?.filter(
        (p: { player_id: string; status: string }) =>
          p.status === 'joined' && p.player_id !== playerId
      ) ?? [];

    // Collect all user IDs to notify (creator is already included if they're a participant)
    const userIdsToNotify = otherParticipants.map((p: { player_id: string }) => p.player_id);

    // Remove duplicates
    const uniqueUserIds = [...new Set(userIdsToNotify)];

    if (uniqueUserIds.length > 0) {
      // Fetch match details for more informative notification
      const { data: matchDetails } = await supabase
        .from('match')
        .select(
          `
          sport:sport_id (name),
          location_type,
          location_name,
          location_address,
          custom_latitude,
          custom_longitude,
          match_date,
          start_time,
          facility:facility_id (name)
        `
        )
        .eq('id', matchId)
        .single();

      const sportName = (matchDetails?.sport as { name?: string } | null)?.name;
      const facilityName = (matchDetails?.facility as { name?: string } | null)?.name;
      // Don't include location if it's TBD
      const locationName =
        matchDetails?.location_type === 'tbd'
          ? undefined
          : (facilityName ?? matchDetails?.location_name);

      // Format match date
      let formattedDate: string | undefined;
      if (matchDetails?.match_date && matchDetails?.start_time) {
        try {
          const matchDateTime = new Date(`${matchDetails.match_date}T${matchDetails.start_time}`);
          formattedDate = matchDateTime.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
        } catch {
          // Fallback to raw date if parsing fails
          formattedDate = matchDetails.match_date;
        }
      }

      // Calculate spots left after this player joined
      const spotsLeft = availableSpots - 1;

      // When this join fills a facility-linked match with no court reserved, the
      // server-side "book your court" prompt (Rallia system message, posted by a
      // trigger on match_participant) becomes the canonical fill notification.
      // Skip the duplicate body_full "match is full" push in that case so
      // participants don't get two near-simultaneous notifications.
      const bookingPromptWillNotify =
        spotsLeft === 0 && !!match.facility_id && match.court_status !== 'reserved';

      // Notify all users (fire and forget - don't block on notification)
      if (!bookingPromptWillNotify) {
        notifyPlayerJoined(
          uniqueUserIds,
          matchId,
          playerName,
          sportName,
          formattedDate,
          locationName,
          spotsLeft,
          {
            playerAvatarUrl,
            locationAddress: matchDetails?.location_address ?? undefined,
            latitude: matchDetails?.custom_latitude ?? undefined,
            longitude: matchDetails?.custom_longitude ?? undefined,
          }
        ).catch(err => {
          Logger.error('Failed to send player joined notifications:', err);
        });
      }
    }

    // Match chat membership is synced by DB triggers on match_participant.
  }

  return {
    participant: participant as MatchParticipant,
    status: participantStatus,
  };
}

/**
 * Leave a match as a participant.
 * Updates the participant status to 'left' (soft delete to preserve history).
 *
 * Creates a reputation event (match_cancelled_late, -25 impact) if ALL conditions are met:
 * 1. Match is full (all spots taken)
 * 2. Match was created more than 24 hours before start time (planned match)
 * 3. Match was NOT edited within 24 hours of start time (no last-minute host changes)
 * 4. Player is leaving within 24 hours of start time
 *
 * @throws Error if user is the host, not a participant, or match not found
 */
export async function leaveMatch(matchId: string, playerId: string): Promise<void> {
  // First check if user is the match host and get match details
  // Include fields needed for reputation penalty calculation
  const { data: match, error: matchError } = await supabase
    .from('match')
    .select(
      `
      created_by,
      created_at,
      host_edited_at,
      match_date,
      start_time,
      timezone,
      format,
      court_status,
      sport:sport_id (name),
      participants:match_participant (
        player_id,
        status,
        is_host,
        joined_at
      )
    `
    )
    .eq('id', matchId)
    .single();

  if (matchError || !match) {
    throw new Error('Match not found');
  }

  // Check if user is the host (either via is_host flag or created_by for backwards compatibility)
  const isHost = match.participants?.some(
    (p: { player_id: string; is_host?: boolean | null }) => p.player_id === playerId && p.is_host
  );
  if (isHost || match.created_by === playerId) {
    throw new Error('Hosts cannot leave their own match. Cancel it instead.');
  }

  // Calculate if reputation penalty applies BEFORE updating status
  // (we need to check if match is full with current player still counted)
  const joinedParticipants =
    match.participants?.filter((p: { status: string }) => p.status === 'joined') ?? [];
  const totalCapacity = match.format === 'doubles' ? 4 : 2;
  const isMatchFull = joinedParticipants.length >= totalCapacity;

  // Update status to 'left'
  const { data, error } = await supabase
    .from('match_participant')
    .update({ status: 'left' })
    .eq('match_id', matchId)
    .eq('player_id', playerId)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new Error('You are not a participant in this match');
    }
    throw new Error(`Failed to leave match: ${error.message}`);
  }

  if (!data) {
    throw new Error('You are not a participant in this match');
  }

  // ========================================
  // CREATE REPUTATION EVENT IF APPLICABLE
  // ========================================
  // Graduated penalty for leaving a full match late.
  // Waitlisted players should never incur a penalty for leaving.
  const wasJoinedParticipant = joinedParticipants.some(
    (p: { player_id: string }) => p.player_id === playerId
  );
  if (wasJoinedParticipant && isMatchFull) {
    const { getTimeDifferenceFromNow } = await import('@rallia/shared-utils');
    const msUntilMatch = getTimeDifferenceFromNow(
      match.match_date,
      match.start_time,
      match.timezone || 'UTC'
    );
    const hoursUntilMatch = msUntilMatch / (1000 * 60 * 60);

    // Only apply penalty within 24h of start
    if (hoursUntilMatch < 24) {
      let shouldCreatePenalty = true;

      // Cooling off: if player joined <1h ago, no penalty
      const playerParticipant = joinedParticipants.find(
        (p: { player_id: string }) => p.player_id === playerId
      ) as { player_id: string; joined_at?: string } | undefined;
      if (playerParticipant?.joined_at) {
        const hoursSinceJoin =
          (Date.now() - new Date(playerParticipant.joined_at).getTime()) / (1000 * 60 * 60);
        if (hoursSinceJoin < 1) {
          shouldCreatePenalty = false;
        }
      }

      // Court must be reserved for penalty to apply
      if (shouldCreatePenalty && match.court_status !== 'reserved') {
        shouldCreatePenalty = false;
      }

      // Spontaneous match exception: created <24h before start
      if (shouldCreatePenalty && match.created_at) {
        const createdAt = new Date(match.created_at);
        const matchStartMs = Date.now() + msUntilMatch;
        const hoursFromCreationToStart = (matchStartMs - createdAt.getTime()) / (1000 * 60 * 60);
        if (hoursFromCreationToStart < 24) {
          shouldCreatePenalty = false;
        }
      }

      // Host-edit exception: if host explicitly edited match <24h before NOW (player is reacting to recent changes)
      if (shouldCreatePenalty && match.host_edited_at) {
        const hostEditedAt = new Date(match.host_edited_at);
        const hoursSinceEdit = (Date.now() - hostEditedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceEdit < 24) {
          shouldCreatePenalty = false;
        }
      }

      if (shouldCreatePenalty) {
        const recentOffenses = await countRecentCancellationEvents(playerId);
        const penalty = calculateCancellationPenalty(hoursUntilMatch, 'participant', {
          recentOffenses,
        });

        createReputationEvent(playerId, 'match_left_late', {
          matchId,
          customImpact: penalty,
          metadata: { hoursUntilMatch, recentOffenses },
        }).catch(err => {
          Logger.error('[leaveMatch] Failed to create reputation event:', err);
        });
      }
    }
  }

  // Only notify other participants when a joined player leaves (not waitlisted players)
  if (wasJoinedParticipant) {
    // Get player name for notification
    const { data: profileData } = await supabase
      .from('profile')
      .select('first_name, last_name, display_name')
      .eq('id', playerId)
      .single();

    const playerName =
      profileData?.first_name && profileData?.last_name
        ? `${profileData.first_name} ${profileData.last_name}`
        : profileData?.first_name || 'A player';
    const sportName = (match.sport as { name?: string } | null)?.name;

    // Get all remaining joined participants (excluding the player who left)
    // Note: The creator is now a participant, so they'll be included in this list if they're joined
    const remainingParticipants =
      match.participants?.filter(
        (p: { player_id: string; status: string }) =>
          p.status === 'joined' && p.player_id !== playerId
      ) ?? [];

    // Recipients are the remaining joined participants (creator is already included if they're a participant)
    const userIdsToNotify = remainingParticipants.map((p: { player_id: string }) => p.player_id);

    // Remove duplicates
    const uniqueUserIds = [...new Set(userIdsToNotify)];

    if (uniqueUserIds.length > 0) {
      // Calculate spots left after the player left
      const spotsLeft = totalCapacity - remainingParticipants.length;

      // Notify all users (fire and forget - don't block on notification)
      notifyPlayerLeft(uniqueUserIds, matchId, playerName, sportName, spotsLeft).catch(err => {
        Logger.error('Failed to send player left notifications:', err);
      });
    }

    // Notify waitlisted players that a spot opened up
    const waitlistedPlayers =
      match.participants?.filter(
        (p: { player_id: string; status: string }) => p.status === 'waitlisted'
      ) ?? [];

    if (waitlistedPlayers.length > 0) {
      const waitlistedUserIds = waitlistedPlayers.map((p: { player_id: string }) => p.player_id);
      const startTime = match.start_time ? match.start_time.slice(0, 5) : undefined;

      notifyMatchSpotOpened(waitlistedUserIds, matchId, sportName, { startTime }).catch(err => {
        Logger.error('Failed to send spot opened notifications:', err);
      });
    }
  }

  // Match chat membership is synced by DB triggers on match_participant.
}

/**
 * Get a player's participation status in a match
 */
export async function getParticipantStatus(
  matchId: string,
  playerId: string
): Promise<MatchParticipant | null> {
  const { data, error } = await supabase
    .from('match_participant')
    .select('*')
    .eq('match_id', matchId)
    .eq('player_id', playerId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to get participant status: ${error.message}`);
  }

  return data as MatchParticipant;
}

/**
 * Accept a join request for a match (host only).
 * Updates the participant status from 'requested' to 'joined'.
 *
 * @param matchId - The match ID
 * @param participantId - The participant record ID (not player_id)
 * @param hostId - The ID of the user performing the action (must be match host)
 * @throws Error if not host, participant not found, not in 'requested' status, or match is full
 */
export async function acceptJoinRequest(
  matchId: string,
  participantId: string,
  hostId: string
): Promise<MatchParticipant> {
  // First, verify the caller is the match host and get match details
  const { data: match, error: matchError } = await supabase
    .from('match')
    .select(
      `
      id,
      format,
      created_by,
      cancelled_at,
      match_date,
      start_time,
      end_time,
      timezone,
      location_type,
      location_name,
      sport:sport_id (name),
      facility:facility_id (name),
      participants:match_participant (
        id,
        player_id,
        status
      )
    `
    )
    .eq('id', matchId)
    .single();

  if (matchError || !match) {
    throw new Error('Match not found');
  }

  // Check match is still available (not cancelled or completed)
  if (match.cancelled_at) {
    throw new Error('Cannot accept requests for a cancelled match');
  }

  const { getMatchEndTimeDifferenceFromNow } = await import('@rallia/shared-utils');
  const endTimeDiff = getMatchEndTimeDifferenceFromNow(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone || 'UTC'
  );
  if (endTimeDiff < 0) {
    throw new Error('Cannot accept requests for a completed match');
  }

  // Verify caller is the host
  if (match.created_by !== hostId) {
    throw new Error('Only the match host can accept join requests');
  }

  // Find the participant record
  const participant = match.participants?.find(
    (p: { id: string; status: string }) => p.id === participantId
  );

  if (!participant) {
    throw new Error('Join request not found');
  }

  // Verify the participant has 'requested' status
  if (participant.status !== 'requested') {
    throw new Error('This is not a pending join request');
  }

  // Check if there's capacity to accept
  const totalSpots = match.format === 'doubles' ? 4 : 2;
  const joinedParticipants =
    match.participants?.filter((p: { status: string }) => p.status === 'joined').length ?? 0;
  // Creator is now included in joined participants
  const availableSpots = totalSpots - joinedParticipants;

  if (availableSpots <= 0) {
    throw new Error('Match is full. Cannot accept more players.');
  }

  // Update the participant status to 'joined'
  const { data: updatedParticipant, error: updateError } = await supabase
    .from('match_participant')
    .update({
      status: 'joined',
      updated_at: new Date().toISOString(),
      joined_at: new Date().toISOString(),
    })
    .eq('id', participantId)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to accept join request: ${updateError.message}`);
  }

  // Notify the player that their request was accepted (fire and forget)
  // Extract time in HH:MM format for notification
  const startTime = match.start_time ? match.start_time.slice(0, 5) : undefined;
  const sportName = (match.sport as { name?: string } | null)?.name;
  const locationName =
    match.location_type === 'tbd'
      ? undefined
      : ((match.facility as { name?: string } | null)?.name ?? match.location_name);

  notifyJoinRequestAccepted(
    participant.player_id,
    matchId,
    match.match_date,
    startTime,
    sportName,
    locationName
  ).catch(err => {
    Logger.error('Failed to send join accepted notification:', err);
  });

  // Match chat membership is synced by DB triggers on match_participant.

  return updatedParticipant as MatchParticipant;
}

/**
 * Reject a join request for a match (host only).
 * Updates the participant status from 'requested' to 'refused'.
 *
 * Note: 'refused' is used when a host rejects a join request.
 * 'declined' is used when an invited player declines an invitation.
 *
 * @param matchId - The match ID
 * @param participantId - The participant record ID (not player_id)
 * @param hostId - The ID of the user performing the action (must be match host)
 * @throws Error if not host, participant not found, or not in 'requested' status
 */
export async function rejectJoinRequest(
  matchId: string,
  participantId: string,
  hostId: string
): Promise<MatchParticipant> {
  // First, verify the caller is the match host
  const { data: match, error: matchError } = await supabase
    .from('match')
    .select(
      `
      id,
      created_by,
      cancelled_at,
      match_date,
      start_time,
      end_time,
      timezone,
      sport:sport_id (name),
      participants:match_participant (
        id,
        player_id,
        status
      )
    `
    )
    .eq('id', matchId)
    .single();

  if (matchError || !match) {
    throw new Error('Match not found');
  }

  // Check match is still available (not cancelled or completed)
  if (match.cancelled_at) {
    throw new Error('Cannot reject requests for a cancelled match');
  }

  const { getMatchEndTimeDifferenceFromNow } = await import('@rallia/shared-utils');
  const endTimeDiff = getMatchEndTimeDifferenceFromNow(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone || 'UTC'
  );
  if (endTimeDiff < 0) {
    throw new Error('Cannot reject requests for a completed match');
  }

  // Verify caller is the host
  if (match.created_by !== hostId) {
    throw new Error('Only the match host can reject join requests');
  }

  // Find the participant record
  const participant = match.participants?.find(
    (p: { id: string; status: string }) => p.id === participantId
  );

  if (!participant) {
    throw new Error('Join request not found');
  }

  // Verify the participant has 'requested' status
  if (participant.status !== 'requested') {
    throw new Error('This is not a pending join request');
  }

  // Update the participant status to 'refused'
  const { data: updatedParticipant, error: updateError } = await supabase
    .from('match_participant')
    .update({
      status: 'refused',
      updated_at: new Date().toISOString(),
    })
    .eq('id', participantId)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to reject join request: ${updateError.message}`);
  }

  // Get the participant's player_id to notify them
  const participantRecord = match.participants?.find(
    (p: { id: string }) => p.id === participantId
  ) as { player_id: string } | undefined;

  if (participantRecord?.player_id) {
    // Notify the player that their request was rejected (fire and forget)
    const sportName = (match.sport as { name?: string } | null)?.name;
    notifyJoinRequestRejected(
      participantRecord.player_id,
      matchId,
      sportName,
      match.match_date
    ).catch(err => {
      Logger.error('Failed to send join rejected notification:', err);
    });
  }

  return updatedParticipant as MatchParticipant;
}

/**
 * Cancel a pending join request (requester only).
 * Updates the participant status from 'requested' to 'left'.
 *
 * @param matchId - The match ID
 * @param playerId - The ID of the player cancelling their request
 * @throws Error if participant not found or not in 'requested' status
 */
export async function cancelJoinRequest(
  matchId: string,
  playerId: string
): Promise<MatchParticipant> {
  // First, verify the user has a pending request
  const { data: participant, error: participantError } = await supabase
    .from('match_participant')
    .select('id, status')
    .eq('match_id', matchId)
    .eq('player_id', playerId)
    .single();

  if (participantError || !participant) {
    throw new Error('Join request not found');
  }

  // Verify the participant has 'requested' status
  if (participant.status !== 'requested') {
    throw new Error('No pending request to cancel');
  }

  // Update the participant status to 'left'
  const { data: updatedParticipant, error: updateError } = await supabase
    .from('match_participant')
    .update({
      status: 'left',
      updated_at: new Date().toISOString(),
    })
    .eq('id', participant.id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to cancel join request: ${updateError.message}`);
  }

  return updatedParticipant as MatchParticipant;
}

/**
 * Kick a joined participant from a match (host only).
 * Updates the participant status from 'joined' to 'kicked'.
 *
 * @param matchId - The match ID
 * @param participantId - The participant record ID (not player_id)
 * @param hostId - The ID of the user performing the action (must be match host)
 * @throws Error if not host, participant not found, or not in 'joined' status
 */
export async function kickParticipant(
  matchId: string,
  participantId: string,
  hostId: string
): Promise<MatchParticipant> {
  // First, verify the caller is the match host
  const { data: match, error: matchError } = await supabase
    .from('match')
    .select(
      `
      id,
      created_by,
      cancelled_at,
      match_date,
      start_time,
      end_time,
      timezone,
      sport:sport_id (name),
      participants:match_participant (
        id,
        player_id,
        status
      )
    `
    )
    .eq('id', matchId)
    .single();

  if (matchError || !match) {
    throw new Error('Match not found');
  }

  // Check match is still available (not cancelled or completed)
  if (match.cancelled_at) {
    throw new Error('Cannot kick participants from a cancelled match');
  }

  const { getMatchEndTimeDifferenceFromNow } = await import('@rallia/shared-utils');
  const endTimeDiff = getMatchEndTimeDifferenceFromNow(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone || 'UTC'
  );
  if (endTimeDiff < 0) {
    throw new Error('Cannot kick participants from a completed match');
  }

  // Verify caller is the host
  if (match.created_by !== hostId) {
    throw new Error('Only the match host can kick participants');
  }

  // Find the participant record
  const participant = match.participants?.find(
    (p: { id: string; status: string }) => p.id === participantId
  );

  if (!participant) {
    throw new Error('Participant not found');
  }

  // Verify the participant has 'joined' status
  if (participant.status !== 'joined') {
    throw new Error('This participant is not currently joined');
  }

  // Update the participant status to 'kicked'
  const { data: updatedParticipant, error: updateError } = await supabase
    .from('match_participant')
    .update({
      status: 'kicked',
      updated_at: new Date().toISOString(),
    })
    .eq('id', participantId)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to kick participant: ${updateError.message}`);
  }

  // Notify the kicked player (fire and forget)
  const participantRecord = match.participants?.find(
    (p: { id: string }) => p.id === participantId
  ) as { player_id: string } | undefined;

  if (participantRecord?.player_id) {
    // Extract time in HH:MM format for notification
    const startTime = match.start_time ? match.start_time.slice(0, 5) : undefined;
    const sportName = (match.sport as { name?: string } | null)?.name;

    notifyPlayerKicked(
      participantRecord.player_id,
      matchId,
      sportName,
      match.match_date,
      startTime
    ).catch(err => {
      Logger.error('Failed to send kicked notification:', err);
    });

    // Notify waitlisted players that a spot opened up
    const waitlistedPlayers =
      match.participants?.filter(
        (p: { id: string; player_id: string; status: string }) =>
          p.status === 'waitlisted' && p.id !== participantId
      ) ?? [];

    if (waitlistedPlayers.length > 0) {
      const waitlistedUserIds = waitlistedPlayers.map((p: { player_id: string }) => p.player_id);

      notifyMatchSpotOpened(waitlistedUserIds, matchId, sportName, { startTime }).catch(err => {
        Logger.error('Failed to send spot opened notifications:', err);
      });
    }

    // Match chat membership is synced by DB triggers on match_participant.
  }

  return updatedParticipant as MatchParticipant;
}

/**
 * Cancel an invitation for a match (host only).
 * Updates the participant status from 'pending' to 'cancelled'.
 *
 * @param matchId - The match ID
 * @param participantId - The participant record ID (not player_id)
 * @param hostId - The ID of the user performing the action (must be match host)
 * @throws Error if not host, participant not found, or not in 'pending' status
 */
export async function cancelInvitation(
  matchId: string,
  participantId: string,
  hostId: string
): Promise<MatchParticipant> {
  // First, verify the caller is the match host
  const { data: match, error: matchError } = await supabase
    .from('match')
    .select(
      `
      id,
      created_by,
      cancelled_at,
      match_date,
      start_time,
      end_time,
      timezone,
      participants:match_participant (
        id,
        player_id,
        status
      )
    `
    )
    .eq('id', matchId)
    .single();

  if (matchError || !match) {
    throw new Error('Match not found');
  }

  // Check match is still available (not cancelled)
  if (match.cancelled_at) {
    throw new Error('Cannot cancel invitations for a cancelled match');
  }

  // Check if match has already ended
  const { getMatchEndTimeDifferenceFromNow } = await import('@rallia/shared-utils');
  const endTimeDiff = getMatchEndTimeDifferenceFromNow(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone || 'UTC'
  );
  if (endTimeDiff < 0) {
    throw new Error('Cannot cancel invitations for a completed match');
  }

  // Verify caller is the host
  if (match.created_by !== hostId) {
    throw new Error('Only the match host can cancel invitations');
  }

  // Find the participant record
  const participant = match.participants?.find(
    (p: { id: string; status: string }) => p.id === participantId
  );

  if (!participant) {
    throw new Error('Invitation not found');
  }

  // Verify the participant has 'pending' status (is an invitation)
  if (participant.status !== 'pending') {
    throw new Error('This is not a pending invitation');
  }

  // Update the participant status to 'cancelled'
  const { data: updatedParticipant, error: updateError } = await supabase
    .from('match_participant')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', participantId)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to cancel invitation: ${updateError.message}`);
  }

  // No notification sent to invitee (per requirements)

  return updatedParticipant as MatchParticipant;
}

/**
 * Decline an invitation to a match (invitee only).
 * Updates the participant status from 'pending' to 'declined'.
 *
 * @param matchId - The match ID
 * @param playerId - The ID of the player declining the invitation
 * @throws Error if participant not found or not in 'pending' status
 */
/** Invitee-decline reasons (subset of cancellation_reason_enum). Optional. */
export type DeclineReason =
  | 'bad_timing'
  | 'too_far'
  | 'skill_mismatch'
  | 'dont_know_player'
  | 'cost'
  | 'changed_mind'
  | 'other';

export async function declineInvitation(
  matchId: string,
  playerId: string,
  reason?: DeclineReason | null
): Promise<MatchParticipant> {
  // Find the player's pending invitation
  const { data: participant, error: participantError } = await supabase
    .from('match_participant')
    .select('id, status, player_id')
    .eq('match_id', matchId)
    .eq('player_id', playerId)
    .single();

  if (participantError || !participant) {
    throw new Error('Invitation not found');
  }

  // Verify the participant has 'pending' status
  if (participant.status !== 'pending') {
    throw new Error('No pending invitation to decline');
  }

  // Update the participant status to 'declined', capturing why (optional).
  const { data: updatedParticipant, error: updateError } = await supabase
    .from('match_participant')
    .update({
      status: 'declined',
      cancellation_reason: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', participant.id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Failed to decline invitation: ${updateError.message}`);
  }

  return updatedParticipant as MatchParticipant;
}

/**
 * Resend an invitation for a match (host only).
 * - For 'pending' invitations: resends the notification
 * - For 'declined' invitations: updates status to 'pending' and sends notification
 *
 * @param matchId - The match ID
 * @param participantId - The participant record ID (not player_id)
 * @param hostId - The ID of the user performing the action (must be match host)
 * @throws Error if not host, participant not found, or not in 'pending'/'declined' status
 */
export async function resendInvitation(
  matchId: string,
  participantId: string,
  hostId: string
): Promise<MatchParticipant> {
  // First, verify the caller is the match host and get match details
  const { data: match, error: matchError } = await supabase
    .from('match')
    .select(
      `
      id,
      created_by,
      cancelled_at,
      match_date,
      start_time,
      end_time,
      timezone,
      location_name,
      facility:facility_id (
        name
      ),
      sport:sport (
        id,
        name,
        display_name
      ),
      participants:match_participant (
        id,
        player_id,
        status
      )
    `
    )
    .eq('id', matchId)
    .single();

  if (matchError || !match) {
    throw new Error('Match not found');
  }

  // Check match is still available (not cancelled)
  if (match.cancelled_at) {
    throw new Error('Cannot resend invitations for a cancelled match');
  }

  // Check if match has already ended
  const { getMatchEndTimeDifferenceFromNow } = await import('@rallia/shared-utils');
  const endTimeDiff = getMatchEndTimeDifferenceFromNow(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone || 'UTC'
  );
  if (endTimeDiff < 0) {
    throw new Error('Cannot resend invitations for a completed match');
  }

  // Verify caller is the host
  if (match.created_by !== hostId) {
    throw new Error('Only the match host can resend invitations');
  }

  // Find the participant record
  const participant = match.participants?.find(
    (p: { id: string; status: string }) => p.id === participantId
  );

  if (!participant) {
    throw new Error('Invitation not found');
  }

  // Verify the participant has 'pending' or 'declined' status
  if (participant.status !== 'pending' && participant.status !== 'declined') {
    throw new Error('This is not a pending or declined invitation');
  }

  let updatedParticipant: MatchParticipant;

  // If status is 'declined', update it to 'pending'
  if (participant.status === 'declined') {
    const { data: updated, error: updateError } = await supabase
      .from('match_participant')
      .update({
        status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', participantId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to resend invitation: ${updateError.message}`);
    }
    updatedParticipant = updated as MatchParticipant;
  } else {
    // Status is already 'pending', just fetch the current record
    const { data: current, error: fetchError } = await supabase
      .from('match_participant')
      .select()
      .eq('id', participantId)
      .single();

    if (fetchError || !current) {
      throw new Error('Failed to fetch participant record');
    }
    updatedParticipant = current as MatchParticipant;
  }

  // Get host profile for notification
  const { data: hostProfile } = await supabase
    .from('profile')
    .select('first_name, last_name, display_name')
    .eq('id', hostId)
    .single();

  const inviterName =
    hostProfile?.first_name && hostProfile?.last_name
      ? `${hostProfile.first_name} ${hostProfile.last_name}`
      : hostProfile?.first_name || 'A player';

  // Get sport name (handle both array and object cases from Supabase types)
  const sportData = match.sport as
    | { name: string; display_name?: string | null }
    | { name: string; display_name?: string | null }[]
    | null;
  const sport = Array.isArray(sportData) ? sportData[0] : sportData;
  const sportName = sport?.display_name || sport?.name || 'a match';

  // Derive location name from facility or custom location
  const facilityData = match.facility as { name?: string } | { name?: string }[] | null;
  const facilityObj = Array.isArray(facilityData) ? facilityData[0] : facilityData;
  const locationName =
    facilityObj?.name || (match as { location_name?: string | null }).location_name || undefined;

  // Send invitation notification (fire and forget)
  const participantRecord = match.participants?.find(
    (p: { id: string }) => p.id === participantId
  ) as { player_id: string } | undefined;

  if (participantRecord?.player_id) {
    // Extract time in HH:MM format for notification
    const startTime = match.start_time ? match.start_time.slice(0, 5) : undefined;

    notifyMatchInvitation(
      participantRecord.player_id,
      matchId,
      inviterName,
      sportName,
      match.match_date,
      startTime,
      locationName
    ).catch(err => {
      Logger.error('Failed to send invitation notification:', err);
    });
  }

  return updatedParticipant;
}

/**
 * Parameters for searching nearby matches
 */
export interface SearchNearbyMatchesParams {
  latitude: number;
  longitude: number;
  maxDistanceKm: number;
  sportId: string;
  /** The viewing user's gender for eligibility filtering */
  userGender?: string | null;
  /**
   * Authenticated caller's player id. When provided, routes through the
   * scored RPC `get_upcoming_matches_scored` which returns relevance-ordered
   * matches with `player_compatibility`, `facility_affinity`, and
   * `score_history` attached. When omitted (anon), uses `search_matches_nearby`
   * which only filters and chronologically orders.
   */
  callerId?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * Result from nearby matches RPC (anon path)
 */
interface NearbyMatchResult {
  match_id: string;
  distance_meters: number;
}

/**
 * Result from scored RPC (auth path)
 */
interface ScoredNearbyMatchResult {
  match_id: string;
  distance_meters: number;
  player_compatibility: number;
  facility_affinity: number;
  score_history: number;
}

/**
 * Match with details including distance (for nearby matches).
 * Scoring fields are populated when the auth scored RPC was used.
 */
export interface MatchWithDetailsAndDistance extends MatchWithDetails {
  distance_meters: number | null;
  /** Caller↔creator relevance in [0,1]. NULL when called anonymously. */
  player_compatibility?: number | null;
  /** Match-location affinity (shared favorite + distance decay) in [0,1]. NULL when anon. */
  facility_affinity?: number | null;
  /** Caller↔creator history score in [-0.5, +0.5]. NULL when anon. */
  score_history?: number | null;
}

/**
 * Get matches at facilities near a location, within max distance.
 * Uses PostGIS RPC function for efficient distance filtering.
 * Returns full match details with distance_meters attached.
 */
export async function getNearbyMatches(params: SearchNearbyMatchesParams) {
  const {
    latitude,
    longitude,
    maxDistanceKm,
    sportId,
    userGender,
    callerId,
    limit = 20,
    offset = 0,
  } = params;

  // Step 1: Get match IDs (+ optional scoring) via RPC.
  // Authenticated callers route through the scored RPC; anon callers use the
  // legacy filter-only RPC. The scored RPC returns relevance-desc order and
  // doesn't support offset pagination.
  const isScoredPath = !!callerId;
  const distanceMap = new Map<string, number>();
  const scoringMap = new Map<
    string,
    { player_compatibility: number; facility_affinity: number; score_history: number }
  >();
  let matchIds: string[] = [];
  let hasMore = false;

  if (isScoredPath) {
    const { data: scoredResults, error: scoredError } = await supabase.rpc(
      'get_upcoming_matches_scored',
      {
        p_caller_id: callerId!,
        p_sport_id: sportId,
        p_latitude: latitude,
        p_longitude: longitude,
        p_max_distance_km: maxDistanceKm,
        p_user_gender: userGender || null,
        p_limit: limit + 1, // pop one to detect hasMore
      }
    );

    if (scoredError) {
      throw new Error(`Failed to score nearby matches: ${scoredError.message}`);
    }

    const results = (scoredResults ?? []) as ScoredNearbyMatchResult[];
    hasMore = results.length > limit;
    if (hasMore) results.pop();

    matchIds = results.map(r => r.match_id);
    results.forEach(r => {
      distanceMap.set(r.match_id, r.distance_meters);
      scoringMap.set(r.match_id, {
        player_compatibility: r.player_compatibility,
        facility_affinity: r.facility_affinity,
        score_history: r.score_history,
      });
    });
  } else {
    const { data: nearbyResults, error: rpcError } = await supabase.rpc('search_matches_nearby', {
      p_latitude: latitude,
      p_longitude: longitude,
      p_max_distance_km: maxDistanceKm,
      p_sport_id: sportId,
      p_limit: limit + 1,
      p_offset: offset,
      p_user_gender: userGender || null,
    });

    if (rpcError) {
      throw new Error(`Failed to search nearby matches: ${rpcError.message}`);
    }

    const results = (nearbyResults ?? []) as NearbyMatchResult[];
    hasMore = results.length > limit;
    if (hasMore) results.pop();

    matchIds = results.map(r => r.match_id);
    results.forEach(r => distanceMap.set(r.match_id, r.distance_meters));
  }

  if (matchIds.length === 0) {
    return {
      matches: [],
      hasMore: false,
      nextOffset: null,
    };
  }

  const { data: matchesData, error: matchError } = await supabase
    .from('match')
    .select(
      `
      *,
      sport:sport_id (*),
      facility:facility_id (*),
      court:court_id (*),
      min_rating_score:min_rating_score_id (*),
      created_by_player:created_by (
        id,
        gender,
        playing_hand,
        max_travel_distance,
        player_reputation (reputation_score, total_events),
        notification_match_requests,
        notification_messages,
        notification_reminders,
        privacy_show_age,
        privacy_show_location,
        privacy_show_stats
      ),
      participants:match_participant (
        id,
        match_id,
        player_id,
        status,
        is_host,
        score,
        team_number,
        feedback_completed,
        checked_in_at,
        joined_at,
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score, total_events),
          notification_match_requests,
          notification_messages,
          notification_reminders,
          privacy_show_age,
          privacy_show_location,
          privacy_show_stats
        )
      ),
      result:match_result (
        id,
        winning_team,
        team1_score,
        team2_score,
        is_verified,
        disputed,
        submitted_by,
        confirmation_deadline,
        confirmed_by,
        verified_at,
        created_at,
        updated_at,
        rebuttal_team1_score,
        rebuttal_team2_score,
        rebuttal_winning_team,
        rebuttal_sets,
        rebuttal_submitted_by,
        rebuttal_submitted_at,
        rebuttal_deadline,
        sets:match_set (
          set_number,
          team1_score,
          team2_score
        ),
        confirmations:score_confirmation (
          player_id,
          action
        )
      )
    `
    )
    .in('id', matchIds);

  if (matchError) {
    throw new Error(`Failed to get match details: ${matchError.message}`);
  }

  if (!matchesData || matchesData.length === 0) {
    return {
      matches: [],
      hasMore: false,
      nextOffset: null,
    };
  }

  // Step 3: Fetch profiles for all players
  const playerIds = new Set<string>();
  matchesData.forEach((match: MatchWithDetails) => {
    if (match.created_by_player?.id) {
      playerIds.add(match.created_by_player.id);
    }
    if (match.participants) {
      match.participants.forEach((p: MatchParticipantWithPlayer) => {
        // Handle both array and object formats from Supabase
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        if (playerObj?.id) {
          playerIds.add(playerObj.id);
        }
      });
    }
  });

  const profileIds = Array.from(playerIds);
  const profilesMap: Record<string, Profile> = {};

  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profile')
      .select('*')
      .in('id', profileIds);

    if (!profilesError && profiles) {
      profiles.forEach(profile => {
        profilesMap[profile.id] = profile;
      });
    }
  }

  // Kick off the open-court snapshot read now so it overlaps the ratings query
  // and the enrichment below instead of adding a round-trip to the tail. Returns
  // full snapshot rows so both the card chip and the detail sheet's available-
  // courts tiles can read them inline; applied once the ordered list is built.
  const courtSlotsPromise = fetchAvailableCourtSlotsForMatches(matchesData);

  // Fetch player ratings for the match's sport (for displaying in request cards)
  // All matches in this result are for the same sport (params.sportId)
  const ratingsMap: Record<
    string,
    { label: string; value: number | null; badgeStatus?: BadgeStatusEnum }
  > = {}; // playerId -> rating info

  if (profileIds.length > 0 && sportId) {
    const { data: ratingsData, error: ratingsError } = await supabase
      .from('player_rating_score')
      .select(
        `
        player_id,
        badge_status,
        rating_score!player_rating_scores_rating_score_id_fkey!inner (
          label,
          value,
          rating_system!inner (
            sport_id
          )
        )
      `
      )
      .in('player_id', profileIds);

    if (!ratingsError && ratingsData) {
      type RatingResult = {
        player_id: string;
        badge_status?: BadgeStatusEnum;
        rating_score: { label: string; value: number | null; rating_system: { sport_id: string } };
      };
      (ratingsData as unknown as RatingResult[]).forEach(rating => {
        // Filter to only ratings for this match's sport
        const ratingScore = rating.rating_score;
        const ratingSystem = ratingScore?.rating_system;
        if (ratingSystem?.sport_id === sportId && ratingScore?.label) {
          ratingsMap[rating.player_id] = {
            label: ratingScore.label,
            value: ratingScore.value,
            badgeStatus: rating.badge_status,
          };
        }
      });
    }
  }

  // Step 4: Attach profiles, ratings, and distance to matches, maintain order from RPC
  const matchMap = new Map<string, MatchWithDetailsAndDistance>();
  matchesData.forEach((match: MatchWithDetails) => {
    // Attach profile and rating to creator
    if (match.created_by_player?.id && profilesMap[match.created_by_player.id]) {
      match.created_by_player.profile = profilesMap[match.created_by_player.id];
      const creatorRating = ratingsMap[match.created_by_player.id];
      if (creatorRating) {
        (match.created_by_player as PlayerWithProfile).sportRatingLabel = creatorRating.label;
        if (creatorRating.value !== null) {
          (match.created_by_player as PlayerWithProfile).sportRatingValue = creatorRating.value;
        }
        if (creatorRating.badgeStatus) {
          (match.created_by_player as PlayerWithProfile).sportCertificationStatus =
            creatorRating.badgeStatus;
        }
      }
    }

    // Attach profiles and ratings to participants
    if (match.participants) {
      match.participants = match.participants.map((p: MatchParticipantWithPlayer) => {
        // Handle both array and object formats from Supabase
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        const playerId = playerObj?.id;

        if (playerId && profilesMap[playerId]) {
          playerObj.profile = profilesMap[playerId];
        }
        const participantRating = playerId ? ratingsMap[playerId] : undefined;
        if (participantRating && playerObj) {
          (playerObj as PlayerWithProfile).sportRatingLabel = participantRating.label;
          if (participantRating.value !== null) {
            (playerObj as PlayerWithProfile).sportRatingValue = participantRating.value;
          }
          if (participantRating.badgeStatus) {
            (playerObj as PlayerWithProfile).sportCertificationStatus =
              participantRating.badgeStatus;
          }
        }
        // Ensure player is always an object, not array
        if (Array.isArray(p.player) && playerObj) {
          p.player = playerObj;
        }
        return p;
      });
    }

    // Attach distance + (if scored path) per-match scoring fields
    const scoring = scoringMap.get(match.id);
    const matchWithDistance: MatchWithDetailsAndDistance = {
      ...match,
      distance_meters: distanceMap.get(match.id) ?? null,
      player_compatibility: scoring?.player_compatibility ?? null,
      facility_affinity: scoring?.facility_affinity ?? null,
      score_history: scoring?.score_history ?? null,
    };

    matchMap.set(match.id, matchWithDistance);
  });

  // Maintain order from RPC results.
  // Scored path: order is score-desc — preserve it and skip the chronological re-sort.
  // Anon path: order is chronological — keep the existing client-side sort as a safety net.
  const orderedMatches = matchIds
    .map(id => matchMap.get(id))
    .filter(Boolean) as MatchWithDetailsAndDistance[];

  // Apply the open-court availability kicked off above so MatchCard can show a
  // "N courts available" chip for unreserved future matches.
  applyCourtSlots(orderedMatches, await courtSlotsPromise);

  if (isScoredPath) {
    return {
      matches: orderedMatches,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    };
  }

  // Anon path: chronological re-sort as a safety net (RPC already orders by
  // date+time but this handles any drift from the multi-step join).
  orderedMatches.sort((a: MatchWithDetailsAndDistance, b: MatchWithDetailsAndDistance) => {
    // Create datetime objects by combining date and time
    // Use string parsing to avoid timezone issues with Date constructor
    const createDateTime = (match: MatchWithDetailsAndDistance): number => {
      const dateStr = match.match_date; // Format: YYYY-MM-DD
      const timeStr = match.start_time; // Format: HH:MM:SS or HH:MM

      // Parse date parts
      const [year, month, day] = dateStr.split('-').map(Number);
      // Parse time parts
      const timeParts = timeStr.split(':').map(Number);
      const hours = timeParts[0] || 0;
      const minutes = timeParts[1] || 0;

      // Create date in local timezone
      const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
      return date.getTime();
    };

    const datetimeA = createDateTime(a);
    const datetimeB = createDateTime(b);

    // Sort by datetime (earlier matches first)
    return datetimeA - datetimeB;
  });

  return {
    matches: orderedMatches,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}

/**
 * Parameters for fetching player's matches
 */
export interface GetPlayerMatchesParams {
  userId: string;
  timeFilter: 'upcoming' | 'past';
  /** Optional sport ID to filter matches by */
  sportId?: string;
  /** Optional status filter for filtering matches by participant status, role, or match state */
  statusFilter?: UpcomingMatchFilter | PastMatchFilter;
  limit?: number;
  offset?: number;
}

/**
 * Get matches where the user is either the creator or a confirmed participant.
 * Supports filtering by upcoming/past and pagination.
 * Returns full match details with profiles.
 */
export async function getPlayerMatchesWithDetails(params: GetPlayerMatchesParams) {
  const { userId, timeFilter, sportId, statusFilter = 'all', limit = 20, offset = 0 } = params;

  // Use RPC function for timezone-aware filtering based on match END time
  // This ensures matches are considered "past" when their end_time has passed in the match's timezone
  // Status filter is applied server-side for proper pagination
  const { data: matchIdResults, error: rpcError } = await supabase.rpc('get_player_matches', {
    p_player_id: userId,
    p_time_filter: timeFilter,
    p_sport_id: sportId ?? null,
    p_limit: limit + 1, // Fetch one extra to check if there are more
    p_offset: offset,
    p_status_filter: statusFilter,
  });

  if (rpcError) {
    throw new Error(`Failed to get player match IDs: ${rpcError.message}`);
  }

  const matchIds = (matchIdResults ?? []).map((r: { match_id: string }) => r.match_id);

  if (matchIds.length === 0) {
    return {
      matches: [],
      hasMore: false,
      nextOffset: null,
    };
  }

  // Determine if there are more results
  const hasMore = matchIds.length > limit;
  const matchIdsToFetch = hasMore ? matchIds.slice(0, limit) : matchIds;

  // Fetch full match details for the IDs
  const isUpcoming = timeFilter === 'upcoming';

  const { data, error } = await supabase
    .from('match')
    .select(
      `
      *,
      sport:sport_id (*),
      facility:facility_id (*),
      court:court_id (*),
      min_rating_score:min_rating_score_id (*),
      created_by_player:created_by (
        id,
        gender,
        playing_hand,
        max_travel_distance,
        player_reputation (reputation_score, total_events),
        notification_match_requests,
        notification_messages,
        notification_reminders,
        privacy_show_age,
        privacy_show_location,
        privacy_show_stats
      ),
      participants:match_participant (
        id,
        match_id,
        player_id,
        status,
        is_host,
        score,
        team_number,
        feedback_completed,
        checked_in_at,
        joined_at,
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score, total_events),
          notification_match_requests,
          notification_messages,
          notification_reminders,
          privacy_show_age,
          privacy_show_location,
          privacy_show_stats
        )
      ),
      result:match_result (
        id,
        winning_team,
        team1_score,
        team2_score,
        is_verified,
        disputed,
        submitted_by,
        confirmation_deadline,
        confirmed_by,
        verified_at,
        created_at,
        updated_at,
        rebuttal_team1_score,
        rebuttal_team2_score,
        rebuttal_winning_team,
        rebuttal_sets,
        rebuttal_submitted_by,
        rebuttal_submitted_at,
        rebuttal_deadline,
        sets:match_set (
          set_number,
          team1_score,
          team2_score
        ),
        confirmations:score_confirmation (
          player_id,
          action
        )
      )
    `
    )
    .in('id', matchIdsToFetch)
    .order('match_date', { ascending: isUpcoming })
    .order('start_time', { ascending: isUpcoming });

  if (error) {
    throw new Error(`Failed to get player matches: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return {
      matches: [],
      hasMore: false,
      nextOffset: null,
    };
  }

  const matchesData = data;

  // Fetch profiles for all players (creator + participants)
  const playerIds = new Set<string>();
  matchesData.forEach((match: MatchWithDetails) => {
    if (match.created_by_player?.id) {
      playerIds.add(match.created_by_player.id);
    }
    if (match.participants) {
      match.participants.forEach((p: MatchParticipantWithPlayer) => {
        // Handle both array and object formats from Supabase
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        if (playerObj?.id) {
          playerIds.add(playerObj.id);
        }
      });
    }
  });

  // Fetch all profiles at once
  const profileIds = Array.from(playerIds);
  const profilesMap: Record<string, Profile> = {};

  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profile')
      .select('*')
      .in('id', profileIds);

    if (!profilesError && profiles) {
      profiles.forEach(profile => {
        profilesMap[profile.id] = profile;
      });
    }
  }

  // Fetch player ratings for each match's sport (for displaying in request cards)
  // Build a map of sportId -> playerId -> rating info
  const sportRatingsMap: Record<
    string,
    Record<string, { label: string; value: number | null; badgeStatus?: BadgeStatusEnum }>
  > = {};

  if (profileIds.length > 0) {
    // Get unique sport IDs from matches
    const sportIds = [
      ...new Set(matchesData.map((m: MatchWithDetails) => m.sport_id).filter(Boolean)),
    ];

    if (sportIds.length > 0) {
      const { data: ratingsData, error: ratingsError } = await supabase
        .from('player_rating_score')
        .select(
          `
        player_id,
        badge_status,
        rating_score!player_rating_scores_rating_score_id_fkey!inner (
          label,
          value,
          rating_system!inner (
            sport_id
          )
        )
      `
        )
        .in('player_id', profileIds);

      if (ratingsError) {
        Logger.error('[getPlayerMatchesWithDetails] Error fetching ratings:', ratingsError);
      }

      if (!ratingsError && ratingsData) {
        type RatingResult = {
          player_id: string;
          badge_status?: BadgeStatusEnum;
          rating_score: {
            label: string;
            value: number | null;
            rating_system: { sport_id: string };
          };
        };
        (ratingsData as unknown as RatingResult[]).forEach(rating => {
          const ratingScore = rating.rating_score;
          const ratingSystem = ratingScore?.rating_system;
          if (ratingSystem?.sport_id && ratingScore?.label) {
            if (!sportRatingsMap[ratingSystem.sport_id]) {
              sportRatingsMap[ratingSystem.sport_id] = {};
            }
            sportRatingsMap[ratingSystem.sport_id][rating.player_id] = {
              label: ratingScore.label,
              value: ratingScore.value,
              badgeStatus: rating.badge_status,
            };
          }
        });
      }
    }
  }

  // Attach profiles and ratings to players
  const enrichedData = matchesData.map((match: MatchWithDetails) => {
    const matchSportRatings = sportRatingsMap[match.sport_id] || {};

    // Attach profile and rating to creator
    if (match.created_by_player?.id && profilesMap[match.created_by_player.id]) {
      match.created_by_player.profile = profilesMap[match.created_by_player.id];
      const creatorRating = matchSportRatings[match.created_by_player.id];
      if (creatorRating) {
        (match.created_by_player as PlayerWithProfile).sportRatingLabel = creatorRating.label;
        if (creatorRating.value !== null) {
          (match.created_by_player as PlayerWithProfile).sportRatingValue = creatorRating.value;
        }
        if (creatorRating.badgeStatus) {
          (match.created_by_player as PlayerWithProfile).sportCertificationStatus =
            creatorRating.badgeStatus;
        }
      }
    }

    // Attach profiles and ratings to participants
    if (match.participants) {
      match.participants = match.participants.map((p: MatchParticipantWithPlayer) => {
        // Handle both array and object formats from Supabase
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        const playerId = playerObj?.id;

        if (playerId && profilesMap[playerId]) {
          playerObj.profile = profilesMap[playerId];
        }
        const participantRating = playerId ? matchSportRatings[playerId] : undefined;
        if (participantRating && playerObj) {
          (playerObj as PlayerWithProfile).sportRatingLabel = participantRating.label;
          if (participantRating.value !== null) {
            (playerObj as PlayerWithProfile).sportRatingValue = participantRating.value;
          }
          if (participantRating.badgeStatus) {
            (playerObj as PlayerWithProfile).sportCertificationStatus =
              participantRating.badgeStatus;
          }
        }
        // Ensure player is always an object, not array
        if (Array.isArray(p.player) && playerObj) {
          p.player = playerObj;
        }
        return p;
      });
    }

    return match;
  });

  // Attach open-court availability so MatchCard can show a "N courts available" chip
  // for unreserved future matches (parity with suggestion cards). Past matches
  // in this list are naturally skipped (future-only inside the helper).
  await attachAvailableCourtSlots(enrichedData);

  return {
    matches: enrichedData as MatchWithDetails[],
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}

export interface GetPlayerMatchHistoryParams {
  /** The player whose game history to fetch (the profile being viewed). */
  playerId: string;
  /** Optional sport filter (matches the viewed profile's selected sport). */
  sportId?: string;
  /** Page size. */
  limit?: number;
  /** Page offset. */
  offset?: number;
}

/**
 * Fetch a player's past games that have a verified, non-disputed score, for the
 * profile game-history section. Backed by the `get_player_match_history` RPC
 * (SECURITY DEFINER) so it returns the player's results even from matches the
 * viewer isn't part of. Each row is fully hydrated (both teams + per-set scores),
 * so a row can be opened in PlayedMatchDetail without a second round-trip.
 */
export async function getPlayerMatchHistory(params: GetPlayerMatchHistoryParams): Promise<{
  matches: PlayerMatchHistoryItem[];
  hasMore: boolean;
  nextOffset: number | null;
}> {
  const { playerId, sportId, limit = 10, offset = 0 } = params;

  const { data, error } = await supabase.rpc('get_player_match_history', {
    p_player_id: playerId,
    p_sport_id: sportId ?? null,
    p_limit: limit + 1, // Fetch one extra to detect hasMore
    p_offset: offset,
  });

  if (error) {
    throw new Error(`Failed to get player match history: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as PlayerMatchHistoryItem[];
  // jsonb columns can arrive null; the RPC COALESCEs to '[]' but normalize defensively.
  const normalized = rows.map(r => ({
    ...r,
    participants: r.participants ?? [],
    sets: r.sets ?? [],
  }));

  const hasMore = normalized.length > limit;
  return {
    matches: hasMore ? normalized.slice(0, limit) : normalized,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}

/**
 * Parameters for searching public matches with filters
 */
export interface SearchPublicMatchesParams {
  latitude: number;
  longitude: number;
  /** Maximum distance in km, or 'all'/null for no distance filter (shows all location types) */
  maxDistanceKm: number | 'all' | null;
  sportId: string;
  searchQuery?: string;
  format?: FormatFilter;
  matchType?: MatchTypeFilter;
  dateRange?: DateRangeFilter;
  timeOfDay?: TimeOfDayFilter;
  skillLevel?: SkillLevelFilter;
  gender?: GenderFilter;
  cost?: CostFilter;
  joinMode?: JoinModeFilter;
  /** Duration filter (in minutes), '120+' includes 120 and custom */
  duration?: DurationFilter;
  /** Court status filter */
  courtStatus?: CourtStatusFilter;
  /** Match tier filter */
  matchTier?: MatchTierFilter;
  /** Specific date filter (ISO date string YYYY-MM-DD), overrides dateRange when set */
  specificDate?: string | null;
  /** Spots available filter */
  spotsAvailable?: SpotsAvailableFilter;
  /** Specific time filter (HH:MM format), overrides timeOfDay when set */
  specificTime?: SpecificTimeFilter;
  /** Reputation tier filter for match host */
  reputation?: ReputationFilter;
  /** Rating score IDs filter — matches whose min_rating_score_id is in this array */
  ratingScoreIds?: string[];
  /** The viewing user's gender for eligibility filtering */
  userGender?: string | null;
  /** Filter by specific facility ID - when set, only returns matches at that facility */
  facilityId?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * Result from public matches RPC
 */
interface PublicMatchResult {
  match_id: string;
  distance_meters: number;
}

/**
 * Get public matches with search and filters.
 * Uses PostGIS RPC function for efficient distance filtering and text search.
 * When maxDistanceKm is 'all' or null, returns matches of all location types.
 * When maxDistanceKm is a number, only returns facility and custom location matches within that distance.
 * Returns full match details with distance_meters attached.
 */
export async function getPublicMatches(params: SearchPublicMatchesParams) {
  const {
    latitude,
    longitude,
    maxDistanceKm,
    sportId,
    searchQuery,
    format = 'all',
    matchType = 'all',
    dateRange = 'all',
    timeOfDay = 'all',
    skillLevel = 'all',
    gender = 'all',
    cost = 'all',
    joinMode = 'all',
    duration = 'all',
    courtStatus = 'all',
    matchTier = 'all',
    specificDate,
    spotsAvailable = 'all',
    specificTime,
    reputation = 'all',
    ratingScoreIds,
    userGender,
    facilityId,
    limit = 20,
    offset = 0,
  } = params;

  // Convert 'all' to null for the RPC (null means no distance filter)
  const distanceForRpc = maxDistanceKm === 'all' || maxDistanceKm === null ? null : maxDistanceKm;

  // Common RPC params (shared between search and count)
  const rpcFilterParams = {
    p_latitude: latitude,
    p_longitude: longitude,
    p_max_distance_km: distanceForRpc,
    p_sport_id: sportId,
    p_search_query: searchQuery || null,
    p_format: format === 'all' ? null : format,
    p_match_type: matchType === 'all' ? null : matchType,
    p_date_range: dateRange === 'all' ? null : dateRange,
    p_time_of_day: timeOfDay === 'all' ? null : timeOfDay,
    p_skill_level: skillLevel === 'all' ? null : skillLevel,
    p_gender: gender === 'all' ? null : gender,
    p_cost: cost === 'all' ? null : cost,
    p_join_mode: joinMode === 'all' ? null : joinMode,
    p_duration: duration === 'all' ? null : duration,
    p_court_status: courtStatus === 'all' ? null : courtStatus,
    p_specific_date: specificDate || null,
    p_user_gender: userGender || null,
    p_facility_id: facilityId || null,
    p_match_tier: matchTier === 'all' ? null : matchTier,
    p_spots_available: spotsAvailable === 'all' ? null : spotsAvailable,
    p_specific_time: specificTime || null,
    p_reputation_tier: reputation === 'all' ? null : reputation,
    p_rating_score_ids: ratingScoreIds?.length ? ratingScoreIds : null,
  };

  // Step 1: Get match IDs using RPC with filters + count on first page
  const [searchResult, countResult] = await Promise.all([
    supabase.rpc('search_public_matches', {
      ...rpcFilterParams,
      p_limit: limit + 1, // Fetch one extra to check if more exist
      p_offset: offset,
    }),
    // Only fetch count on first page to avoid unnecessary queries
    offset === 0
      ? supabase.rpc('search_public_matches_count', rpcFilterParams)
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (searchResult.error) {
    throw new Error(`Failed to search public matches: ${searchResult.error.message}`);
  }

  const { data: matchResults } = searchResult;

  const results = (matchResults ?? []) as PublicMatchResult[];
  const hasMore = results.length > limit;

  // Remove the extra item used for pagination check
  if (hasMore) {
    results.pop();
  }

  if (results.length === 0) {
    return {
      matches: [],
      hasMore: false,
      nextOffset: null,
      totalCount: countResult.data ?? undefined,
    };
  }

  // Step 2-4: hydrate the found IDs into full MatchWithDetails (shared helper,
  // also used by the weekly check-in "Games for you" step).
  const matchIds = results.map(r => r.match_id);
  const distanceMap = new Map<string, number | null>(
    results.map(r => [r.match_id, r.distance_meters])
  );
  const orderedMatches = await hydrateMatchDetailsByIds(matchIds, distanceMap, sportId);

  if (orderedMatches.length === 0) {
    return { matches: [], hasMore: false, nextOffset: null };
  }

  return {
    matches: orderedMatches,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
    totalCount: countResult.data ?? undefined,
  };
}

/**
 * Hydrate match IDs (in the given order) into full MatchWithDetails, attaching
 * creator/participant profiles, per-sport ratings (when `sportId` is provided),
 * open-court availability, and distance. Input order is preserved.
 *
 * Shared by getPublicMatches and getCheckInMatchOpportunities. When `sportId` is
 * omitted (e.g. results spanning multiple sports) the per-sport ratings
 * enrichment is skipped.
 */
async function hydrateMatchDetailsByIds(
  matchIds: string[],
  distanceMap: Map<string, number | null>,
  sportId?: string | null
): Promise<MatchWithDetailsAndDistance[]> {
  if (matchIds.length === 0) return [];

  const { data: matchesData, error: matchError } = await supabase
    .from('match')
    .select(
      `
      *,
      sport:sport_id (*),
      facility:facility_id (*),
      court:court_id (*),
      min_rating_score:min_rating_score_id (*),
      created_by_player:created_by (
        id,
        gender,
        playing_hand,
        max_travel_distance,
        player_reputation (reputation_score, total_events),
        notification_match_requests,
        notification_messages,
        notification_reminders,
        privacy_show_age,
        privacy_show_location,
        privacy_show_stats
      ),
      participants:match_participant (
        id,
        match_id,
        player_id,
        status,
        is_host,
        score,
        team_number,
        feedback_completed,
        checked_in_at,
        joined_at,
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score, total_events),
          notification_match_requests,
          notification_messages,
          notification_reminders,
          privacy_show_age,
          privacy_show_location,
          privacy_show_stats
        )
      ),
      result:match_result (
        id,
        winning_team,
        team1_score,
        team2_score,
        is_verified,
        disputed,
        submitted_by,
        confirmation_deadline,
        confirmed_by,
        verified_at,
        created_at,
        updated_at,
        rebuttal_team1_score,
        rebuttal_team2_score,
        rebuttal_winning_team,
        rebuttal_sets,
        rebuttal_submitted_by,
        rebuttal_submitted_at,
        rebuttal_deadline,
        sets:match_set (
          set_number,
          team1_score,
          team2_score
        ),
        confirmations:score_confirmation (
          player_id,
          action
        )
      )
    `
    )
    .in('id', matchIds);

  if (matchError) {
    throw new Error(`Failed to get match details: ${matchError.message}`);
  }

  if (!matchesData || matchesData.length === 0) {
    return [];
  }

  // Step 3: Fetch profiles for all players
  const playerIds = new Set<string>();
  matchesData.forEach((match: MatchWithDetails) => {
    if (match.created_by_player?.id) {
      playerIds.add(match.created_by_player.id);
    }
    if (match.participants) {
      match.participants.forEach((p: MatchParticipantWithPlayer) => {
        // Handle both array and object formats from Supabase
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        if (playerObj?.id) {
          playerIds.add(playerObj.id);
        }
      });
    }
  });

  const profileIds = Array.from(playerIds);
  const profilesMap: Record<string, Profile> = {};

  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profile')
      .select('*')
      .in('id', profileIds);

    if (!profilesError && profiles) {
      profiles.forEach(profile => {
        profilesMap[profile.id] = profile;
      });
    }
  }

  // Kick off the open-court snapshot read now so it overlaps the ratings query
  // and the enrichment below instead of adding a round-trip to the tail. Returns
  // full snapshot rows so both the card chip and the detail sheet's available-
  // courts tiles can read them inline; applied once the ordered list is built.
  const courtSlotsPromise = fetchAvailableCourtSlotsForMatches(matchesData);

  // Fetch player ratings for the match's sport (for displaying in request cards)
  // All matches in this result are for the same sport (params.sportId)
  const publicRatingsMap: Record<
    string,
    { label: string; value: number | null; badgeStatus?: BadgeStatusEnum }
  > = {}; // playerId -> rating info

  if (profileIds.length > 0 && sportId) {
    const { data: ratingsData, error: ratingsError } = await supabase
      .from('player_rating_score')
      .select(
        `
        player_id,
        badge_status,
        rating_score!player_rating_scores_rating_score_id_fkey!inner (
          label,
          value,
          rating_system!inner (
            sport_id
          )
        )
      `
      )
      .in('player_id', profileIds);

    if (!ratingsError && ratingsData) {
      type RatingResult = {
        player_id: string;
        badge_status?: BadgeStatusEnum;
        rating_score: { label: string; value: number | null; rating_system: { sport_id: string } };
      };
      (ratingsData as unknown as RatingResult[]).forEach(rating => {
        // Filter to only ratings for this match's sport
        const ratingScore = rating.rating_score;
        const ratingSystem = ratingScore?.rating_system;
        if (ratingSystem?.sport_id === sportId && ratingScore?.label) {
          const existing = publicRatingsMap[rating.player_id];
          // Preserve 'certified' badge status — a player with any certified rating
          // for this sport should keep that status (matches SQL EXISTS logic)
          const badgeStatus =
            existing?.badgeStatus === 'certified' ? 'certified' : rating.badge_status;
          publicRatingsMap[rating.player_id] = {
            label: ratingScore.label,
            value: ratingScore.value,
            badgeStatus,
          };
        }
      });
    }
  }

  // Step 4: Attach profiles, ratings, and distance to matches, maintain order from RPC
  const matchMap = new Map<string, MatchWithDetailsAndDistance>();
  matchesData.forEach((match: MatchWithDetails) => {
    // Attach profile and rating to creator
    if (match.created_by_player?.id && profilesMap[match.created_by_player.id]) {
      match.created_by_player.profile = profilesMap[match.created_by_player.id];
      const creatorRating = publicRatingsMap[match.created_by_player.id];
      if (creatorRating) {
        (match.created_by_player as PlayerWithProfile).sportRatingLabel = creatorRating.label;
        if (creatorRating.value !== null) {
          (match.created_by_player as PlayerWithProfile).sportRatingValue = creatorRating.value;
        }
        if (creatorRating.badgeStatus) {
          (match.created_by_player as PlayerWithProfile).sportCertificationStatus =
            creatorRating.badgeStatus;
        }
      }
    }

    // Attach profiles and ratings to participants
    if (match.participants) {
      match.participants = match.participants.map((p: MatchParticipantWithPlayer) => {
        // Handle both array and object formats from Supabase
        const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
        const playerId = playerObj?.id;

        if (playerId && profilesMap[playerId]) {
          playerObj.profile = profilesMap[playerId];
        }
        const participantRating = playerId ? publicRatingsMap[playerId] : undefined;
        if (participantRating && playerObj) {
          (playerObj as PlayerWithProfile).sportRatingLabel = participantRating.label;
          if (participantRating.value !== null) {
            (playerObj as PlayerWithProfile).sportRatingValue = participantRating.value;
          }
          if (participantRating.badgeStatus) {
            (playerObj as PlayerWithProfile).sportCertificationStatus =
              participantRating.badgeStatus;
          }
        }
        // Ensure player is always an object, not array
        if (Array.isArray(p.player) && playerObj) {
          p.player = playerObj;
        }
        return p;
      });
    }

    // Attach distance
    const matchWithDistance: MatchWithDetailsAndDistance = {
      ...match,
      distance_meters: distanceMap.get(match.id) ?? null,
    };

    matchMap.set(match.id, matchWithDistance);
  });

  // Maintain caller's order (the originating query already sorted the IDs).
  const orderedMatches = matchIds
    .map(id => matchMap.get(id))
    .filter(Boolean) as MatchWithDetailsAndDistance[];

  // Apply the open-court availability kicked off above so MatchCard can show a
  // "N courts available" chip for unreserved future matches.
  applyCourtSlots(orderedMatches, await courtSlotsPromise);

  return orderedMatches;
}

/**
 * Weekly check-in "Games for you": existing PUBLIC matches with open spots that
 * fit the availability the player just declared in the wizard. Delegates all
 * filtering (favorite/distance, exact rating, declared day+hour slot, gender,
 * open spot, today…today+3 window) to get_checkin_match_opportunities,
 * then hydrates the matching IDs into MatchWithDetails for MatchCard.
 *
 * `slots` are the in-memory (not-yet-persisted) availability cells: one entry per
 * selected (weekday, hour). `sportId` scopes results to the wizard's sport mode;
 * null falls back to all the player's active sports. Returns soonest-first in
 * the RPC's order.
 */
export async function getCheckInMatchOpportunities(params: {
  slots: { day: DayEnum; hour: number }[];
  sportId?: string | null;
  timezone?: string | null;
  limit?: number;
}): Promise<MatchWithDetailsAndDistance[]> {
  const { slots, sportId, timezone, limit = 20 } = params;
  if (!slots || slots.length === 0) return [];

  const { data, error } = await supabase.rpc('get_checkin_match_opportunities', {
    p_slots: slots as unknown as Json,
    p_timezone: timezone ?? null,
    p_limit: limit,
    p_sport_id: sportId ?? null,
  });

  if (error) {
    throw new Error(`Failed to fetch check-in match opportunities: ${error.message}`);
  }

  const results = (data ?? []) as PublicMatchResult[];
  if (results.length === 0) return [];

  const matchIds = results.map(r => r.match_id);
  const distanceMap = new Map<string, number | null>(
    results.map(r => [r.match_id, r.distance_meters])
  );
  // With a sport scope every result is that sport, so the per-sport ratings
  // enrichment applies; agnostic calls skip it (the rating badge still renders
  // from the match's own min_rating_score).
  return hydrateMatchDetailsByIds(matchIds, distanceMap, sportId);
}

/** A candidate the check-in plan would auto-invite to one proposed game. */
export interface PlanInvitee {
  playerId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  ratingLabel: string | null;
  /** Withheld (null) unless the candidate's reputation is public with enough events. */
  reputationScore: number | null;
  reputationTier: string | null;
}

/** One game the check-in plan proposes to create, with its invite preview. */
export interface PlanProposal {
  /** Stable identity for selection state: `${sportId}:${matchDate}`. */
  key: string;
  sportId: string;
  sportName: string;
  matchDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM:SS
  endTime: string;
  startHour: number;
  duration: string;
  /** Match type the game gets created with: 'competitive' | 'casual' | 'both'. */
  matchType: string;
  locationType: 'facility' | 'tbd';
  facilityId: string | null;
  facilityName: string | null;
  facilityAddress: string | null;
  minRatingLabel: string | null;
  /** Live open-court count for the chosen facility/slot; 0 for TBD proposals. */
  availableCourts: number;
  /** Players who pass the auto-invite compatibility gates for this slot. */
  compatibleCount: number;
  invitees: PlanInvitee[];
}

export interface CheckInMatchPlan {
  goal: number;
  committedCount: number;
  optedOut: boolean;
  autoInviteEnabled: boolean;
  proposals: PlanProposal[];
}

interface RawPlanInvitee {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  rating_label: string | null;
  reputation_score: number | null;
  reputation_tier: string | null;
}

interface RawPlanProposal {
  key: string;
  sport_id: string;
  sport_name: string;
  match_date: string;
  start_time: string;
  end_time: string;
  start_hour: number;
  duration: string;
  match_type: string | null;
  location_type: 'facility' | 'tbd';
  facility_id: string | null;
  facility_name: string | null;
  facility_address: string | null;
  min_rating_label: string | null;
  available_courts: number | null;
  compatible_count: number | null;
  invitees: RawPlanInvitee[];
}

/**
 * Weekly check-in plan PREVIEW: the games the auto-generator would create from
 * the availability the player just declared in the wizard (not yet persisted)
 * and their chosen goal, each with the named opponents that would be invited.
 * `sportId` scopes proposals to the wizard's sport mode; null falls back to all
 * the player's active sports. The player confirms/edits this and the selection
 * goes back through recordWeeklyCheckin's p_match_plan. Plain objects/arrays
 * only (react-query structural sharing).
 */
export async function getCheckInMatchPlan(params: {
  slots: { day: DayEnum; hour: number }[];
  frequencyGoal: number;
  sportId?: string | null;
  timezone?: string | null;
}): Promise<CheckInMatchPlan> {
  const { slots, frequencyGoal, sportId, timezone } = params;

  const { data, error } = await supabase.rpc('get_checkin_match_plan', {
    p_slots: (slots ?? []) as unknown as Json,
    p_frequency_goal: frequencyGoal,
    p_timezone: timezone ?? null,
    p_sport_id: sportId ?? null,
  });

  if (error) {
    throw new Error(`Failed to fetch check-in match plan: ${error.message}`);
  }

  const raw = (data ?? {}) as {
    goal?: number;
    committed_count?: number;
    opted_out?: boolean;
    auto_invite_enabled?: boolean;
    proposals?: RawPlanProposal[];
  };

  return {
    goal: raw.goal ?? frequencyGoal,
    committedCount: raw.committed_count ?? 0,
    optedOut: raw.opted_out ?? false,
    autoInviteEnabled: raw.auto_invite_enabled ?? true,
    proposals: (raw.proposals ?? []).map(p => ({
      key: p.key,
      sportId: p.sport_id,
      sportName: p.sport_name,
      matchDate: p.match_date,
      startTime: p.start_time,
      endTime: p.end_time,
      startHour: p.start_hour,
      duration: p.duration,
      matchType: p.match_type ?? 'both',
      locationType: p.location_type,
      facilityId: p.facility_id,
      facilityName: p.facility_name,
      facilityAddress: p.facility_address,
      minRatingLabel: p.min_rating_label,
      availableCourts: p.available_courts ?? 0,
      compatibleCount: p.compatible_count ?? 0,
      invitees: (p.invitees ?? []).map(i => ({
        playerId: i.player_id,
        firstName: i.first_name ?? '',
        lastName: i.last_name ?? '',
        avatarUrl: i.avatar_url,
        ratingLabel: i.rating_label,
        reputationScore: i.reputation_score,
        reputationTier: i.reputation_tier,
      })),
    })),
  };
}

// =============================================================================
// PLAYER INVITATION
// =============================================================================

/**
 * Result of inviting players to a match
 */
export interface InvitePlayersResult {
  /** Successfully created participant records */
  invited: MatchParticipant[];
  /** Player IDs that were already in the match (skipped) */
  alreadyInMatch: string[];
  /** Player IDs that failed to invite */
  failed: string[];
}

/**
 * Invite multiple players to a match.
 * Creates match_participant records with 'pending' status and sends notifications.
 *
 * @param matchId - The match ID to invite players to
 * @param playerIds - Array of player IDs to invite
 * @param hostId - The ID of the user inviting (must be match host)
 * @returns Result with invited, already in match, and failed player IDs
 * @throws Error if match not found, cancelled, or caller is not the host
 */
export async function invitePlayersToMatch(
  matchId: string,
  playerIds: string[],
  hostId: string
): Promise<InvitePlayersResult> {
  if (playerIds.length === 0) {
    return { invited: [], alreadyInMatch: [], failed: [] };
  }

  // Verify match exists, is not cancelled, and caller is host
  const { data: match, error: matchError } = await supabase
    .from('match')
    .select(
      `
      id,
      created_by,
      cancelled_at,
      match_date,
      start_time,
      end_time,
      timezone,
      location_name,
      facility:facility_id (
        name
      ),
      sport:sport_id (
        id,
        name,
        display_name
      ),
      participants:match_participant (
        id,
        player_id,
        status
      )
    `
    )
    .eq('id', matchId)
    .single();

  if (matchError || !match) {
    throw new Error('Match not found');
  }

  if (match.cancelled_at) {
    throw new Error('Cannot invite players to a cancelled match');
  }

  // Check if match has already ended
  const { getMatchEndTimeDifferenceFromNow } = await import('@rallia/shared-utils');
  const endTimeDiff = getMatchEndTimeDifferenceFromNow(
    match.match_date,
    match.start_time,
    match.end_time,
    match.timezone || 'UTC'
  );
  if (endTimeDiff < 0) {
    throw new Error('Cannot invite players to a completed match');
  }

  // Verify caller is the host
  if (match.created_by !== hostId) {
    throw new Error('Only the match host can invite players');
  }

  // Get host's name for notifications
  const { data: hostProfile } = await supabase
    .from('profile')
    .select('first_name, last_name, display_name')
    .eq('id', hostId)
    .single();

  const inviterName =
    hostProfile?.first_name && hostProfile?.last_name
      ? `${hostProfile.first_name} ${hostProfile.last_name}`
      : hostProfile?.first_name || 'A player';
  // Supabase returns relations as arrays when using select, handle both array and single object
  const sportData = match.sport;
  const sport = Array.isArray(sportData) ? sportData[0] : sportData;
  const sportName = sport?.display_name || sport?.name || 'a match';

  // Derive location name from facility or custom location
  const facilityData = match.facility as { name?: string } | { name?: string }[] | null;
  const facilityObj = Array.isArray(facilityData) ? facilityData[0] : facilityData;
  const locationName =
    facilityObj?.name || (match as { location_name?: string | null }).location_name || undefined;

  // Build a map of existing participants with their status
  const existingParticipants = new Map<string, { id: string; status: string }>();
  for (const p of match.participants ?? []) {
    existingParticipants.set(p.player_id, { id: p.id, status: p.status ?? '' });
  }

  // Statuses that cannot be re-invited (active participation states)
  const activeStatuses = ['pending', 'requested', 'joined', 'waitlisted', 'kicked'];
  // Statuses that CAN be re-invited (player declined, left, etc.)
  const reinvitableStatuses = ['declined', 'left', 'refused', 'cancelled'];

  const alreadyInMatch: string[] = [];
  const toReinvite: Array<{ participantId: string; playerId: string }> = [];
  const toInvite: string[] = [];

  for (const playerId of playerIds) {
    const existing = existingParticipants.get(playerId);
    if (existing) {
      if (activeStatuses.includes(existing.status)) {
        // Player has an active status - cannot re-invite
        alreadyInMatch.push(playerId);
      } else if (reinvitableStatuses.includes(existing.status)) {
        // Player has a re-invitable status - update their record
        toReinvite.push({ participantId: existing.id, playerId });
      } else {
        // Unknown status - treat as already in match for safety
        alreadyInMatch.push(playerId);
      }
    } else {
      // No existing record - create new invitation
      toInvite.push(playerId);
    }
  }

  if (toInvite.length === 0 && toReinvite.length === 0) {
    return { invited: [], alreadyInMatch, failed: [] };
  }

  const invited: MatchParticipant[] = [];
  const failed: string[] = [];

  // Update existing records for re-invitable players
  for (const { participantId, playerId } of toReinvite) {
    const { data: updatedParticipant, error: updateError } = await supabase
      .from('match_participant')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', participantId)
      .select()
      .single();

    if (updateError) {
      Logger.error('[invitePlayersToMatch] Update error for re-invite:', updateError);
      failed.push(playerId);
    } else if (updatedParticipant) {
      invited.push(updatedParticipant as MatchParticipant);
    }
  }

  // Create new participant records for players without existing records
  if (toInvite.length > 0) {
    const participantsToInsert = toInvite.map(playerId => ({
      match_id: matchId,
      player_id: playerId,
      status: 'pending' as const,
      is_host: false,
    }));

    const { data: insertedParticipants, error: insertError } = await supabase
      .from('match_participant')
      .insert(participantsToInsert)
      .select();

    if (insertError) {
      Logger.error('[invitePlayersToMatch] Insert error:', insertError);
      // Add all toInvite players to failed
      failed.push(...toInvite);
    } else {
      const insertedList = (insertedParticipants ?? []) as MatchParticipant[];
      invited.push(...insertedList);
      // Check if any inserts failed
      const insertedPlayerIds = new Set(insertedList.map(p => p.player_id));
      for (const playerId of toInvite) {
        if (!insertedPlayerIds.has(playerId)) {
          failed.push(playerId);
        }
      }
    }
  }

  // Send notifications to all invited players (fire and forget)
  // Extract time in HH:MM format for notification
  const startTime = match.start_time ? match.start_time.slice(0, 5) : undefined;

  for (const participant of invited) {
    notifyMatchInvitation(
      participant.player_id,
      matchId,
      inviterName,
      sportName,
      match.match_date,
      startTime,
      locationName
    ).catch(err => {
      Logger.error('[invitePlayersToMatch] Notification error:', err);
    });
  }

  return { invited, alreadyInMatch, failed };
}

/**
 * Check-in radius in meters
 */
const CHECK_IN_RADIUS_METERS = 500;

/**
 * Result of a check-in attempt
 */
export interface CheckInResult {
  success: boolean;
  error?: 'too_far' | 'no_location' | 'not_participant' | 'already_checked_in' | 'unknown';
  distanceMeters?: number;
}

/**
 * Check in a player to a match by verifying their location is within
 * the specified radius of the match location.
 *
 * @param matchId - The match ID
 * @param playerId - The player's ID
 * @param playerLat - The player's current latitude
 * @param playerLng - The player's current longitude
 * @returns CheckInResult indicating success or failure with reason
 */
export async function checkInToMatch(
  matchId: string,
  _playerId: string,
  playerLat?: number,
  playerLng?: number
): Promise<CheckInResult> {
  // The radius used to be computed here and written straight to the row, which
  // RLS lets a player do on their own participation: the field the resolution
  // ladder trusts for a walkover and a reputation hit was settable from
  // anywhere. It is enforced server-side now. A game with no
  // coordinates is accepted rather than refused, but records as unverified,
  // which the no-show rung does not treat as evidence of presence.
  try {
    const { data, error } = await supabase.rpc('check_in_to_match', {
      p_match_id: matchId,
      p_latitude: playerLat ?? undefined,
      p_longitude: playerLng ?? undefined,
    });
    if (error) {
      Logger.error('[checkInToMatch] Check-in failed:', error);
      return { success: false, error: 'unknown' };
    }
    const row = (data ?? {}) as Record<string, unknown>;
    if (row.success === true) {
      return {
        success: true,
        distanceMeters: typeof row.distanceMeters === 'number' ? row.distanceMeters : undefined,
      };
    }
    return {
      success: false,
      error: (row.error as CheckInResult['error']) ?? 'unknown',
      distanceMeters: typeof row.distanceMeters === 'number' ? row.distanceMeters : undefined,
    };
  } catch (err) {
    Logger.error('[checkInToMatch] Unexpected error:', err instanceof Error ? err : undefined);
    return { success: false, error: 'unknown' };
  }
}

/**
 * Result type for getMatchNeedingFeedback
 */
export interface PendingFeedbackMatch {
  match: MatchWithDetails;
  /** The user's participant record for this match */
  userParticipant: MatchParticipantWithPlayer;
}

/**
 * Get the most recently ended match that requires feedback from the user.
 *
 * Returns a match if:
 * 1. User is a joined participant with feedback_completed = false
 * 2. Match ended within the last 48 hours (feedback window)
 * 3. Match was full (all spots filled: 4 for doubles, 2 for singles)
 *
 * @param userId - The user's player ID
 * @returns The most recently ended match needing feedback, or null if none
 */
const GET_MATCH_NEEDING_FEEDBACK_RPC_PARAMS = {
  p_player_id: '' as string,
  p_time_filter: 'past' as const,
  p_sport_id: null as null,
  // 'feedback_needed' applies the joined / not-completed / full / 48h filter server-side.
  p_status_filter: 'feedback_needed' as const,
  p_limit: 10,
  p_offset: 0,
};

async function callGetPlayerMatchesForFeedback(userId: string) {
  return supabase.rpc('get_player_matches', {
    ...GET_MATCH_NEEDING_FEEDBACK_RPC_PARAMS,
    p_player_id: userId,
  });
}

export async function getMatchNeedingFeedback(
  userId: string
): Promise<PendingFeedbackMatch | null> {
  // Fetch past matches where user is a joined participant with feedback_completed = false
  let { data: matchIdResults, error: rpcError } = await callGetPlayerMatchesForFeedback(userId);

  // Retry once on upstream/invalid response (common after db reset or transient PostgREST issues)
  if (rpcError?.message?.includes('upstream') || rpcError?.message?.includes('invalid response')) {
    Logger.warn('[getMatchNeedingFeedback] RPC upstream error, retrying once', {
      message: rpcError.message,
    });
    const retry = await callGetPlayerMatchesForFeedback(userId);
    rpcError = retry.error;
    matchIdResults = retry.data;
  }

  if (rpcError) {
    Logger.error('[getMatchNeedingFeedback] RPC error', new Error(rpcError.message), {
      details: rpcError.details,
    });
    return null;
  }

  const matchIds = (matchIdResults ?? []).map((r: { match_id: string }) => r.match_id);

  if (matchIds.length === 0) {
    return null;
  }

  // Fetch full match details for the IDs
  const { data, error } = await supabase
    .from('match')
    .select(
      `
      *,
      sport:sport_id (*),
      facility:facility_id (*),
      court:court_id (*),
      min_rating_score:min_rating_score_id (*),
      created_by_player:created_by (
        id,
        gender,
        playing_hand,
        max_travel_distance,
        player_reputation (reputation_score, total_events),
        notification_match_requests,
        notification_messages,
        notification_reminders,
        privacy_show_age,
        privacy_show_location,
        privacy_show_stats
      ),
      participants:match_participant (
        id,
        match_id,
        player_id,
        status,
        is_host,
        score,
        team_number,
        feedback_completed,
        match_outcome,
        checked_in_at,
        joined_at,
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score, total_events),
          notification_match_requests,
          notification_messages,
          notification_reminders,
          privacy_show_age,
          privacy_show_location,
          privacy_show_stats
        )
      )
    `
    )
    .in('id', matchIds)
    .is('cancelled_at', null); // Exclude cancelled matches

  if (error) {
    Logger.error('[getMatchNeedingFeedback] Query error:', error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Import date utility for feedback window check
  const { getMatchEndTimeDifferenceFromNow } = await import('@rallia/shared-utils');

  const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

  // Filter and find the best match
  let bestMatch: PendingFeedbackMatch | null = null;
  let bestEndTimeDiff = -Infinity; // Most recent = closest to 0 (least negative)

  for (const match of data as MatchWithDetails[]) {
    // Check if match has ended and is within feedback window
    const endTimeDiff = getMatchEndTimeDifferenceFromNow(
      match.match_date,
      match.start_time,
      match.end_time,
      match.timezone
    );

    // Skip if match hasn't ended yet (endTimeDiff > 0)
    if (endTimeDiff > 0) {
      continue;
    }

    // Skip if outside 48h feedback window
    const timeSinceEnd = Math.abs(endTimeDiff);
    if (timeSinceEnd >= FORTY_EIGHT_HOURS_MS) {
      continue;
    }

    // Find user's participant record
    const userParticipant = match.participants?.find(
      (p: MatchParticipantWithPlayer) => p.player_id === userId && p.status === 'joined'
    );

    // Skip if user is not a joined participant or has completed feedback
    if (!userParticipant || userParticipant.feedback_completed) {
      continue;
    }

    // Check if match was full (all spots filled)
    const joinedParticipants =
      match.participants?.filter((p: MatchParticipantWithPlayer) => p.status === 'joined') ?? [];
    const expectedCount = match.format === 'doubles' ? 4 : 2;

    if (joinedParticipants.length < expectedCount) {
      continue;
    }

    // This match is eligible - check if it's the most recent
    if (endTimeDiff > bestEndTimeDiff) {
      bestEndTimeDiff = endTimeDiff;
      bestMatch = { match, userParticipant };
    }
  }

  if (!bestMatch) {
    return null;
  }

  // Enrich with profiles
  const match = bestMatch.match;
  const playerIds = new Set<string>();

  if (match.created_by_player?.id) {
    playerIds.add(match.created_by_player.id);
  }
  if (match.participants) {
    match.participants.forEach((p: MatchParticipantWithPlayer) => {
      const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
      if (playerObj?.id) {
        playerIds.add(playerObj.id);
      }
    });
  }

  const profileIds = Array.from(playerIds);
  const profilesMap: Record<string, Profile> = {};

  if (profileIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profile')
      .select('*')
      .in('id', profileIds);

    if (!profilesError && profiles) {
      profiles.forEach(profile => {
        profilesMap[profile.id] = profile;
      });
    }
  }

  // Attach profile to creator
  if (match.created_by_player?.id && profilesMap[match.created_by_player.id]) {
    match.created_by_player.profile = profilesMap[match.created_by_player.id];
  }

  // Attach profiles to participants
  if (match.participants) {
    match.participants = match.participants.map((p: MatchParticipantWithPlayer) => {
      const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
      const playerId = playerObj?.id;

      if (playerId && profilesMap[playerId]) {
        playerObj.profile = profilesMap[playerId];
      }
      if (Array.isArray(p.player) && playerObj) {
        p.player = playerObj;
      }
      return p;
    });
  }

  return bestMatch;
}

export interface GetCustomLocationMatchesParams {
  sportIds: string[];
  latitude: number;
  longitude: number;
  maxDistanceKm?: number;
}

/**
 * Get upcoming public matches with custom locations for the map view.
 * Filters to matches where location_type='custom' with valid coordinates
 * within a bounding box around the user's position.
 */
export async function getCustomLocationMatches(
  params: GetCustomLocationMatchesParams
): Promise<MatchWithDetails[]> {
  const { sportIds, latitude, longitude, maxDistanceKm = 25 } = params;

  // Approximate bounding box (~1 degree latitude ≈ 111 km)
  const latDelta = maxDistanceKm / 111;
  const lngDelta = maxDistanceKm / (111 * Math.cos((latitude * Math.PI) / 180));

  const { data, error } = await supabase
    .from('match')
    .select(
      `
      *,
      sport:sport_id (*),
      facility:facility_id (*),
      court:court_id (*),
      created_by_player:created_by (
        id,
        gender,
        playing_hand,
        max_travel_distance,
        player_reputation (reputation_score, total_events),
        notification_match_requests,
        notification_messages,
        notification_reminders,
        privacy_show_age,
        privacy_show_location,
        privacy_show_stats
      ),
      participants:match_participant (
        id,
        match_id,
        player_id,
        status,
        is_host,
        score,
        team_number,
        feedback_completed,
        checked_in_at,
        joined_at,
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score, total_events),
          notification_match_requests,
          notification_messages,
          notification_reminders,
          privacy_show_age,
          privacy_show_location,
          privacy_show_stats
        )
      )
    `
    )
    .in('sport_id', sportIds)
    .eq('location_type', 'custom')
    .eq('visibility', 'public')
    .is('cancelled_at', null)
    .not('custom_latitude', 'is', null)
    .not('custom_longitude', 'is', null)
    .gte('custom_latitude', latitude - latDelta)
    .lte('custom_latitude', latitude + latDelta)
    .gte('custom_longitude', longitude - lngDelta)
    .lte('custom_longitude', longitude + lngDelta)
    .gte('match_date', new Date().toISOString().split('T')[0])
    .limit(100);

  if (error) {
    throw new Error(`Failed to get custom location matches: ${error.message}`);
  }

  return (data ?? []) as unknown as MatchWithDetails[];
}

/**
 * Match service object for grouped exports
 */
export const matchService = {
  createMatch,
  getMatch,
  getMatchWithDetails,
  getMatchesByCreator,
  getPlayerMatchesWithDetails,
  getNearbyMatches,
  getPublicMatches,
  getCustomLocationMatches,
  updateMatch,
  cancelMatch,
  deleteMatch,
  // Participant actions
  joinMatch,
  leaveMatch,
  getParticipantStatus,
  acceptJoinRequest,
  rejectJoinRequest,
  cancelJoinRequest,
  kickParticipant,
  checkInToMatch,
  // Invitations
  invitePlayersToMatch,
  // Feedback
  getMatchNeedingFeedback,
};

export default matchService;
