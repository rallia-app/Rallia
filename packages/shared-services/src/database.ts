/**
 * Database Service
 *
 * Centralized service for all database operations using Supabase
 * Provides type-safe CRUD methods and onboarding-specific operations
 */

import type {
  Profile,
  ProfileInsert,
  ProfileUpdate,
  Player,
  PlayerInsert,
  PlayerUpdate,
  PlayerSport,
  PlayerSportInsert,
  PlayerSportUpdate,
  PlayerRatingScore,
  PlayerRatingScoreInsert,
  PlayerAvailability,
  PlayerAvailabilityInsert,
  PlayerAvailabilityUpdate,
  Sport,
  RatingSystem,
  RatingScore,
  RatingSystemCodeEnum,
  OnboardingPersonalInfo,
  OnboardingLocationInfo,
  OnboardingPlayerPreferences,
  OnboardingRating,
  OnboardingAvailability,
  DatabaseResponse,
  DatabaseError,
} from '@rallia/shared-types';

import { supabase } from './supabase';
import { isRealSportId, fallbackSportSlug } from './sports';

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Resolve a possibly-synthetic onboarding sport id to a real DB uuid.
 *
 * Onboarding screens fall back to `${slug}-fallback` ids when the sport-catalog
 * fetch fails; those must never reach a `sport_id` uuid column (Postgres 22P02).
 * Real uuids pass straight through (no network); synthetic ids are resolved by
 * slug. Throws a clear error when an id can't be resolved so callers surface a
 * friendly message instead of a cryptic Postgres failure.
 */
async function resolveSportId(sportId: string): Promise<string> {
  if (isRealSportId(sportId)) return sportId;

  const slug = fallbackSportSlug(sportId);
  if (slug) {
    const { data } = await SportService.getSportByName(slug);
    if (isRealSportId(data?.id)) return data.id;
  }

  throw new Error(`Cannot resolve sport id "${sportId}" to a real sport`);
}

/** Result of complete_onboarding(): the server either flips the flag or lists what is missing. */
export interface OnboardingCompletionResult {
  ok: boolean;
  /** Gap codes: 'postal_code' | 'sport' | 'rating:<sport_id>' | 'favorites:<sport_id>' */
  missing: string[];
}

function parseOnboardingCompletionResult(raw: unknown): OnboardingCompletionResult {
  const obj = raw && typeof raw === 'object' ? (raw as { ok?: unknown; missing?: unknown }) : {};
  const missing = Array.isArray(obj.missing)
    ? obj.missing.filter((code): code is string => typeof code === 'string')
    : [];
  return { ok: obj.ok === true, missing };
}

/**
 * Handle Supabase errors and format them consistently
 */
function handleError(error: unknown): DatabaseError {
  if (error && typeof error === 'object' && 'message' in error) {
    return {
      message: (error as { message: string }).message,
      code: (error as { code?: string }).code,
      details: (error as { details?: string }).details,
      hint: (error as { hint?: string }).hint,
    };
  }
  return {
    message: 'An unknown error occurred',
  };
}

/**
 * Get the current authenticated user ID
 */
async function getCurrentUserId(): Promise<string | null> {
  try {
    // First try to get the session
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('Error getting session:', sessionError);
      return null;
    }

    if (!session) {
      console.warn('No active session found');
      return null;
    }

    // If session exists, get user details
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error('Error getting user:', userError);
      return null;
    }

    if (!user) {
      console.warn('Session exists but no user found');
      return null;
    }

    return user.id;
  } catch (error) {
    console.error('Unexpected error in getCurrentUserId:', error);
    return null;
  }
}

// ============================================
// AUTH SERVICE
// ============================================

export const AuthService = {
  /**
   * Get the current authenticated user's ID
   */
  async getCurrentUserId(): Promise<string | null> {
    return getCurrentUserId();
  },

  /**
   * Get the current authenticated user
   */
  async getCurrentUser() {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) {
      return { data: null, error: handleError(error) };
    }
    return { data: user, error: null };
  },
};

// ============================================
// ENUM SERVICE
// ============================================

export const EnumService = {
  /**
   * Get all playing hand enum values with display labels
   */
  async getPlayingHandTypes(): Promise<DatabaseResponse<Array<{ value: string; label: string }>>> {
    try {
      const { data, error } = await supabase.rpc('get_playing_hand_types');

      if (error) {
        console.warn('get_playing_hand_types RPC not found, using fallback values', error);
        const fallbackData = [
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
          { value: 'both', label: 'Both' },
        ];
        return { data: fallbackData, error: null };
      }

      return { data: data || [], error: null };
    } catch (error) {
      const fallbackData = [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
        { value: 'both', label: 'Both' },
      ];
      return { data: fallbackData, error: null };
    }
  },

  /**
   * Get all match duration enum values with display labels
   */
  async getMatchDurationTypes(): Promise<
    DatabaseResponse<Array<{ value: string; label: string }>>
  > {
    try {
      const { data, error } = await supabase.rpc('get_match_duration_types');

      if (error) {
        console.warn('get_match_duration_types RPC not found, using fallback values', error);
        const fallbackData = [
          { value: '30', label: '30 Minutes' },
          { value: '60', label: '1 Hour' },
          { value: '90', label: '1.5 Hours' },
          { value: '120', label: '2 Hours' },
          { value: 'custom', label: 'Custom' },
        ];
        return { data: fallbackData, error: null };
      }

      return { data: data || [], error: null };
    } catch (error) {
      const fallbackData = [
        { value: '30', label: '30 Minutes' },
        { value: '60', label: '1 Hour' },
        { value: '90', label: '1.5 Hours' },
        { value: '120', label: '2 Hours' },
        { value: 'custom', label: 'Custom' },
      ];
      return { data: fallbackData, error: null };
    }
  },

  /**
   * Get all match type enum values with display labels
   */
  async getMatchTypeTypes(): Promise<DatabaseResponse<Array<{ value: string; label: string }>>> {
    try {
      const { data, error } = await supabase.rpc('get_match_type_types');

      if (error) {
        console.warn('get_match_type_types RPC not found, using fallback values', error);
        const fallbackData = [
          { value: 'casual', label: 'Casual' },
          { value: 'competitive', label: 'Competitive' },
          { value: 'both', label: 'Both' },
        ];
        return { data: fallbackData, error: null };
      }

      return { data: data || [], error: null };
    } catch (error) {
      const fallbackData = [
        { value: 'casual', label: 'Casual' },
        { value: 'competitive', label: 'Competitive' },
        { value: 'both', label: 'Both' },
      ];
      return { data: fallbackData, error: null };
    }
  },
};

// ============================================
// SPORT SERVICE
// ============================================

export const SportService = {
  /**
   * Get all active sports
   */
  async getAllSports(): Promise<DatabaseResponse<Sport[]>> {
    try {
      const { data, error } = await supabase
        .from('sport')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Get sport by name (tennis, pickleball, etc.)
   */
  async getSportByName(name: string): Promise<DatabaseResponse<Sport>> {
    try {
      const { data, error } = await supabase
        .from('sport')
        .select('*')
        .eq('name', name)
        .eq('is_active', true)
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Get sport by ID
   */
  async getSportById(id: string): Promise<DatabaseResponse<Sport>> {
    try {
      const { data, error } = await supabase.from('sport').select('*').eq('id', id).single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },
};

// ============================================
// PROFILE SERVICE
// ============================================

export const ProfileService = {
  /**
   * Get profile by user ID
   */
  async getProfile(userId: string): Promise<DatabaseResponse<Profile>> {
    try {
      const { data, error } = await supabase.from('profile').select('*').eq('id', userId).single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Get profile by email address
   */
  async getProfileByEmail(email: string): Promise<DatabaseResponse<Profile>> {
    try {
      const { data, error } = await supabase
        .from('profile')
        .select('*')
        .eq('email', email)
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Create a new profile
   */
  async createProfile(profile: ProfileInsert): Promise<DatabaseResponse<Profile>> {
    try {
      const { data, error } = await supabase.from('profile').insert(profile).select().single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Update an existing profile
   */
  async updateProfile(userId: string, updates: ProfileUpdate): Promise<DatabaseResponse<Profile>> {
    try {
      const { data, error } = await supabase
        .from('profile')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Mark onboarding as completed through the server-side invariant check.
   * Returns { ok: false, missing } instead of flipping the flag when the player
   * still lacks a postal code, a sport, a rating or enough favourites.
   */
  async completeOnboarding(userId: string): Promise<DatabaseResponse<OnboardingCompletionResult>> {
    try {
      const { data, error } = await supabase.rpc('complete_onboarding', { p_player_id: userId });

      if (error) throw error;

      return { data: parseOnboardingCompletionResult(data), error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },
};

// ============================================
// PLAYER SERVICE
// ============================================

export const PlayerService = {
  /**
   * Get player by user ID
   */
  async getPlayer(userId: string): Promise<DatabaseResponse<Player>> {
    try {
      const { data, error } = await supabase.from('player').select('*').eq('id', userId).single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Create a new player
   */
  async createPlayer(player: PlayerInsert): Promise<DatabaseResponse<Player>> {
    try {
      const { data, error } = await supabase.from('player').insert(player).select().single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Update an existing player
   */
  async updatePlayer(userId: string, updates: PlayerUpdate): Promise<DatabaseResponse<Player>> {
    try {
      const { data, error } = await supabase
        .from('player')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },
};

// ============================================
// PLAYER SPORT SERVICE
// ============================================

export const PlayerSportService = {
  /**
   * Get all sports for a player
   */
  async getPlayerSports(playerId: string): Promise<DatabaseResponse<PlayerSport[]>> {
    try {
      const { data, error } = await supabase
        .from('player_sport')
        .select('*, sport(*)')
        .eq('player_id', playerId);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Add a sport for a player
   */
  async addPlayerSport(playerSport: PlayerSportInsert): Promise<DatabaseResponse<PlayerSport>> {
    try {
      const sport_id = await resolveSportId(playerSport.sport_id);
      const { data, error } = await supabase
        .from('player_sport')
        .insert({ ...playerSport, sport_id })
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Update player sport preferences
   */
  async updatePlayerSport(
    playerId: string,
    sportId: string,
    updates: PlayerSportUpdate
  ): Promise<DatabaseResponse<PlayerSport>> {
    try {
      const resolvedSportId = await resolveSportId(sportId);
      const { data, error } = await supabase
        .from('player_sport')
        .update(updates)
        .eq('player_id', playerId)
        .eq('sport_id', resolvedSportId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Remove a sport from a player
   */
  async removePlayerSport(playerId: string, sportId: string): Promise<DatabaseResponse<null>> {
    try {
      const resolvedSportId = await resolveSportId(sportId);
      const { error } = await supabase
        .from('player_sport')
        .delete()
        .eq('player_id', playerId)
        .eq('sport_id', resolvedSportId);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Toggle sport selection for a player (add if not exists, remove if exists)
   * Used in SportSelectionOverlay for real-time persistence
   */
  async togglePlayerSport(
    playerId: string,
    sportId: string,
    isSelected: boolean
  ): Promise<DatabaseResponse<PlayerSport | null>> {
    try {
      const resolvedSportId = await resolveSportId(sportId);
      if (isSelected) {
        // Add sport with minimal data (preferences added later in PlayerPreferencesOverlay)
        const { data, error } = await supabase
          .from('player_sport')
          .insert({
            player_id: playerId,
            sport_id: resolvedSportId,
            is_primary: false, // Will be updated in PlayerPreferencesOverlay
          })
          .select()
          .single();

        if (error) throw error;
        return { data, error: null };
      } else {
        // Remove sport
        const { error } = await supabase
          .from('player_sport')
          .delete()
          .eq('player_id', playerId)
          .eq('sport_id', resolvedSportId);

        if (error) throw error;
        return { data: null, error: null };
      }
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Check if a player has selected a sport
   */
  async hasPlayerSport(playerId: string, sportId: string): Promise<DatabaseResponse<boolean>> {
    try {
      const resolvedSportId = await resolveSportId(sportId);
      const { data, error } = await supabase
        .from('player_sport')
        .select('id')
        .eq('player_id', playerId)
        .eq('sport_id', resolvedSportId)
        .maybeSingle();

      if (error) throw error;

      return { data: data !== null, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },
};

// ============================================
// RATING SERVICE
// ============================================

export const RatingService = {
  /**
   * Get all rating systems for a sport
   */
  async getRatingSystemsForSport(sportId: string): Promise<DatabaseResponse<RatingSystem[]>> {
    try {
      const { data, error } = await supabase
        .from('rating_system')
        .select('*')
        .eq('sport_id', sportId)
        .eq('is_active', true);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Get rating scores for a specific rating system
   */
  async getRatingScores(ratingSystemId: string): Promise<DatabaseResponse<RatingScore[]>> {
    try {
      const { data, error } = await supabase
        .from('rating_score')
        .select('*')
        .eq('rating_system_id', ratingSystemId)
        .order('value');

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Get all ratings for a player
   */
  async getPlayerRatings(playerId: string): Promise<DatabaseResponse<PlayerRatingScore[]>> {
    try {
      const { data, error } = await supabase
        .from('player_rating_score')
        .select(
          '*, rating_score!player_rating_scores_rating_score_id_fkey(*, rating_system(*, sport(*)))'
        )
        .eq('player_id', playerId);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Add a rating for a player
   */
  async addPlayerRating(
    rating: PlayerRatingScoreInsert
  ): Promise<DatabaseResponse<PlayerRatingScore>> {
    try {
      const { data, error } = await supabase
        .from('player_rating_score')
        .upsert(rating, {
          onConflict: 'player_id,rating_score_id',
        })
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Remove a rating from a player
   */
  async removePlayerRating(
    playerId: string,
    ratingScoreId: string
  ): Promise<DatabaseResponse<null>> {
    try {
      const { error } = await supabase
        .from('player_rating_score')
        .delete()
        .eq('player_id', playerId)
        .eq('rating_score_id', ratingScoreId);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },
};

// ============================================
// RATING SCORE SERVICE
// ============================================

export const RatingScoreService = {
  /**
   * Get rating scores by sport name and rating system code (e.g., Tennis ntrp, Pickleball dupr)
   * Uses the RPC function to fetch scores dynamically from database
   */
  async getRatingScoresBySport(
    sportName: string,
    ratingSystemCode: RatingSystemCodeEnum
  ): Promise<
    DatabaseResponse<
      Array<{
        id: string;
        score_value: number;
        display_label: string;
        skill_level: 'beginner' | 'intermediate' | 'advanced' | 'professional' | null;
        description: string;
      }>
    >
  > {
    try {
      const { data, error } = await supabase.rpc('get_rating_scores_by_type', {
        p_sport_name: sportName,
        p_rating_system_code: ratingSystemCode,
      });

      if (error) {
        console.warn(
          `get_rating_scores_by_type RPC error for ${sportName} ${ratingSystemCode}:`,
          error
        );
        return { data: [], error };
      }

      return { data: data || [], error: null };
    } catch (error) {
      console.error('Error fetching rating scores:', error);
      return { data: [], error: handleError(error) };
    }
  },
};

// ============================================
// AVAILABILITY SERVICE
// ============================================

export const AvailabilityService = {
  /**
   * Get all availability slots for a player
   */
  async getPlayerAvailability(playerId: string): Promise<DatabaseResponse<PlayerAvailability[]>> {
    try {
      const { data, error } = await supabase
        .from('player_availability')
        .select('*')
        .eq('player_id', playerId)
        .eq('is_active', true);

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Add availability slot for a player
   */
  async addPlayerAvailability(
    availability: PlayerAvailabilityInsert
  ): Promise<DatabaseResponse<PlayerAvailability>> {
    try {
      const { data, error } = await supabase
        .from('player_availability')
        .insert(availability)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Add multiple availability slots for a player
   */
  async addPlayerAvailabilityBulk(
    availabilities: PlayerAvailabilityInsert[]
  ): Promise<DatabaseResponse<PlayerAvailability[]>> {
    try {
      const { data, error } = await supabase
        .from('player_availability')
        .insert(availabilities)
        .select();

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Update availability slot
   */
  async updatePlayerAvailability(
    availabilityId: string,
    updates: PlayerAvailabilityUpdate
  ): Promise<DatabaseResponse<PlayerAvailability>> {
    try {
      const { data, error } = await supabase
        .from('player_availability')
        .update(updates)
        .eq('id', availabilityId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Delete availability slot
   */
  async deletePlayerAvailability(availabilityId: string): Promise<DatabaseResponse<null>> {
    try {
      const { error } = await supabase
        .from('player_availability')
        .delete()
        .eq('id', availabilityId);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Clear all availability for a player
   */
  async clearPlayerAvailability(playerId: string): Promise<DatabaseResponse<null>> {
    try {
      const { error } = await supabase
        .from('player_availability')
        .delete()
        .eq('player_id', playerId);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Hours where EVERY one of `playerIds` is free, as `${day}-${hour}` cell keys.
   *
   * Backs the opponent overlay on the availability grid: opened from a pairing
   * context the picker draws these underneath the player's own selection so
   * mutual hours are visible while painting. Intersection (not union) to match
   * `match_organizer_options`' `free_count = n` semantics, which is what decides
   * whether a suggestion can actually be played.
   *
   * One query, grouped client-side. `player_availability` is SELECT-open to
   * authenticated users (and already rendered on PlayerProfile), so this
   * discloses nothing new.
   */
  async getSharedAvailabilityCells(playerIds: string[]): Promise<DatabaseResponse<string[]>> {
    try {
      const ids = Array.from(new Set(playerIds.filter(Boolean)));
      if (ids.length === 0) return { data: [], error: null };

      const { data, error } = await supabase
        .from('player_availability')
        .select('player_id, day, hour_of_day')
        .in('player_id', ids)
        .eq('is_active', true);

      if (error) throw error;

      const freeBy = new Map<string, Set<string>>();
      for (const row of data ?? []) {
        const key = `${row.day}-${row.hour_of_day}`;
        if (!freeBy.has(key)) freeBy.set(key, new Set());
        freeBy.get(key)!.add(row.player_id);
      }

      const shared: string[] = [];
      for (const [key, players] of freeBy) {
        if (players.size === ids.length) shared.push(key);
      }

      return { data: shared, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },
};

// ============================================
// ONBOARDING SERVICE
// ============================================

export const OnboardingService = {
  /**
   * Save personal information from PersonalInformationOverlay
   */
  async savePersonalInfo(
    info: OnboardingPersonalInfo
  ): Promise<DatabaseResponse<{ profile: Profile; player: Player }>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        throw new Error('User not authenticated');
      }

      // Get user email from auth
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not found');
      }

      // Upsert profile (create if doesn't exist, update if exists)
      const { data: profile, error: profileError } = await supabase
        .from('profile')
        .upsert(
          {
            id: userId,
            email: user.email,
            first_name: info.first_name,
            last_name: info.last_name,
            display_name: info.display_name || `${info.first_name} ${info.last_name}`.trim(),
            birth_date: info.birth_date,
            phone: info.phone,
            profile_picture_url: info.profile_picture_url,
          },
          { onConflict: 'id' }
        )
        .select()
        .single();

      if (profileError) throw profileError;

      // Create or update player record with gender
      const { data: existingPlayer } = await supabase
        .from('player')
        .select('id')
        .eq('id', userId)
        .single();

      let player: Player;
      if (existingPlayer) {
        // Update existing player
        const { data, error } = await supabase
          .from('player')
          .update({ gender: info.gender })
          .eq('id', userId)
          .select()
          .single();

        if (error) throw error;
        player = data;
      } else {
        // Create new player
        const { data, error } = await supabase
          .from('player')
          .insert({ id: userId, gender: info.gender })
          .select()
          .single();

        if (error) throw error;
        player = data;
      }

      return { data: { profile, player }, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Save location information from LocationStep
   */
  async saveLocationInfo(info: OnboardingLocationInfo): Promise<DatabaseResponse<Player>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        throw new Error('User not authenticated');
      }

      // Update player with all location data
      const { data: player, error: playerError } = await supabase
        .from('player')
        .update({
          address: info.address,
          city: info.city,
          province: info.province,
          postal_code: info.postal_code,
          latitude: info.latitude,
          longitude: info.longitude,
        })
        .eq('id', userId)
        .select()
        .single();

      if (playerError) throw playerError;

      return { data: player, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Save player preferences from PlayerPreferencesOverlay
   */
  async savePreferences(
    preferences: OnboardingPlayerPreferences
  ): Promise<DatabaseResponse<{ player: Player; playerSports: PlayerSport[] }>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        throw new Error('User not authenticated');
      }

      // Update player with preferences
      const { data: player, error: playerError } = await supabase
        .from('player')
        .update({
          playing_hand: preferences.playing_hand,
          max_travel_distance: preferences.max_travel_distance,
        })
        .eq('id', userId)
        .select()
        .single();

      if (playerError) throw playerError;

      // Insert player sports with preferences. Resolve any synthetic onboarding
      // sport ids to real uuids before they hit the player_sport uuid column.
      const playerSportsData = await Promise.all(
        preferences.sports.map(async sport => ({
          player_id: userId,
          sport_id: await resolveSportId(sport.sport_id),
          preferred_match_duration: sport.preferred_match_duration,
          preferred_match_type: sport.preferred_match_type,
          is_primary: sport.is_primary,
        }))
      );

      const { data: playerSports, error: sportsError } = await supabase
        .from('player_sport')
        .upsert(playerSportsData, { onConflict: 'player_id,sport_id' })
        .select();

      if (sportsError) throw sportsError;

      return { data: { player, playerSports: playerSports || [] }, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Save player ratings from TennisRatingOverlay / PickleballRatingOverlay
   */
  async saveRatings(ratings: OnboardingRating[]): Promise<DatabaseResponse<PlayerRatingScore[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        throw new Error('User not authenticated');
      }

      const ratingPromises = ratings.map(async rating => {
        // Resolve any synthetic onboarding sport id before it reaches the
        // rating_system.sport_id uuid filter.
        const sportId = await resolveSportId(rating.sport_id);
        // Find the rating_score_id based on sport, rating system code, and score value
        const { data: ratingScore, error: scoreError } = await supabase
          .from('rating_score')
          .select('id, rating_system!inner(sport_id, code)')
          .eq('rating_system.sport_id', sportId)
          .eq('rating_system.code', rating.rating_system_code)
          .eq('value', rating.score_value)
          .single();

        if (scoreError) throw scoreError;

        // Upsert player rating (insert or update if exists)
        const { data, error } = await supabase
          .from('player_rating_score')
          .upsert(
            {
              player_id: userId,
              rating_score_id: ratingScore.id,
              source: 'self_reported', // All onboarding ratings are self-reported
              is_certified: false,
            },
            {
              onConflict: 'player_id,rating_score_id',
            }
          )
          .select()
          .single();

        if (error) throw error;
        return data;
      });

      const playerRatings = await Promise.all(ratingPromises);

      return { data: playerRatings, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Save player availability.
   *
   * Diff strategy: gather the desired set of active `(day, hour)` cells from
   * the input, upsert them with `last_confirmed_at = NOW()`, then delete any
   * rows for this player whose `(day, hour_of_day)` is not in the desired
   * set. Avoids leaving orphaned is_active=false rows in the table.
   *
   * Every successful save bumps last_confirmed_at — including the "tap save
   * without changes" gesture from the weekly refresh prompt — so the
   * staleness UI and refresh cron treat the player as current.
   */
  async saveAvailability(
    availabilities: OnboardingAvailability[]
  ): Promise<DatabaseResponse<PlayerAvailability[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        throw new Error('User not authenticated');
      }

      const confirmedAt = new Date().toISOString();

      // Build the desired set of active hourly cells. Duplicates within the
      // input collapse via the Map key. is_active=false rows are excluded
      // so they end up deleted below.
      type HourRow = {
        player_id: string;
        day: string;
        hour_of_day: number;
        is_active: boolean;
        last_confirmed_at: string;
      };
      const desired = new Map<string, HourRow>();

      for (const a of availabilities) {
        if (!a.is_active) continue;
        const key = `${a.day}-${a.hour_of_day}`;
        desired.set(key, {
          player_id: userId,
          day: a.day,
          hour_of_day: a.hour_of_day,
          is_active: true,
          last_confirmed_at: confirmedAt,
        });
      }

      const desiredRows = Array.from(desired.values());

      // Upsert all desired cells; the unique key (player_id, day, hour_of_day)
      // is set as the conflict target so re-saves bump last_confirmed_at
      // without churning the id column.
      let inserted: PlayerAvailability[] = [];
      if (desiredRows.length > 0) {
        const { data, error } = await supabase
          .from('player_availability')
          .upsert(desiredRows, { onConflict: 'player_id,day,hour_of_day' })
          .select();
        if (error) throw error;
        inserted = data ?? [];
      }

      // Delete any pre-existing rows for this player that aren't in the
      // desired set. PostgREST can't NOT IN a composite (day, hour) tuple,
      // so we fetch the current id+(day, hour) for this player, compute the
      // delete set client-side, and issue a single id-keyed delete.
      if (desiredRows.length === 0) {
        const { error: wipeErr } = await supabase
          .from('player_availability')
          .delete()
          .eq('player_id', userId);
        if (wipeErr) throw wipeErr;
      } else {
        const desiredKeys = new Set(desiredRows.map(r => `${r.day}-${r.hour_of_day}`));
        const { data: existing, error: selErr } = await supabase
          .from('player_availability')
          .select('id, day, hour_of_day')
          .eq('player_id', userId);
        if (selErr) throw selErr;
        const toDelete = (existing ?? [])
          .filter(row => !desiredKeys.has(`${row.day}-${row.hour_of_day}`))
          .map(row => row.id);
        if (toDelete.length > 0) {
          const { error: delErr } = await supabase
            .from('player_availability')
            .delete()
            .in('id', toDelete);
          if (delErr) throw delErr;
        }
      }

      return { data: inserted, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Save player availability for a SUBSET of weekdays only.
   *
   * Same diff/upsert path as saveAvailability, but scoped to `days`: rows for
   * weekdays outside that set are never read or touched. Used by the rolling
   * check-in wizard, which only edits the current window (today + next 3 days)
   * and must preserve the player's availability on the other weekdays. A window
   * day with all cells deselected still has its existing rows cleared (it's in
   * `days` but absent from the desired set).
   */
  async saveAvailabilityForDays(
    days: OnboardingAvailability['day'][],
    availabilities: OnboardingAvailability[]
  ): Promise<DatabaseResponse<PlayerAvailability[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        throw new Error('User not authenticated');
      }

      const dayScope = new Set<string>(days);
      if (dayScope.size === 0) {
        // No scope → no-op, never a table-wide delete.
        return { data: [], error: null };
      }

      const confirmedAt = new Date().toISOString();

      type HourRow = {
        player_id: string;
        day: string;
        hour_of_day: number;
        is_active: boolean;
        last_confirmed_at: string;
      };
      const desired = new Map<string, HourRow>();

      for (const a of availabilities) {
        if (!a.is_active) continue;
        if (!dayScope.has(a.day)) continue; // ignore any out-of-window cells
        const key = `${a.day}-${a.hour_of_day}`;
        desired.set(key, {
          player_id: userId,
          day: a.day,
          hour_of_day: a.hour_of_day,
          is_active: true,
          last_confirmed_at: confirmedAt,
        });
      }

      const desiredRows = Array.from(desired.values());

      let inserted: PlayerAvailability[] = [];
      if (desiredRows.length > 0) {
        const { data, error } = await supabase
          .from('player_availability')
          .upsert(desiredRows, { onConflict: 'player_id,day,hour_of_day' })
          .select();
        if (error) throw error;
        inserted = data ?? [];
      }

      // Delete only rows WITHIN the day scope that aren't in the desired set.
      // The `.in('day', ...)` filter is what keeps out-of-window days intact.
      const desiredKeys = new Set(desiredRows.map(r => `${r.day}-${r.hour_of_day}`));
      const { data: existing, error: selErr } = await supabase
        .from('player_availability')
        .select('id, day, hour_of_day')
        .eq('player_id', userId)
        .in('day', Array.from(dayScope));
      if (selErr) throw selErr;
      const toDelete = (existing ?? [])
        .filter(row => !desiredKeys.has(`${row.day}-${row.hour_of_day}`))
        .map(row => row.id);
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from('player_availability')
          .delete()
          .in('id', toDelete);
        if (delErr) throw delErr;
      }

      return { data: inserted, error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },

  /**
   * Complete the entire onboarding process for the signed-in player.
   * The RPC resolves auth.uid() itself; data.ok === false carries the gap codes.
   */
  async completeOnboarding(): Promise<DatabaseResponse<OnboardingCompletionResult>> {
    try {
      const { data, error } = await supabase.rpc('complete_onboarding');

      if (error) throw error;

      return { data: parseOnboardingCompletionResult(data), error: null };
    } catch (error) {
      return { data: null, error: handleError(error) };
    }
  },
};

// Export all services
export default {
  Auth: AuthService,
  Enum: EnumService,
  Sport: SportService,
  Profile: ProfileService,
  Player: PlayerService,
  PlayerSport: PlayerSportService,
  Rating: RatingService,
  RatingScore: RatingScoreService,
  Availability: AvailabilityService,
  Onboarding: OnboardingService,
};
