/**
 * Player Service
 * Handles player search and related operations.
 */

import { supabase } from '../supabase';

// =============================================================================
// HOME LOCATION TYPES
// =============================================================================

export interface HomeLocation {
  /** Normalized postal code */
  postalCode: string;
  /** Country code: 'CA' or 'US' */
  country: 'CA' | 'US';
  /** Latitude of postal code centroid */
  latitude: number;
  /** Longitude of postal code centroid */
  longitude: number;
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Filter types for player search
 */
export type GenderFilter = 'all' | 'male' | 'female' | 'other';
export type AvailabilityFilter = 'all' | 'morning' | 'afternoon' | 'evening';
export type DayFilter =
  | 'all'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';
export type PlayStyleFilter =
  | 'all'
  | 'counterpuncher'
  | 'aggressive_baseliner'
  | 'serve_and_volley'
  | 'all_court';
export type SkillLevelFilter = 'all' | string; // '1.0', '1.5', etc.
export type DistanceFilter = 'all' | number; // 5, 10, 15, etc.

export interface PlayerFilters {
  favorites?: boolean;
  blocked?: boolean;
  gender?: GenderFilter;
  skillLevel?: SkillLevelFilter;
  maxDistance?: DistanceFilter;
  availability?: AvailabilityFilter;
  day?: DayFilter;
  playStyle?: PlayStyleFilter;
}

/**
 * Player search result with profile and sport-specific rating
 */
export interface PlayerSearchResult {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  profile_picture_url: string | null;
  city: string | null;
  /** Player's gender */
  gender: string | null;
  /** Sport-specific rating (null if player has no rating for this sport) */
  rating: {
    label: string;
    value: number | null;
  } | null;
  /** Player's latitude (from home location) */
  latitude: number | null;
  /** Player's longitude (from home location) */
  longitude: number | null;
  /** Distance in meters from the searching user's location (null if location not provided) */
  distance_meters: number | null;
}

/**
 * Paginated response for player search
 */
export interface PlayersPage {
  players: PlayerSearchResult[];
  hasMore: boolean;
  nextOffset: number | null;
}

/**
 * Parameters for searching players
 */
export interface SearchPlayersParams {
  /** Sport ID to filter players by (required - only shows active players in this sport) */
  sportId: string;
  /** Current user ID to exclude from results (optional - for guest users) */
  currentUserId?: string;
  /** Search query for name matching */
  searchQuery?: string;
  /** Pagination offset */
  offset?: number;
  /** Number of results per page */
  limit?: number;
  /** Player IDs to exclude (e.g., already invited players) */
  excludePlayerIds?: string[];
  /** Filters to apply */
  filters?: PlayerFilters;
  /** Favorite player IDs (to filter by favorites) */
  favoritePlayerIds?: string[];
  /** Blocked player IDs (to filter by blocked or exclude blocked) */
  blockedPlayerIds?: string[];
  /** User's current latitude (for distance calculation) */
  latitude?: number;
  /** User's current longitude (for distance calculation) */
  longitude?: number;
}

// =============================================================================
// SERVICE FUNCTIONS
// =============================================================================

/**
 * Search for players active in a specific sport.
 * Returns players with their profile info and sport-specific rating.
 *
 * @param params - Search parameters
 * @returns Paginated list of players matching the criteria
 */
export async function searchPlayersForSport(params: SearchPlayersParams): Promise<PlayersPage> {
  const {
    sportId,
    currentUserId,
    searchQuery,
    offset = 0,
    limit = 20,
    excludePlayerIds = [],
    filters = {},
    favoritePlayerIds = [],
    blockedPlayerIds = [],
    latitude,
    longitude,
  } = params;

  // Step 1: Get player IDs that are active in this sport
  // Using player_sport table which links players to their sports
  let sportQuery = supabase
    .from('player_sport')
    .select('player_id')
    .eq('sport_id', sportId)
    .or('is_active.is.null,is_active.eq.true'); // Include null (default) or true

  // Exclude current user if provided (for authenticated users)
  if (currentUserId) {
    sportQuery = sportQuery.neq('player_id', currentUserId);
  }

  const { data: playerSports, error: sportError } = await sportQuery;

  if (sportError) {
    throw new Error(`Failed to fetch player sports: ${sportError.message}`);
  }

  if (!playerSports || playerSports.length === 0) {
    return { players: [], hasMore: false, nextOffset: null };
  }

  // Get unique player IDs from player_sport records
  let playerIds = playerSports.map(ps => ps.player_id);

  // Filter out excluded players
  if (excludePlayerIds.length > 0) {
    playerIds = playerIds.filter(id => !excludePlayerIds.includes(id));
  }

  // Filter by favorites if enabled
  if (filters.favorites && favoritePlayerIds.length > 0) {
    playerIds = playerIds.filter(id => favoritePlayerIds.includes(id));
  } else if (filters.favorites && favoritePlayerIds.length === 0) {
    // No favorites, return empty
    return { players: [], hasMore: false, nextOffset: null };
  }

  // Handle blocked players:
  // - If blocked filter is ON: show only blocked players
  // - If blocked filter is OFF: exclude blocked players from results (default behavior)
  if (filters.blocked && blockedPlayerIds.length > 0) {
    // Show only blocked players
    playerIds = playerIds.filter(id => blockedPlayerIds.includes(id));
  } else if (filters.blocked && blockedPlayerIds.length === 0) {
    // No blocked players, return empty
    return { players: [], hasMore: false, nextOffset: null };
  } else if (!filters.blocked && blockedPlayerIds.length > 0) {
    // Exclude blocked players from results (default behavior)
    playerIds = playerIds.filter(id => !blockedPlayerIds.includes(id));
  }

  if (playerIds.length === 0) {
    return { players: [], hasMore: false, nextOffset: null };
  }

  // Step 2: Apply gender filter by fetching player data
  // Filter by gender if specified (gender is on player table)
  if (filters.gender && filters.gender !== 'all') {
    const { data: genderFilteredPlayers, error: genderError } = await supabase
      .from('player')
      .select('id')
      .in('id', playerIds)
      .eq('gender', filters.gender);

    if (genderError) {
      console.error('[searchPlayersForSport] Error filtering by gender:', genderError);
    } else if (genderFilteredPlayers) {
      playerIds = genderFilteredPlayers.map(p => p.id);
    }

    if (playerIds.length === 0) {
      return { players: [], hasMore: false, nextOffset: null };
    }
  }

  // Step 3: Apply distance filter if specified
  // Filter players whose max_travel_distance is >= the selected distance
  if (filters.maxDistance && filters.maxDistance !== 'all') {
    const distanceValue =
      typeof filters.maxDistance === 'number'
        ? filters.maxDistance
        : parseInt(String(filters.maxDistance), 10);

    if (!isNaN(distanceValue)) {
      const { data: distanceFilteredPlayers, error: distanceError } = await supabase
        .from('player')
        .select('id')
        .in('id', playerIds)
        .gte('max_travel_distance', distanceValue);

      if (distanceError) {
        console.error('[searchPlayersForSport] Error filtering by distance:', distanceError);
      } else if (distanceFilteredPlayers) {
        playerIds = distanceFilteredPlayers.map(p => p.id);
      }

      if (playerIds.length === 0) {
        return { players: [], hasMore: false, nextOffset: null };
      }
    }
  }

  // Step 4: Apply availability filter if specified
  if (filters.availability && filters.availability !== 'all') {
    const { data: availabilityPlayers, error: availError } = await supabase
      .from('player_availability')
      .select('player_id')
      .in('player_id', playerIds)
      .eq('period', filters.availability)
      .or('is_active.is.null,is_active.eq.true');

    if (availError) {
      console.error('[searchPlayersForSport] Error filtering by availability:', availError);
    } else if (availabilityPlayers) {
      const availablePlayerIds = [...new Set(availabilityPlayers.map(p => p.player_id))];
      playerIds = playerIds.filter(id => availablePlayerIds.includes(id));
    }

    if (playerIds.length === 0) {
      return { players: [], hasMore: false, nextOffset: null };
    }
  }

  // Step 4b: Apply day filter if specified
  if (filters.day && filters.day !== 'all') {
    const { data: dayFilteredPlayers, error: dayError } = await supabase
      .from('player_availability')
      .select('player_id')
      .in('player_id', playerIds)
      .eq('day', filters.day)
      .or('is_active.is.null,is_active.eq.true');

    if (dayError) {
      console.error('[searchPlayersForSport] Error filtering by day:', dayError);
    } else if (dayFilteredPlayers) {
      const dayPlayerIds = [...new Set(dayFilteredPlayers.map(p => p.player_id))];
      playerIds = playerIds.filter(id => dayPlayerIds.includes(id));
    }

    if (playerIds.length === 0) {
      return { players: [], hasMore: false, nextOffset: null };
    }
  }

  // Step 5: Apply play style filter if specified
  // Uses player_sport.preferred_play_style enum column directly
  if (filters.playStyle && filters.playStyle !== 'all') {
    const { data: styledPlayers, error: styledError } = await supabase
      .from('player_sport')
      .select('player_id')
      .in('player_id', playerIds)
      .eq('sport_id', sportId)
      .eq('preferred_play_style', filters.playStyle);

    if (styledError) {
      console.error('[searchPlayersForSport] Error filtering by play style:', styledError);
    } else if (styledPlayers) {
      const styledPlayerIds = styledPlayers.map(p => p.player_id);
      playerIds = playerIds.filter(id => styledPlayerIds.includes(id));
    }

    if (playerIds.length === 0) {
      return { players: [], hasMore: false, nextOffset: null };
    }
  }

  // Step 6: Apply skill level filter - we need to fetch ratings first
  const ratingsMap: Record<string, { label: string; value: number | null }> = {};
  let skillFilteredPlayerIds = playerIds;

  // Always fetch ratings (we need them for the result anyway)
  const { data: ratingsData, error: ratingsError } = await supabase
    .from('player_rating_score')
    .select(
      `
      player_id,
      rating_score!player_rating_scores_rating_score_id_fkey!inner (
        label,
        value,
        rating_system!inner (
          sport_id
        )
      )
    `
    )
    .in('player_id', playerIds);

  if (ratingsError) {
    console.error('[searchPlayersForSport] Error fetching ratings:', ratingsError);
  }

  if (!ratingsError && ratingsData) {
    type RatingResult = {
      player_id: string;
      rating_score: {
        label: string;
        value: number | null;
        rating_system: { sport_id: string };
      };
    };

    (ratingsData as unknown as RatingResult[]).forEach(rating => {
      const ratingScore = rating.rating_score;
      const ratingSystem = ratingScore?.rating_system;
      // Only include ratings for the requested sport
      if (ratingSystem?.sport_id === sportId && ratingScore?.label) {
        ratingsMap[rating.player_id] = {
          label: ratingScore.label,
          value: ratingScore.value,
        };
      }
    });
  }

  // Apply skill level filter if specified
  if (filters.skillLevel && filters.skillLevel !== 'all') {
    const targetLevel = parseFloat(filters.skillLevel);
    if (!isNaN(targetLevel)) {
      // Filter to players with rating >= target level
      skillFilteredPlayerIds = playerIds.filter(id => {
        const rating = ratingsMap[id];
        return rating && rating.value !== null && rating.value >= targetLevel;
      });
      playerIds = skillFilteredPlayerIds;
    }
  }

  if (playerIds.length === 0) {
    return { players: [], hasMore: false, nextOffset: null };
  }

  // Step 7: If searching, find player IDs matching city and union with name-matched profile IDs
  if (searchQuery && searchQuery.trim().length > 0) {
    const searchTerm = `%${searchQuery.trim()}%`;

    // Find IDs matching city in player table
    const { data: cityMatches } = await supabase
      .from('player')
      .select('id')
      .in('id', playerIds)
      .ilike('city', searchTerm);

    // Find IDs matching name in profile table
    const { data: nameMatches } = await supabase
      .from('profile')
      .select('id')
      .in('id', playerIds)
      .or('is_active.is.null,is_active.eq.true')
      .or(
        `first_name.ilike.${searchTerm},last_name.ilike.${searchTerm},display_name.ilike.${searchTerm}`
      );

    // Union the matched IDs
    const matchedIds = new Set<string>();
    cityMatches?.forEach(p => matchedIds.add(p.id));
    nameMatches?.forEach(p => matchedIds.add(p.id));

    // Narrow playerIds to only matched ones
    playerIds = playerIds.filter(id => matchedIds.has(id));

    if (playerIds.length === 0) {
      return { players: [], hasMore: false, nextOffset: null };
    }
  }

  // Step 8: Fetch profiles (paginated)
  const { data: profiles, error: profileError } = await supabase
    .from('profile')
    .select('id, first_name, last_name, display_name, profile_picture_url')
    .in('id', playerIds)
    .or('is_active.is.null,is_active.eq.true')
    .order('first_name', { ascending: true })
    .range(offset, offset + limit); // Fetch one extra to check if more exist

  if (profileError) {
    throw new Error(`Failed to fetch profiles: ${profileError.message}`);
  }

  if (!profiles || profiles.length === 0) {
    return { players: [], hasMore: false, nextOffset: null };
  }

  // Check if there are more results
  const hasMore = profiles.length > limit;
  const resultsToReturn = hasMore ? profiles.slice(0, limit) : profiles;
  const profileIdsToFetch = resultsToReturn.map(p => p.id);

  // Fetch gender, city, and location data for profiles
  const genderMap: Record<string, string | null> = {};
  const cityMap: Record<string, string | null> = {};
  const latitudeMap: Record<string, number | null> = {};
  const longitudeMap: Record<string, number | null> = {};
  const { data: playerData, error: playerError } = await supabase
    .from('player')
    .select('id, gender, city, latitude, longitude')
    .in('id', profileIdsToFetch);

  if (!playerError && playerData) {
    playerData.forEach(p => {
      genderMap[p.id] = p.gender;
      cityMap[p.id] = p.city;
      latitudeMap[p.id] = p.latitude;
      longitudeMap[p.id] = p.longitude;
    });
  }

  // Step 9: Combine profiles with ratings, gender, city, and distance
  const players: PlayerSearchResult[] = resultsToReturn.map(profile => {
    const playerLat = latitudeMap[profile.id];
    const playerLon = longitudeMap[profile.id];

    // Calculate distance using Haversine formula if both locations are available
    let distanceMeters: number | null = null;
    if (
      latitude !== undefined &&
      longitude !== undefined &&
      playerLat != null &&
      playerLon != null
    ) {
      const R = 6371000; // Earth's radius in meters
      const lat1Rad = (latitude * Math.PI) / 180;
      const lat2Rad = (playerLat * Math.PI) / 180;
      const deltaLat = ((playerLat - latitude) * Math.PI) / 180;
      const deltaLon = ((playerLon - longitude) * Math.PI) / 180;

      const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      distanceMeters = R * c;
    }

    return {
      id: profile.id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      display_name: profile.display_name,
      profile_picture_url: profile.profile_picture_url,
      city: cityMap[profile.id] ?? null,
      gender: genderMap[profile.id] ?? null,
      rating: ratingsMap[profile.id] ?? null,
      latitude: playerLat ?? null,
      longitude: playerLon ?? null,
      distance_meters: distanceMeters,
    };
  });

  return {
    players,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}

// =============================================================================
// HOME LOCATION SYNC
// =============================================================================

/**
 * Sync home location to the player table.
 * Called after user authentication to persist postal code location.
 *
 * @param playerId - The player's user ID
 * @param location - The home location data from pre-onboarding
 * @returns Success status
 */
export async function syncHomeLocation(
  playerId: string,
  location: HomeLocation
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('player')
      .update({
        postal_code: location.postalCode,
        country: location.country,
        latitude: location.latitude,
        longitude: location.longitude,
      })
      .eq('id', playerId);

    if (error) {
      console.error('[PlayerService] Failed to sync home location:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PlayerService] Error syncing home location:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Get player's home location from the database.
 *
 * @param playerId - The player's user ID
 * @returns The home location or null if not set
 */
export async function getHomeLocation(playerId: string): Promise<HomeLocation | null> {
  try {
    const { data, error } = await supabase
      .from('player')
      .select('postal_code, country, latitude, longitude')
      .eq('id', playerId)
      .single();

    if (error || !data) {
      return null;
    }

    if (!data.postal_code || !data.country || !data.latitude || !data.longitude) {
      return null;
    }

    return {
      postalCode: data.postal_code,
      country: data.country as 'CA' | 'US',
      latitude: data.latitude,
      longitude: data.longitude,
    };
  } catch (error) {
    console.error('[PlayerService] Error fetching home location:', error);
    return null;
  }
}
