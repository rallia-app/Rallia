/**
 * Group Service - Main Barrel File
 *
 * Re-exports all group-related functions and types from modular service files.
 * This maintains backward compatibility with existing imports.
 *
 * Module Structure:
 * - groupTypes.ts          - Type definitions
 * - groupCrudService.ts    - Group CRUD operations
 * - memberService.ts       - Member management (add, remove, promote, demote)
 * - groupActivityService.ts - Activity logging and statistics
 * - groupInviteService.ts  - Invite code operations
 * - groupMatchService.ts   - Match/game operations and leaderboards
 * - playedMatchService.ts  - Create played matches and score confirmation
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
  Group,
  GroupMember,
  GroupWithMembers,
  GroupActivity,
  GroupStats,
  CreateGroupInput,
  UpdateGroupInput,
  MatchSet,
  GroupMatch,
  LeaderboardEntry,
  SetScore,
  CreatePlayedMatchInput,
  PendingScoreConfirmation,
} from './groupTypes';

// ============================================================================
// GROUP CRUD OPERATIONS
// ============================================================================

export {
  getPlayerGroupTypeId,
  createGroup,
  getGroup,
  getGroupWithMembers,
  getPlayerGroups,
  updateGroup,
  deleteGroup,
} from './groupCrudService';

// ============================================================================
// MEMBER MANAGEMENT
// ============================================================================

export {
  isGroupModerator,
  isGroupMember,
  getGroupModeratorIds,
  getGroupMemberInfo,
  addGroupMember,
  removeGroupMember,
  leaveGroup,
  promoteMember,
  demoteMember,
} from './memberService';

// ============================================================================
// ACTIVITY & STATS
// ============================================================================

export { logGroupActivity, getGroupActivity, getGroupStats } from './groupActivityService';

// ============================================================================
// INVITE OPERATIONS
// ============================================================================

export {
  getOrCreateGroupInviteCode,
  joinGroupByInviteCode,
  resetGroupInviteCode,
  getGroupInviteLink,
} from './groupInviteService';

// ============================================================================
// MATCH OPERATIONS
// ============================================================================

export {
  getGroupMatches,
  getMostRecentGroupMatch,
  getGroupLeaderboard,
  postMatchToGroup,
  removeMatchFromGroup,
  getNetworkMemberUpcomingMatches,
  type NetworkMemberMatch,
} from './groupMatchService';

// ============================================================================
// PLAYED MATCH & SCORE CONFIRMATION
// ============================================================================

export {
  createPlayedMatch,
  getSportIdByName,
  submitMatchResultForMatch,
  getPendingScoreConfirmations,
  confirmMatchScore,
  proposeRebuttalScore,
  acceptRebuttalScore,
  disputeRebuttalScore,
  notifyOpponentsOfPendingScore,
  type SubmitMatchResultForMatchParams,
} from './playedMatchService';
