/**
 * Group Types
 * All type definitions for groups/networks
 * @module groupTypes
 */

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * Represents a group/network entity
 * @property id - Unique identifier for the group
 * @property name - Display name of the group
 * @property description - Optional description of the group
 * @property is_private - Whether the group is private (invite-only)
 * @property max_members - Maximum allowed members
 * @property member_count - Current number of active members
 * @property conversation_id - Associated chat conversation ID
 * @property cover_image_url - URL to group cover image
 * @property created_by - Player ID of the creator
 * @property created_at - ISO timestamp of creation
 * @property updated_at - ISO timestamp of last update
 */
export interface Group {
  id: string;
  name: string;
  description: string | null;
  is_private: boolean;
  max_members: number | null;
  member_count: number;
  conversation_id: string | null;
  cover_image_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Represents a member within a group
 * @property id - Unique membership record ID
 * @property network_id - ID of the group this membership belongs to
 * @property player_id - ID of the player who is a member
 * @property role - 'member' for regular members, 'moderator' for admins
 * @property status - Current membership status
 * @property added_by - Player ID who added this member (null if joined directly)
 * @property joined_at - ISO timestamp when the member joined
 * @property player - Optional nested player profile data
 * @property added_by_name - Resolved display name of who added this member
 */
export interface GroupMember {
  id: string;
  network_id: string;
  player_id: string;
  role: 'member' | 'moderator';
  status: 'active' | 'pending' | 'blocked' | 'removed';
  added_by: string | null;
  joined_at: string;
  created_at: string;
  updated_at: string;
  player?: {
    id: string;
    profile?: {
      first_name: string;
      last_name: string | null;
      display_name: string | null;
      profile_picture_url: string | null;
      last_active_at: string | null;
    };
  };
  added_by_name?: string | null;
}

/**
 * Group with its active members included
 * @extends Group
 * @property members - Array of active GroupMember objects
 */
export interface GroupWithMembers extends Group {
  members: GroupMember[];
}

// ============================================================================
// ACTIVITY TYPES
// ============================================================================

/**
 * Represents an activity log entry for a group
 * Used for tracking member joins, leaves, promotions, games, etc.
 * @property id - Unique activity ID
 * @property network_id - ID of the group where activity occurred
 * @property activity_type - Type of activity that occurred
 * @property actor_id - Player who performed the action
 * @property target_id - Player/entity that was affected
 * @property metadata - Additional JSON data about the activity
 * @property created_at - ISO timestamp when activity occurred
 * @property actor - Optional nested actor profile data
 * @property added_by_name - For member_joined, the name of who invited them
 */
export interface GroupActivity {
  id: string;
  network_id: string;
  activity_type: 'member_joined' | 'member_left' | 'member_promoted' | 'member_demoted' | 'game_created' | 'message_sent' | 'group_updated';
  actor_id: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor?: {
    id: string;
    profile?: {
      first_name: string;
      last_name: string | null;
      profile_picture_url: string | null;
    };
  };
  added_by_name?: string | null;
}

/**
 * Statistics summary for a group
 * @property memberCount - Total active members
 * @property newMembersLast7Days - Members who joined in last 7 days
 * @property gamesCreatedLast7Days - Games created in last 7 days
 * @property messagesLast7Days - Messages sent in last 7 days
 */
export interface GroupStats {
  memberCount: number;
  newMembersLast7Days: number;
  gamesCreatedLast7Days: number;
  messagesLast7Days: number;
}

// ============================================================================
// INPUT TYPES
// ============================================================================

/**
 * Input for creating a new group
 * @property name - Required display name for the group
 * @property description - Optional group description
 * @property cover_image_url - Optional URL to cover image
 */
export interface CreateGroupInput {
  name: string;
  description?: string;
  cover_image_url?: string;
}

/**
 * Input for updating an existing group
 * All fields are optional - only provided fields will be updated
 * @property name - New display name
 * @property description - New description
 * @property cover_image_url - New cover image URL
 */
export interface UpdateGroupInput {
  name?: string;
  description?: string;
  cover_image_url?: string;
}

// ============================================================================
// MATCH TYPES
// ============================================================================

/**
 * Represents a single set in a match
 * @property id - Unique set ID
 * @property set_number - Set order (1, 2, 3...)
 * @property team1_score - Score for team 1
 * @property team2_score - Score for team 2
 */
export interface MatchSet {
  id: string;
  set_number: number;
  team1_score: number;
  team2_score: number;
}

/**
 * A match that has been posted to a group
 * Contains full match details including participants and results
 * @property id - Network match record ID
 * @property match_id - ID of the underlying match
 * @property network_id - ID of the group this was posted to
 * @property posted_by - Player ID who posted the match
 * @property posted_at - ISO timestamp when posted
 * @property match - Full match data with sport, participants, and result
 * @property posted_by_player - Profile of who posted
 */
export interface GroupMatch {
  id: string;
  match_id: string;
  network_id: string;
  posted_by: string;
  posted_at: string;
  match: {
    id: string;
    sport_id: string;
    match_date: string;
    start_time: string;
    player_expectation: 'practice' | 'competitive' | 'both';
    cancelled_at: string | null;
    format: 'singles' | 'doubles';
    created_by: string;
    sport?: {
      id: string;
      name: string;
      icon_url: string | null;
    };
    participants: Array<{
      id: string;
      player_id: string;
      team_number: number | null;
      is_host: boolean;
      player?: {
        id: string;
        profile?: {
          first_name: string;
          last_name: string | null;
          display_name: string | null;
          profile_picture_url: string | null;
        };
      };
    }>;
    result?: {
      id: string;
      winning_team: number | null;
      team1_score: number | null;
      team2_score: number | null;
      is_verified: boolean;
      sets?: MatchSet[];
    } | null;
  };
  posted_by_player?: {
    id: string;
    profile?: {
      first_name: string;
      last_name: string | null;
      display_name: string | null;
      profile_picture_url: string | null;
    };
  };
}

/**
 * Entry in a group's leaderboard
 * @property player_id - ID of the player
 * @property games_played - Total games played in this group
 * @property games_won - Total games won in this group
 * @property player - Optional nested player profile data
 */
export interface LeaderboardEntry {
  player_id: string;
  games_played: number;
  games_won: number;
  player?: {
    id: string;
    profile?: {
      first_name: string;
      last_name: string | null;
      display_name: string | null;
      profile_picture_url: string | null;
    };
  };
}

// ============================================================================
// PLAYED MATCH INPUT TYPES
// ============================================================================

/**
 * Score for a single set
 * @property team1Score - Score for team 1 (null if not set)
 * @property team2Score - Score for team 2 (null if not set)
 */
export interface SetScore {
  team1Score: number | null;
  team2Score: number | null;
}

/**
 * Input for creating a played match (past match entry)
 * Used when users want to record a match that has already been played
 * @property sportId - ID of the sport played
 * @property createdBy - Player ID of the creator
 * @property matchDate - Date played in YYYY-MM-DD format
 * @property format - 'singles' (1v1) or 'doubles' (2v2)
 * @property expectation - 'friendly' or 'competitive'
 * @property locationName - Optional venue name
 * @property team1PlayerIds - Player IDs for team 1 (creator's team)
 * @property team2PlayerIds - Player IDs for team 2 (opponents)
 * @property winnerId - Which team won
 * @property sets - Array of set scores
 * @property networkId - Optional group to post the match to
 */
export interface CreatePlayedMatchInput {
  // Required
  sportId: string;
  createdBy: string;
  matchDate: string; // YYYY-MM-DD format
  
  // Match format
  format: 'singles' | 'doubles';
  expectation: 'friendly' | 'competitive';
  
  // Location (optional)
  locationName?: string;
  
  // Participants
  team1PlayerIds: string[]; // Current user + partner for doubles
  team2PlayerIds: string[]; // Opponent(s)
  
  // Results (only for competitive)
  winnerId: 'team1' | 'team2';
  sets: SetScore[];
  
  // Optional: Post to a group
  networkId?: string;
}

// ============================================================================
// SCORE CONFIRMATION TYPES
// ============================================================================

/**
 * Represents a match result awaiting confirmation from opponents
 * Used in the score confirmation flow where opponents must verify results
 * @property match_result_id - ID of the match result record
 * @property match_id - ID of the match
 * @property match_date - Date the match was played
 * @property sport_name - Name of the sport
 * @property sport_icon_url - URL to sport icon
 * @property winning_team - Team number that won (1 or 2)
 * @property team1_score - Final score for team 1
 * @property team2_score - Final score for team 2
 * @property submitted_by_id - Player who submitted the score
 * @property submitted_by_name - Display name of submitter
 * @property submitted_by_avatar - Avatar URL of submitter
 * @property confirmation_deadline - ISO timestamp when auto-confirmation happens
 * @property opponent_name - Name of the opponent
 * @property opponent_avatar - Avatar URL of opponent
 * @property player_team - Which team the viewing player is on
 * @property network_id - Optional group the match was posted to
 * @property network_name - Optional name of the group
 */
export interface PendingScoreConfirmation {
  match_result_id: string;
  match_id: string;
  match_date: string;
  sport_name: string;
  sport_icon_url: string | null;
  winning_team: number;
  team1_score: number;
  team2_score: number;
  submitted_by_id: string;
  submitted_by_name: string;
  submitted_by_avatar: string | null;
  confirmation_deadline: string;
  opponent_name: string;
  opponent_avatar: string | null;
  player_team: number;
  network_id: string | null;
  network_name: string | null;
}
