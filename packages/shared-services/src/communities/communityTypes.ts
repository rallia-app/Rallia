/**
 * Community Types
 * Type definitions for communities
 * Communities extend the network system with public visibility and unlimited members
 * @module communityTypes
 */

import type {
  Group,
  GroupMember,
  GroupActivity,
  GroupStats,
  GroupMatch,
} from '../groups/groupTypes';

// ============================================================================
// NETWORK TYPE ENUM
// ============================================================================

/**
 * Network type identifier
 */
export type NetworkType = 'player_group' | 'community' | 'club' | 'league' | 'team';

/**
 * How a member was added to the network
 */
export type MemberRequestType = 'direct_add' | 'join_request' | 'member_referral' | 'invite_code';

// ============================================================================
// COMMUNITY TYPES (extends Group)
// ============================================================================

/**
 * Community entity - extends Group with public visibility
 * Communities can be public (visible to all) or private (invitation only)
 * Communities have no member limit
 */
export interface Community extends Omit<Group, 'max_members'> {
  /** Whether the community is publicly discoverable */
  is_public: boolean;
  /** Communities have no member limit (null means unlimited) */
  max_members: null;
}

/**
 * Community with membership status for discovery list
 * Shows whether the current user is a member and their status
 */
export interface CommunityWithStatus extends Community {
  /** Whether the current user is a member */
  is_member: boolean;
  /** User's membership status if member */
  membership_status: 'active' | 'pending' | 'blocked' | 'removed' | null;
  /** User's role if member */
  membership_role: 'member' | 'moderator' | null;
}

/**
 * Community member - same as GroupMember but with request_type
 */
export interface CommunityMember extends GroupMember {
  /** How this member was added */
  request_type: MemberRequestType;
}

/**
 * Community with its active members included
 */
export interface CommunityWithMembers extends Community {
  members: CommunityMember[];
}

/**
 * Pending member request for a community
 */
export interface PendingMemberRequest {
  id: string;
  player_id: string;
  request_type: MemberRequestType;
  added_by: string | null;
  created_at: string;
  player_name: string;
  player_profile_picture: string | null;
  referrer_name: string | null;
}

/**
 * Community access check result
 * Returned by check_community_access RPC
 */
export interface CommunityAccessResult {
  /** Whether the user can access full community features */
  can_access: boolean;
  /** Whether the user is an active member */
  is_member: boolean;
  /** User's membership status (active, pending, blocked, removed, or null) */
  membership_status: 'active' | 'pending' | 'blocked' | 'removed' | null;
  /** User's role if member */
  membership_role: 'member' | 'moderator' | null;
  /** Whether the community is publicly visible */
  is_public: boolean;
  /** Whether the community has at least one active moderator */
  has_active_moderator: boolean;
  /** Human-readable reason for access status */
  access_reason: string;
}

// ============================================================================
// INPUT TYPES
// ============================================================================

/**
 * Input for creating a new community
 */
export interface CreateCommunityInput {
  /** Display name for the community */
  name: string;
  /** Optional description */
  description?: string;
  /** Optional cover image URL */
  cover_image_url?: string;
  /** Whether the community is publicly discoverable (default: true) */
  is_public?: boolean;
}

/**
 * Input for updating an existing community
 */
export interface UpdateCommunityInput {
  name?: string;
  description?: string;
  cover_image_url?: string;
  is_public?: boolean;
}

// ============================================================================
// RE-EXPORTS
// Types that are shared between groups and communities
// ============================================================================

export type { GroupActivity as CommunityActivity };
export type { GroupStats as CommunityStats };
export type { GroupMatch as CommunityMatch };
