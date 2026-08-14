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
 * @property sport_id - Optional sport association (null = both sports)
 * @property min_rating_score_id - Minimum rating score required to join (null = no requirement)
 * @property require_certified_rating - Whether certified (green badge) rating is required
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
  sport_id: string | null;
  min_rating_score_id: string | null;
  require_certified_rating: boolean;
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
  activity_type:
    | 'member_joined'
    | 'member_left'
    | 'member_promoted'
    | 'member_demoted'
    | 'game_created'
    | 'message_sent'
    | 'group_updated';
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
  sport_id?: string | null;
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
 * Skill rating snapshot for a player in a specific sport.
 */
export interface LeaderboardSkillRating {
  value: number;
  system_code: string;
  certification_status: 'self_declared' | 'certified' | 'disputed';
}

/**
 * Entry in a network's leaderboard.
 * @property games_played - Verified or auto-confirmed matches played in window
 * @property games_won / wins / losses - Win/loss tallies (wins is alias for games_won kept for clarity)
 * @property win_rate - 0..1, null when below MIN_GAMES_FOR_WIN_RATE
 * @property current_streak - signed streak counted from most recent match: positive=wins, negative=losses, 0 if no matches
 * @property last_match_date - ISO date of most recent counted match (used for tiebreakers)
 * @property skill_rating - rating in the network's sport, if known
 */
export interface LeaderboardEntry {
  player_id: string;
  games_played: number;
  games_won: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  current_streak: number;
  last_match_date: string | null;
  skill_rating: LeaderboardSkillRating | null;
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
// NETWORK PULSE (story-driven leaderboard payload)
// ============================================================================

/**
 * Generic translation reference: a translation key + the parameters needed to
 * interpolate it. Server returns these so the client renders localized copy.
 */
export interface I18nRef {
  title_key: string;
  title_params?: Record<string, string | number>;
}

export type LeaderboardOutcome = 'W' | 'L';

export interface NetworkPulseSkillRating {
  value: number;
  system_code: string;
  certification_status: 'self_declared' | 'certified' | 'disputed';
}

export interface NetworkPulseHeadlineInsight extends I18nRef {
  type:
    | 'hot_streak'
    | 'first_time_beat'
    | 'new_face'
    | 'activity_spike'
    | 'comeback'
    | 'player_of_week'
    | 'quiet';
  primary_player_id?: string | null;
  secondary_player_id?: string | null;
}

export interface NetworkPulseFormStripEntry {
  player_id: string;
  first_name: string;
  last5: LeaderboardOutcome[];
  current_streak: number;
}

export interface NetworkPulseLeaderboardEntry {
  player_id: string;
  first_name: string;
  last_name: string | null;
  profile_picture_url: string | null;
  games_played: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  current_streak: number;
  last_match_date: string | null;
  last5: LeaderboardOutcome[];
  skill_rating: NetworkPulseSkillRating | null;
}

export interface NetworkPulseSettlingInEntry {
  player_id: string;
  first_name: string;
  last_name: string | null;
  profile_picture_url: string | null;
  games_played: number;
  skill_rating: NetworkPulseSkillRating | null;
}

export interface NetworkPulsePersonalRecord extends I18nRef {
  type: 'biggest_beat' | 'best_streak' | 'best_comeback' | 'fastest_win';
  opponent_id?: string;
  opponent_name?: string;
  opponent_rating?: number | null;
  happened_at?: string;
  streak_len?: number;
  start_date?: string;
  end_date?: string;
}

export interface NetworkPulseSetStats {
  first_set_win_pct: number | null;
  third_set_win_pct: number | null;
  sets_won_pct: number | null;
  tiebreaks: { wins: number; losses: number } | null;
}

export interface NetworkPulseScoreDistEntry {
  set_score: string;
  count: number;
}

export interface NetworkPulseHeatmapDay {
  date: string;
  match_count: number;
}

export interface NetworkPulseMatchupExtreme {
  opponent_id: string;
  opponent_name: string;
  wins: number;
  losses: number;
}

export interface NetworkPulseYourSummary {
  rank: number | null;
  rank_total: number;
  rank_delta: number | null;
  wins: number;
  losses: number;
  current_streak: number;
  last5: LeaderboardOutcome[];
  diagnostic_key: string | null;
  diagnostic_params: Record<string, string | number>;
  next_move: null | {
    type: 'challenge_unplayed' | 'log_missing_score' | 'climb_one' | 'first_match';
    copy_key: string;
    copy_params?: Record<string, string | number>;
    target_player_id?: string;
    deep_link?: string;
  };
  stats: {
    activity_heatmap: NetworkPulseHeatmapDay[];
    personal_records: NetworkPulsePersonalRecord[];
    set_stats: NetworkPulseSetStats;
    score_distribution: NetworkPulseScoreDistEntry[];
  };
  matchup_extremes: {
    favorite: NetworkPulseMatchupExtreme | null;
    nemesis: NetworkPulseMatchupExtreme | null;
  };
}

export interface NetworkPulseUnplayedPairing {
  peer_player_id: string;
  first_name: string;
  last_name: string | null;
  profile_picture_url: string | null;
  rating_value: number | null;
  games_played: number;
}

export interface NetworkPulseRivalry {
  player_a_id: string;
  player_b_id: string;
  a_first_name: string;
  b_first_name: string;
  a_wins: number;
  b_wins: number;
  matches: number;
}

export interface NetworkPulsePowerPair {
  player_a_id: string;
  player_b_id: string;
  a_first_name: string;
  b_first_name: string;
  wins: number;
  losses: number;
}

export interface NetworkPulseMoment extends I18nRef {
  type: 'streak';
  player_id: string;
  happened_at: string;
}

export interface NetworkPulseH2HCell {
  row_player_id: string;
  col_player_id: string;
  wins: number;
  losses: number;
}

export interface NetworkPulseDiscover {
  unplayed_pairings: NetworkPulseUnplayedPairing[];
  rivalry_of_week: NetworkPulseRivalry | null;
  power_pair: NetworkPulsePowerPair | null;
  moments: NetworkPulseMoment[];
  h2h_matrix: NetworkPulseH2HCell[] | null;
}

export interface NetworkPulse {
  meta: {
    network_id: string;
    days_back: number;
    is_group: boolean;
    sport_id: string | null;
    computed_at: string;
  };
  headline_insight: NetworkPulseHeadlineInsight;
  form_strip: NetworkPulseFormStripEntry[];
  leaderboard: NetworkPulseLeaderboardEntry[];
  settling_in: NetworkPulseSettlingInEntry[];
  your_summary: NetworkPulseYourSummary | null;
  discover: NetworkPulseDiscover;
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
