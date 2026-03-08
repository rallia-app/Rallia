/**
 * Match Service
 * Handles all match-related database operations using Supabase.
 */

import { supabase } from '../supabase';
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
import {
  createMatchChat,
  getMatchChat,
  removeConversationParticipant,
  addConversationParticipant,
} from '../chat/chatService';
import type {
  Match,
  TablesInsert,
  MatchWithDetails,
  MatchParticipantWithPlayer,
  MatchParticipant,
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

  return data as Match;
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
        player_reputation (reputation_score),
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
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score),
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
      console.error('[getMatchWithDetails] Error fetching ratings:', ratingsError);
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
        player_reputation (reputation_score),
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
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score),
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
export type UpdateMatchErrorCode = 'MATCH_NOT_FOUND' | 'FORMAT_CHANGE_BLOCKED' | 'UNKNOWN_ERROR';

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
  // Block format change from doubles to singles if 2+ participants joined
  if (updates.format !== undefined && updates.format !== match.format) {
    if (match.format === 'doubles' && updates.format === 'singles' && joinedCount >= 2) {
      return {
        canUpdate: false,
        errorCode: 'FORMAT_CHANGE_BLOCKED',
        error:
          'Cannot change from doubles to singles with 2 or more participants. Remove participants first or cancel the match.',
      };
    }
  }

  // ========================================
  // GENDER PREFERENCE VALIDATION
  // ========================================
  // Warn if changing gender preference would affect joined participants
  if (updates.preferredOpponentGender !== undefined && joinedCount > 0) {
    const newGender =
      updates.preferredOpponentGender === 'any' ? null : updates.preferredOpponentGender;

    // Only check if setting a specific gender (not clearing it)
    if (newGender) {
      const mismatchedParticipants = joinedParticipants.filter(
        (p: { player: { gender: string } | { gender: string }[] | null }) => {
          // Handle both array and object formats from Supabase
          const playerObj = Array.isArray(p.player) ? p.player[0] : p.player;
          return playerObj?.gender && playerObj.gender !== newGender;
        }
      );

      if (mismatchedParticipants.length > 0) {
        warnings.push({
          type: 'gender_mismatch',
          affectedParticipantIds: mismatchedParticipants.map(
            (p: { player_id: string }) => p.player_id
          ),
          message: `${mismatchedParticipants.length} participant(s) do not match the new gender preference`,
        });
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
        notifyMatchUpdated(participantIds, matchId, updatedFields).catch(err => {
          console.error('Failed to send match updated notifications:', err);
        });
      }
    }
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
        console.error('[cancelMatch] Failed to create reputation event:', err);
      });
    } else {
      createReputationEvent(userId, 'match_cancelled_early', { matchId }).catch(err => {
        console.error('[cancelMatch] Failed to create reputation event:', err);
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
        .select('sport:sport_id (name), location_name')
        .eq('id', matchId)
        .single();

      const sportName = (matchDetails?.sport as { name?: string } | null)?.name ?? 'Match';
      const locationName =
        (matchDetails as { location_name?: string | null })?.location_name ?? undefined;

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
        console.error('Failed to send match cancelled notifications:', err);
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

/**
 * Ensures a match chat exists and that the new joiner is a participant.
 * Creates the conversation on the first join, and adds subsequent joiners
 * to the existing conversation.
 *
 * @param matchId - The match ID
 * @param newPlayerId - The player who just joined and needs to be in the chat
 */
async function ensureMatchChat(matchId: string, newPlayerId: string): Promise<void> {
  try {
    // Check if a conversation already exists for this match
    const existingConversation = await getMatchChat(matchId);

    if (existingConversation) {
      // Chat exists — just add the new player
      await addConversationParticipant(existingConversation.id, newPlayerId);
      console.log(
        `[ensureMatchChat] Added player ${newPlayerId} to existing chat for match ${matchId}`
      );
      return;
    }

    // No chat yet — fetch match details to create one
    const { data: match, error: matchError } = await supabase
      .from('match')
      .select(
        `
        id,
        format,
        match_date,
        created_by,
        sport:sport_id (
          name
        ),
        participants:match_participant (
          player_id,
          status
        )
      `
      )
      .eq('id', matchId)
      .single();

    if (matchError || !match) {
      console.error('[ensureMatchChat] Failed to fetch match:', matchError);
      return;
    }

    // Collect all player IDs: host + all joined participants
    const joinedParticipants =
      match.participants?.filter((p: { status: string }) => p.status === 'joined') ?? [];
    const allPlayerIds = [
      match.created_by,
      ...joinedParticipants.map((p: { player_id: string }) => p.player_id),
    ];
    const uniquePlayerIds = [...new Set(allPlayerIds)];

    const sportName = (match.sport as { name?: string } | null)?.name || 'Match';
    const matchFormat = match.format as 'singles' | 'doubles';

    // Create the match chat (may return existing conv in a race condition)
    const conversation = await createMatchChat(
      matchId,
      newPlayerId,
      uniquePlayerIds,
      matchFormat,
      sportName,
      match.match_date
    );

    // Ensure the new player is a participant even if createMatchChat
    // returned an already-existing conversation (race condition safety)
    await addConversationParticipant(conversation.id, newPlayerId);

    console.log(
      `[ensureMatchChat] Created/joined ${matchFormat} chat for match ${matchId}:`,
      conversation.id
    );
  } catch (error) {
    console.error('[ensureMatchChat] Error:', error);
  }
}

/**
 * Helper to remove a player from the match chat when they leave or are kicked.
 * Fire-and-forget — errors are logged but don't block the caller.
 */
async function removePlayerFromMatchChat(matchId: string, playerId: string): Promise<void> {
  try {
    const conversation = await getMatchChat(matchId);
    if (!conversation) return;

    await removeConversationParticipant(conversation.id, playerId);
    console.log(
      `[removePlayerFromMatchChat] Removed player ${playerId} from chat for match ${matchId}`
    );
  } catch (error) {
    console.error('[removePlayerFromMatchChat] Error:', error);
  }
}

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

  if (availableSpots <= 0) {
    // Match is full - add to waitlist
    participantStatus = 'waitlisted';
  } else if (match.join_mode === 'request') {
    // Match has spots but requires host approval
    participantStatus = 'requested';
  } else {
    // Match has spots and allows direct join
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
  const playerAvatarUrl = profileData?.profile_picture_url ?? undefined;

  // Send notification to host if this is a join request
  if (participantStatus === 'requested') {
    // Notify the host (fire and forget - don't block on notification)
    const sportName = (match.sport as { name?: string } | null)?.name;
    notifyMatchJoinRequest(match.created_by, matchId, playerName, sportName, match.match_date, {
      playerAvatarUrl,
    }).catch(err => {
      console.error('Failed to send join request notification:', err);
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
          start_time
        `
        )
        .eq('id', matchId)
        .single();

      const sportName = (matchDetails?.sport as { name?: string } | null)?.name;
      // Don't include location if it's TBD
      const locationName =
        matchDetails?.location_type === 'tbd' ? undefined : matchDetails?.location_name;

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

      // Notify all users (fire and forget - don't block on notification)
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
        console.error('Failed to send player joined notifications:', err);
      });
    }

    // Ensure match chat exists and add the new player
    ensureMatchChat(matchId, playerId);
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
          console.error('[leaveMatch] Failed to create reputation event:', err);
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
        console.error('Failed to send player left notifications:', err);
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
        console.error('Failed to send spot opened notifications:', err);
      });
    }
  }

  // Remove the player from the match chat (fire and forget)
  removePlayerFromMatchChat(matchId, playerId).catch(err => {
    console.error('[leaveMatch] Failed to remove player from match chat:', err);
  });
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
    console.error('Failed to send join accepted notification:', err);
  });

  // Ensure match chat exists and add the accepted player
  ensureMatchChat(matchId, participant.player_id);

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
      console.error('Failed to send join rejected notification:', err);
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
      console.error('Failed to send kicked notification:', err);
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
        console.error('Failed to send spot opened notifications:', err);
      });
    }

    // Remove the kicked player from the match chat (fire and forget)
    removePlayerFromMatchChat(matchId, participantRecord.player_id).catch(err => {
      console.error('[kickParticipant] Failed to remove player from match chat:', err);
    });
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
export async function declineInvitation(
  matchId: string,
  playerId: string
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

  // Update the participant status to 'declined'
  const { data: updatedParticipant, error: updateError } = await supabase
    .from('match_participant')
    .update({
      status: 'declined',
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
      console.error('Failed to send invitation notification:', err);
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
  limit?: number;
  offset?: number;
}

/**
 * Result from nearby matches RPC
 */
interface NearbyMatchResult {
  match_id: string;
  distance_meters: number;
}

/**
 * Match with details including distance (for nearby matches)
 */
interface MatchWithDetailsAndDistance extends MatchWithDetails {
  distance_meters: number | null;
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
    limit = 20,
    offset = 0,
  } = params;

  // Step 1: Get match IDs within distance using RPC
  const { data: nearbyResults, error: rpcError } = await supabase.rpc('search_matches_nearby', {
    p_latitude: latitude,
    p_longitude: longitude,
    p_max_distance_km: maxDistanceKm,
    p_sport_id: sportId,
    p_limit: limit + 1, // Fetch one extra to check if more exist
    p_offset: offset,
    p_user_gender: userGender || null, // Pass user's gender for eligibility filtering
  });

  if (rpcError) {
    throw new Error(`Failed to search nearby matches: ${rpcError.message}`);
  }

  const results = (nearbyResults ?? []) as NearbyMatchResult[];
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
    };
  }

  // Step 2: Fetch full match details for the found IDs
  const matchIds = results.map(r => r.match_id);
  const distanceMap = new Map(results.map(r => [r.match_id, r.distance_meters]));

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
        player_reputation (reputation_score),
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
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score),
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

    // Attach distance
    const matchWithDistance: MatchWithDetailsAndDistance = {
      ...match,
      distance_meters: distanceMap.get(match.id) ?? null,
    };

    matchMap.set(match.id, matchWithDistance);
  });

  // Maintain order from RPC results (sorted by date/time)
  const orderedMatches = matchIds
    .map(id => matchMap.get(id))
    .filter(Boolean) as MatchWithDetailsAndDistance[];

  // Additional client-side sort to ensure correct ordering by datetime
  // This handles edge cases where order might not be preserved
  // We create proper datetime objects by combining date + time
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
        player_reputation (reputation_score),
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
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score),
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
        console.error('[getPlayerMatchesWithDetails] Error fetching ratings:', ratingsError);
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

  return {
    matches: enrichedData as MatchWithDetails[],
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
    userGender,
    facilityId,
    limit = 20,
    offset = 0,
  } = params;

  // Convert 'all' to null for the RPC (null means no distance filter)
  const distanceForRpc = maxDistanceKm === 'all' || maxDistanceKm === null ? null : maxDistanceKm;

  // Step 1: Get match IDs using RPC with filters
  const { data: matchResults, error: rpcError } = await supabase.rpc('search_public_matches', {
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
    p_limit: limit + 1, // Fetch one extra to check if more exist
    p_offset: offset,
    p_user_gender: userGender || null, // Pass user's gender for eligibility filtering
    p_facility_id: facilityId || null, // Filter by specific facility
    p_match_tier: matchTier === 'all' ? null : matchTier,
    p_spots_available: spotsAvailable === 'all' ? null : spotsAvailable,
    p_specific_time: specificTime || null,
  });

  if (rpcError) {
    throw new Error(`Failed to search public matches: ${rpcError.message}`);
  }

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
    };
  }

  // Step 2: Fetch full match details for the found IDs
  const matchIds = results.map(r => r.match_id);
  const distanceMap = new Map(results.map(r => [r.match_id, r.distance_meters]));

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
        player_reputation (reputation_score),
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
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score),
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
          publicRatingsMap[rating.player_id] = {
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

  // Maintain order from RPC results (sorted by date/time)
  const orderedMatches = matchIds
    .map(id => matchMap.get(id))
    .filter(Boolean) as MatchWithDetailsAndDistance[];

  return {
    matches: orderedMatches,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
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
      console.error('[invitePlayersToMatch] Update error for re-invite:', updateError);
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
      console.error('[invitePlayersToMatch] Insert error:', insertError);
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
      console.error('[invitePlayersToMatch] Notification error:', err);
    });
  }

  return { invited, alreadyInMatch, failed };
}

/**
 * Check-in radius in meters
 */
const CHECK_IN_RADIUS_METERS = 100;

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
  playerId: string,
  playerLat: number,
  playerLng: number
): Promise<CheckInResult> {
  try {
    // 1. Fetch match with facility coordinates
    const { data: match, error: matchError } = await supabase
      .from('match')
      .select(
        `
        id,
        location_type,
        custom_latitude,
        custom_longitude,
        facility:facility_id (
          id,
          latitude,
          longitude
        )
      `
      )
      .eq('id', matchId)
      .single();

    if (matchError || !match) {
      console.error('[checkInToMatch] Failed to fetch match:', matchError);
      return { success: false, error: 'unknown' };
    }

    // 2. Determine target coordinates based on location type
    let targetLat: number | null = null;
    let targetLng: number | null = null;

    if (match.location_type === 'facility' && match.facility) {
      // Handle facility as potential array (Supabase relation quirk)
      const facility = Array.isArray(match.facility) ? match.facility[0] : match.facility;
      targetLat = facility?.latitude ?? null;
      targetLng = facility?.longitude ?? null;
    } else if (match.location_type === 'custom') {
      targetLat = match.custom_latitude;
      targetLng = match.custom_longitude;
    }

    // 3. Validate we have location coordinates
    if (targetLat === null || targetLng === null) {
      console.error('[checkInToMatch] Match has no valid location coordinates:', {
        matchId,
        locationType: match.location_type,
      });
      return { success: false, error: 'no_location' };
    }

    // 4. Check if player is already checked in
    const { data: participant, error: participantError } = await supabase
      .from('match_participant')
      .select('id, checked_in_at')
      .eq('match_id', matchId)
      .eq('player_id', playerId)
      .eq('status', 'joined')
      .single();

    if (participantError || !participant) {
      console.error('[checkInToMatch] Player is not a participant:', {
        matchId,
        playerId,
        error: participantError,
      });
      return { success: false, error: 'not_participant' };
    }

    if (participant.checked_in_at) {
      return { success: false, error: 'already_checked_in' };
    }

    // 5. Calculate distance using Haversine formula
    const distanceMeters = calculateDistanceMeters(playerLat, playerLng, targetLat, targetLng);

    // 6. Check if within radius
    if (distanceMeters > CHECK_IN_RADIUS_METERS) {
      return { success: false, error: 'too_far', distanceMeters };
    }

    // 7. Update match_participant.checked_in_at
    const { error: updateError } = await supabase
      .from('match_participant')
      .update({ checked_in_at: new Date().toISOString() })
      .eq('id', participant.id);

    if (updateError) {
      console.error('[checkInToMatch] Failed to update checked_in_at:', updateError);
      return { success: false, error: 'unknown' };
    }

    return { success: true, distanceMeters };
  } catch (err) {
    console.error('[checkInToMatch] Unexpected error:', err);
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
  p_limit: 50,
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
    console.warn('[getMatchNeedingFeedback] RPC upstream error, retrying once:', rpcError.message);
    const retry = await callGetPlayerMatchesForFeedback(userId);
    rpcError = retry.error;
    matchIdResults = retry.data;
  }

  if (rpcError) {
    console.error(
      '[getMatchNeedingFeedback] RPC error:',
      rpcError?.message,
      rpcError?.details ?? rpcError
    );
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
        player_reputation (reputation_score),
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
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score),
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
    console.error('[getMatchNeedingFeedback] Query error:', error);
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
        player_reputation (reputation_score),
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
        created_at,
        updated_at,
        player:player_id (
          id,
          gender,
          playing_hand,
          max_travel_distance,
          player_reputation (reputation_score),
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
