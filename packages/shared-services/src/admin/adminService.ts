/**
 * Admin Service
 *
 * Provides admin-level data access for user management, analytics,
 * and moderation capabilities.
 */

import { supabase } from '../supabase';

// =============================================================================
// TYPES
// =============================================================================

/** User status for admin filtering */
export type AdminUserStatus = 'all' | 'active' | 'inactive' | 'banned';

/** Admin user filters */
export interface AdminUserFilters {
  status?: AdminUserStatus;
  sportId?: string;
  searchQuery?: string;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  hasBan?: boolean;
}

/** Extended user info for admin view */
export interface AdminUserInfo {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  profile_picture_url: string | null;
  city: string | null;
  country: string | null;
  phone_number: string | null;
  gender: string | null;
  date_of_birth: string | null;
  created_at: string;
  updated_at: string | null;
  last_sign_in_at: string | null;
  onboarding_completed: boolean;
  is_active: boolean;
  // Computed fields
  sports_count: number;
  matches_count: number;
  active_ban: AdminBanInfo | null;
}

/** Ban information */
export interface AdminBanInfo {
  id: string;
  reason: string;
  ban_type: 'temporary' | 'permanent';
  banned_by_admin_id: string;
  banned_at: string;
  expires_at: string | null;
  notes: string | null;
  is_active: boolean;
}

/** Paginated admin users response */
export interface AdminUsersPage {
  users: AdminUserInfo[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number | null;
}

/** Parameters for fetching admin users */
export interface FetchAdminUsersParams {
  offset?: number;
  limit?: number;
  filters?: AdminUserFilters;
  sortBy?: 'created_at' | 'last_sign_in_at' | 'display_name';
  sortOrder?: 'asc' | 'desc';
}

/** Ban action parameters */
export interface BanUserParams {
  playerId: string;
  adminId: string;
  reason: string;
  banType: 'temporary' | 'permanent';
  expiresAt?: string;
  notes?: string;
}

/** User detail for admin view */
export interface AdminUserDetail extends AdminUserInfo {
  // Player info
  player_id: string | null;
  playing_hand: string | null;
  // Sport profiles
  sport_profiles: AdminSportProfile[];
  // Recent matches
  recent_matches: AdminMatchSummary[];
  // Ban history
  ban_history: AdminBanInfo[];
}

/** Sport profile for admin view */
export interface AdminSportProfile {
  id: string;
  sport_id: string;
  sport_name: string;
  skill_level: number | null;
  rating_label: string | null;
  is_verified: boolean;
  created_at: string;
  // Rating certification fields
  player_rating_score_id: string | null;
  is_certified: boolean;
  badge_status: 'self_declared' | 'certified' | 'disputed';
  certified_at: string | null;
  certified_via: 'admin' | 'external_rating' | 'proof' | 'referrals' | null;
}

/** Match summary for admin view */
export interface AdminMatchSummary {
  id: string;
  sport_id: string;
  sport_name: string;
  match_type: string;
  scheduled_at: string;
  status: string;
  participant_count: number;
}

/** Editable profile fields */
export interface EditableProfileFields {
  first_name?: string;
  last_name?: string;
  display_name?: string;
  email?: string;
  phone?: string;
  bio?: string;
  city?: string;
  country?: string;
  gender?: string;
  birth_date?: string;
}

/** Admin audit log entry */
export interface AdminAuditLogEntry {
  id: string;
  admin_id: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// =============================================================================
// SERVICE FUNCTIONS
// =============================================================================

/**
 * Fetch users with admin-level access (all user data)
 */
export async function fetchAdminUsers(params: FetchAdminUsersParams): Promise<AdminUsersPage> {
  const {
    offset = 0,
    limit = 20,
    filters = {},
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = params;

  try {
    // Build the query for profiles with player data
    // Note: gender, city, country are in player table, not profile
    let query = supabase.from('profile').select(
      `
        id,
        email,
        first_name,
        last_name,
        display_name,
        profile_picture_url,
        phone,
        birth_date,
        created_at,
        updated_at,
        last_active_at,
        onboarding_completed,
        player:player(id, gender, city, country)
      `,
      { count: 'exact' }
    );

    // Apply search filter
    if (filters.searchQuery && filters.searchQuery.trim()) {
      const searchTerm = `%${filters.searchQuery.trim()}%`;
      query = query.or(
        `first_name.ilike.${searchTerm},last_name.ilike.${searchTerm},display_name.ilike.${searchTerm},email.ilike.${searchTerm}`
      );
    }

    // Apply date range filter
    if (filters.dateRangeStart) {
      query = query.gte('created_at', filters.dateRangeStart);
    }
    if (filters.dateRangeEnd) {
      query = query.lte('created_at', filters.dateRangeEnd);
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: profiles, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch users: ${error.message}`);
    }

    // Get additional data for each user (sport count, match count, active ban)
    const users: AdminUserInfo[] = await Promise.all(
      (profiles || []).map(async profile => {
        // Get sports count
        const { count: sportsCount } = await supabase
          .from('player_sport')
          .select('id', { count: 'exact', head: true })
          .eq('player_id', profile.id);

        // Get matches count
        const { count: matchesCount } = await supabase
          .from('match_participant')
          .select('id', { count: 'exact', head: true })
          .eq('player_id', profile.id);

        // Get active ban (if any) from player_ban table
        const activeBan = await getActivePlayerBan(profile.id);

        // Check last_active_at to determine activity
        const isActive = profile.last_active_at
          ? new Date(profile.last_active_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Active in last 30 days
          : false;

        // Extract player data (gender is in player table)
        const playerData = Array.isArray(profile.player) ? profile.player[0] : profile.player;

        return {
          id: profile.id,
          email: profile.email,
          first_name: profile.first_name,
          last_name: profile.last_name,
          display_name: profile.display_name,
          profile_picture_url: profile.profile_picture_url,
          city: playerData?.city || null,
          country: playerData?.country || null,
          phone_number: profile.phone,
          gender: playerData?.gender || null,
          date_of_birth: profile.birth_date,
          created_at: profile.created_at,
          updated_at: profile.updated_at,
          last_sign_in_at: profile.last_active_at,
          onboarding_completed: profile.onboarding_completed ?? false,
          is_active: isActive,
          sports_count: sportsCount || 0,
          matches_count: matchesCount || 0,
          active_ban: activeBan,
        };
      })
    );

    // Filter by status if needed
    let filteredUsers = users;
    if (filters.status && filters.status !== 'all') {
      filteredUsers = users.filter(user => {
        if (filters.status === 'active') return user.is_active;
        if (filters.status === 'inactive') return !user.is_active && !user.active_ban;
        if (filters.status === 'banned') return !!user.active_ban;
        return true;
      });
    }

    const totalCount = count || 0;
    const hasMore = offset + limit < totalCount;

    return {
      users: filteredUsers,
      totalCount,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    };
  } catch (error) {
    console.error('Error fetching admin users:', error);
    throw error;
  }
}

/**
 * Fetch detailed user info for admin view
 */
export async function fetchAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
  try {
    // Get profile
    // Note: gender, city, country are in player table, not profile
    const { data: profile, error: profileError } = await supabase
      .from('profile')
      .select(
        `
        id,
        email,
        first_name,
        last_name,
        display_name,
        profile_picture_url,
        phone,
        birth_date,
        created_at,
        updated_at,
        last_active_at,
        onboarding_completed,
        player:player(id, playing_hand, gender, city, country)
      `
      )
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return null;
    }

    // Extract player.id from profile (player_sport and player_rating_score use player.id, not profile.id)
    const playerData = Array.isArray(profile.player) ? profile.player[0] : profile.player;
    const playerId = playerData?.id;

    // Get sport profiles (using player.id, not profile.id)
    const { data: sportProfiles } = playerId
      ? await supabase
          .from('player_sport')
          .select(
            `
        id,
        sport_id,
        is_primary,
        is_active,
        created_at,
        sport:sport(name)
      `
          )
          .eq('player_id', playerId)
      : { data: null };

    // Get player ratings (separate query - no direct FK to player_sport)
    const { data: playerRatings } = playerId
      ? await supabase
          .from('player_rating_score')
          .select(
            `
        id,
        is_certified,
        badge_status,
        certified_at,
        certified_via,
        rating_score:rating_score_id (
          value,
          label,
          rating_system:rating_system_id (
            sport_id
          )
        )
      `
          )
          .eq('player_id', playerId)
      : { data: null };

    // Get recent matches (last 10) - using playerId
    const { data: matches } = playerId
      ? await supabase
          .from('match_participant')
          .select(
            `
        match:match(
          id,
          sport_id,
          match_type,
          scheduled_at,
          status,
          sport:sport(name)
        )
      `
          )
          .eq('player_id', playerId)
          .order('created_at', { ascending: false })
          .limit(10)
      : { data: null };

    // Get stats - using playerId
    const { count: sportsCount } = playerId
      ? await supabase
          .from('player_sport')
          .select('id', { count: 'exact', head: true })
          .eq('player_id', playerId)
      : { count: 0 };

    const { count: matchesCount } = playerId
      ? await supabase
          .from('match_participant')
          .select('id', { count: 'exact', head: true })
          .eq('player_id', playerId)
      : { count: 0 };

    // Get active ban (if any) from player_ban table
    const activeBan = await getActivePlayerBan(userId);

    // Get ban history from player_ban table
    const banHistory = await getPlayerBanHistory(userId);

    const isActive = profile.last_active_at
      ? new Date(profile.last_active_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      : false;

    // playerData already extracted above for player_id

    return {
      id: profile.id,
      email: profile.email,
      first_name: profile.first_name,
      last_name: profile.last_name,
      display_name: profile.display_name,
      profile_picture_url: profile.profile_picture_url,
      city: playerData?.city || null,
      country: playerData?.country || null,
      phone_number: profile.phone,
      gender: playerData?.gender || null,
      date_of_birth: profile.birth_date,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
      last_sign_in_at: profile.last_active_at,
      onboarding_completed: profile.onboarding_completed ?? false,
      is_active: isActive,
      sports_count: sportsCount || 0,
      matches_count: matchesCount || 0,
      active_ban: activeBan,
      player_id: playerData?.id || null,
      playing_hand: playerData?.playing_hand || null,
      sport_profiles: (sportProfiles || []).map(sp => {
        const sportData = Array.isArray(sp.sport) ? sp.sport[0] : sp.sport;

        // Find matching rating from playerRatings by sport_id
        const matchingRating = (playerRatings || []).find(pr => {
          const rScore = Array.isArray(pr.rating_score) ? pr.rating_score[0] : pr.rating_score;
          const rSystem = rScore?.rating_system;
          const ratingSystem = Array.isArray(rSystem) ? rSystem[0] : rSystem;
          return ratingSystem?.sport_id === sp.sport_id;
        });

        const ratingScore = matchingRating?.rating_score;
        const ratingInfo = Array.isArray(ratingScore) ? ratingScore[0] : ratingScore;

        return {
          id: sp.id,
          sport_id: sp.sport_id,
          sport_name: sportData?.name || 'Unknown',
          skill_level: ratingInfo?.value || null,
          rating_label: ratingInfo?.label || null,
          is_verified: sp.is_active ?? true,
          created_at: sp.created_at,
          // Rating certification fields
          player_rating_score_id: matchingRating?.id || null,
          is_certified: matchingRating?.is_certified ?? false,
          badge_status:
            (matchingRating?.badge_status as 'self_declared' | 'certified' | 'disputed') ||
            'self_declared',
          certified_at: matchingRating?.certified_at || null,
          certified_via:
            (matchingRating?.certified_via as
              | 'admin'
              | 'external_rating'
              | 'proof'
              | 'referrals'
              | null) || null,
        };
      }),
      recent_matches: (matches || [])
        .map(mp => {
          const match = mp.match;
          if (!match) return null;
          const matchData = Array.isArray(match) ? match[0] : match;
          const sportData = Array.isArray(matchData?.sport) ? matchData.sport[0] : matchData?.sport;
          return {
            id: matchData.id,
            sport_id: matchData.sport_id,
            sport_name: sportData?.name || 'Unknown',
            match_type: matchData.match_type,
            scheduled_at: matchData.scheduled_at,
            status: matchData.status || 'scheduled',
            participant_count: 0,
          };
        })
        .filter((m): m is AdminMatchSummary => m !== null),
      ban_history: banHistory,
    };
  } catch (error) {
    console.error('Error fetching user detail:', error);
    throw error;
  }
}

/**
 * Ban a user
 * Requires player_ban table (migration: 20260222000000_add_admin_management_tables.sql)
 */
export async function banUser(params: BanUserParams): Promise<AdminBanInfo> {
  try {
    const { playerId, adminId, reason, banType, expiresAt, notes } = params;

    // Insert ban record
    const { data: ban, error } = await supabase
      .from('player_ban')
      .insert({
        player_id: playerId,
        banned_by_admin_id: adminId,
        reason,
        ban_type: banType,
        expires_at: expiresAt || null,
        notes: notes || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error banning user:', error);
      throw new Error(`Failed to ban user: ${error.message}`);
    }

    // Log the admin action
    await logAdminAction(adminId, 'ban', 'player', playerId, null, {
      ban_id: ban.id,
      reason,
      ban_type: banType,
    });

    return {
      id: ban.id,
      reason: ban.reason,
      ban_type: ban.ban_type,
      banned_by_admin_id: ban.banned_by_admin_id,
      banned_at: ban.banned_at,
      expires_at: ban.expires_at,
      notes: ban.notes,
      is_active: ban.is_active,
    };
  } catch (error) {
    console.error('Error in banUser:', error);
    throw error;
  }
}

/**
 * Unban a user (lift an active ban)
 */
export async function unbanUser(
  banId: string,
  adminId: string,
  liftReason?: string
): Promise<void> {
  try {
    // Get the current ban to log old data
    const { data: currentBan, error: fetchError } = await supabase
      .from('player_ban')
      .select('*')
      .eq('id', banId)
      .single();

    if (fetchError || !currentBan) {
      throw new Error('Ban record not found');
    }

    if (!currentBan.is_active) {
      throw new Error('This ban is already inactive');
    }

    // Update ban to inactive
    const { error: updateError } = await supabase
      .from('player_ban')
      .update({
        is_active: false,
        lifted_at: new Date().toISOString(),
        lifted_by_admin_id: adminId,
        lift_reason: liftReason || null,
      })
      .eq('id', banId);

    if (updateError) {
      console.error('Error unbanning user:', updateError);
      throw new Error(`Failed to unban user: ${updateError.message}`);
    }

    // Log the admin action
    await logAdminAction(
      adminId,
      'unban',
      'player',
      currentBan.player_id,
      {
        ban_id: banId,
        was_active: true,
      },
      {
        ban_id: banId,
        lifted_reason: liftReason,
      }
    );
  } catch (error) {
    console.error('Error in unbanUser:', error);
    throw error;
  }
}

/**
 * Get active ban for a player
 */
export async function getActivePlayerBan(playerId: string): Promise<AdminBanInfo | null> {
  try {
    const { data, error } = await supabase
      .from('player_ban')
      .select('*')
      .eq('player_id', playerId)
      .eq('is_active', true)
      .order('banned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching active ban:', error);
      return null;
    }

    if (!data) return null;

    return {
      id: data.id,
      reason: data.reason,
      ban_type: data.ban_type,
      banned_by_admin_id: data.banned_by_admin_id,
      banned_at: data.banned_at,
      expires_at: data.expires_at,
      notes: data.notes,
      is_active: data.is_active,
    };
  } catch (error) {
    console.error('Error in getActivePlayerBan:', error);
    return null;
  }
}

/**
 * Get ban history for a player
 */
export async function getPlayerBanHistory(playerId: string): Promise<AdminBanInfo[]> {
  try {
    const { data, error } = await supabase
      .from('player_ban')
      .select('*')
      .eq('player_id', playerId)
      .order('banned_at', { ascending: false });

    if (error) {
      console.error('Error fetching ban history:', error);
      return [];
    }

    return (data || []).map(ban => ({
      id: ban.id,
      reason: ban.reason,
      ban_type: ban.ban_type,
      banned_by_admin_id: ban.banned_by_admin_id,
      banned_at: ban.banned_at,
      expires_at: ban.expires_at,
      notes: ban.notes,
      is_active: ban.is_active,
    }));
  } catch (error) {
    console.error('Error in getPlayerBanHistory:', error);
    return [];
  }
}

/**
 * Log an admin action to the audit log
 */
export async function logAdminAction(
  adminId: string,
  actionType:
    | 'view'
    | 'create'
    | 'update'
    | 'delete'
    | 'ban'
    | 'unban'
    | 'export'
    | 'login'
    | 'logout'
    | 'settings_change'
    | 'certify_rating'
    | 'invalidate_rating',
  entityType:
    | 'player'
    | 'profile'
    | 'match'
    | 'organization'
    | 'facility'
    | 'report'
    | 'conversation'
    | 'network'
    | 'admin'
    | 'system'
    | 'player_rating_score',
  entityId?: string | null,
  oldData?: Record<string, unknown> | null,
  newData?: Record<string, unknown> | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabase.from('admin_audit_log').insert({
      admin_id: adminId,
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId || null,
      old_data: oldData || null,
      new_data: newData || null,
      metadata: metadata || {},
    });

    if (error) {
      // Don't throw - audit logging failures shouldn't break the main operation
      console.error('Error logging admin action:', error);
    }
  } catch (error) {
    console.error('Error in logAdminAction:', error);
  }
}

/**
 * Get audit log entries for a specific admin or entity
 */
export async function getAuditLog(params: {
  adminId?: string;
  entityType?: string;
  entityId?: string;
  actionType?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: AdminAuditLogEntry[]; totalCount: number }> {
  try {
    const { adminId, entityType, entityId, actionType, limit = 50, offset = 0 } = params;

    let query = supabase
      .from('admin_audit_log')
      .select('*, admin:admin_id(id, role)', { count: 'exact' });

    if (adminId) query = query.eq('admin_id', adminId);
    if (entityType) query = query.eq('entity_type', entityType);
    if (entityId) query = query.eq('entity_id', entityId);
    if (actionType) query = query.eq('action_type', actionType);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching audit log:', error);
      throw error;
    }

    return {
      logs: (data || []).map(entry => ({
        id: entry.id,
        admin_id: entry.admin_id,
        action_type: entry.action_type,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        old_data: entry.old_data,
        new_data: entry.new_data,
        metadata: entry.metadata,
        created_at: entry.created_at,
      })),
      totalCount: count || 0,
    };
  } catch (error) {
    console.error('Error in getAuditLog:', error);
    return { logs: [], totalCount: 0 };
  }
}

/**
 * Update a player's profile (admin function)
 * Logs the action to audit trail
 * Note: city, country, gender are stored in player table, other fields in profile table
 */
export async function updatePlayerProfile(
  playerId: string,
  adminId: string,
  updates: EditableProfileFields
): Promise<{ success: boolean; data?: AdminUserInfo; error?: string }> {
  try {
    // Separate profile fields from player fields
    const { city, country, gender, ...profileUpdates } = updates;
    const playerUpdates: Record<string, string | undefined> = {};
    if (city !== undefined) playerUpdates.city = city;
    if (country !== undefined) playerUpdates.country = country;
    if (gender !== undefined) playerUpdates.gender = gender;

    // Get old profile data for audit
    const { data: oldProfile, error: fetchError } = await supabase
      .from('profile')
      .select('*')
      .eq('id', playerId)
      .single();

    if (fetchError) {
      return { success: false, error: `Failed to fetch profile: ${fetchError.message}` };
    }

    // Get old player data for audit (city, country, gender)
    const { data: oldPlayer } = await supabase
      .from('player')
      .select('city, country, gender')
      .eq('id', playerId)
      .single();

    let updatedProfile = oldProfile;

    // Update profile table if there are profile updates
    if (Object.keys(profileUpdates).length > 0) {
      const { data, error: updateError } = await supabase
        .from('profile')
        .update(profileUpdates)
        .eq('id', playerId)
        .select()
        .single();

      if (updateError) {
        return { success: false, error: `Failed to update profile: ${updateError.message}` };
      }
      updatedProfile = data;
    }

    // Update player table if there are player updates (city, country, gender)
    let updatedPlayer = oldPlayer;
    if (Object.keys(playerUpdates).length > 0) {
      const { data, error: playerUpdateError } = await supabase
        .from('player')
        .update(playerUpdates)
        .eq('id', playerId)
        .select('city, country, gender')
        .single();

      if (playerUpdateError) {
        return { success: false, error: `Failed to update player: ${playerUpdateError.message}` };
      }
      updatedPlayer = data;
    }

    // Log the action (include both profile and player changes)
    await logAdminAction(
      adminId,
      'update',
      'profile',
      playerId,
      { ...oldProfile, ...oldPlayer },
      { ...updatedProfile, ...updatedPlayer },
      {
        changes: updates,
        playerName: `${updatedProfile.first_name || ''} ${updatedProfile.last_name || ''}`.trim(),
      }
    );

    // Return updated user info
    // Note: gender, city, country are in player table, not profile
    return {
      success: true,
      data: {
        id: updatedProfile.id,
        email: updatedProfile.email,
        first_name: updatedProfile.first_name,
        last_name: updatedProfile.last_name,
        display_name: updatedProfile.display_name,
        profile_picture_url: updatedProfile.profile_picture_url,
        city: updatedPlayer?.city || null,
        country: updatedPlayer?.country || null,
        phone_number: updatedProfile.phone,
        gender: updatedPlayer?.gender || null,
        date_of_birth: updatedProfile.birth_date,
        created_at: updatedProfile.created_at,
        updated_at: updatedProfile.updated_at,
        last_sign_in_at: updatedProfile.last_active_at,
        onboarding_completed: updatedProfile.onboarding_completed,
        is_active: true,
        sports_count: 0,
        matches_count: 0,
        active_ban: null,
      },
    };
  } catch (error) {
    console.error('Error updating player profile:', error);
    return { success: false, error: (error as Error).message };
  }
}

/** Parameters for certifying a rating */
export interface CertifyRatingParams {
  playerRatingScoreId: string;
  adminId: string;
  action: 'certify' | 'invalidate' | 'dispute';
}

/**
 * Certify or invalidate a player's rating
 * Only admins with moderator+ role can perform this action
 */
export async function adminCertifyRating(
  params: CertifyRatingParams
): Promise<{ success: boolean; error?: string }> {
  try {
    const { playerRatingScoreId, adminId, action } = params;

    // Get current rating data for audit log
    const { data: currentRating, error: fetchError } = await supabase
      .from('player_rating_score')
      .select(
        `
        id,
        player_id,
        is_certified,
        badge_status,
        certified_at,
        certified_via,
        rating_score:rating_score_id(label)
      `
      )
      .eq('id', playerRatingScoreId)
      .single();

    if (fetchError || !currentRating) {
      return { success: false, error: 'Rating not found' };
    }

    // Extract rating label safely
    const ratingScoreData = currentRating.rating_score as unknown;
    let ratingLabel = 'Unknown';
    if (Array.isArray(ratingScoreData) && ratingScoreData[0]) {
      ratingLabel = (ratingScoreData[0] as { label?: string })?.label || 'Unknown';
    } else if (ratingScoreData && typeof ratingScoreData === 'object') {
      ratingLabel = (ratingScoreData as { label?: string })?.label || 'Unknown';
    }

    // Prepare update based on action
    let updateData;
    if (action === 'certify') {
      updateData = {
        is_certified: true,
        badge_status: 'certified',
        certified_at: new Date().toISOString(),
        certified_via: 'admin',
      };
    } else if (action === 'dispute') {
      updateData = {
        is_certified: false,
        badge_status: 'disputed',
        certified_at: null,
        certified_via: null,
      };
    } else {
      // invalidate - reset to self_declared
      updateData = {
        is_certified: false,
        badge_status: 'self_declared',
        certified_at: null,
        certified_via: null,
      };
    }

    // Update the rating
    const { error: updateError } = await supabase
      .from('player_rating_score')
      .update(updateData)
      .eq('id', playerRatingScoreId);

    if (updateError) {
      console.error('Error updating rating certification:', updateError);
      return { success: false, error: updateError.message };
    }

    // Log the admin action
    await logAdminAction(
      adminId,
      'update',
      'player',
      currentRating.player_id,
      {
        is_certified: currentRating.is_certified,
        badge_status: currentRating.badge_status,
        certified_via: currentRating.certified_via,
      },
      updateData,
      {
        player_rating_score_id: playerRatingScoreId,
        ratingLabel,
        certificationAction: action,
      }
    );

    return { success: true };
  } catch (error) {
    console.error('Error in adminCertifyRating:', error);
    return { success: false, error: (error as Error).message };
  }
}

export default {
  fetchAdminUsers,
  fetchAdminUserDetail,
  banUser,
  unbanUser,
  getActivePlayerBan,
  getPlayerBanHistory,
  logAdminAction,
  getAuditLog,
  updatePlayerProfile,
  adminCertifyRating,
};
