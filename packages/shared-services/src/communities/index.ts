/**
 * Community Services
 * Export all community-related services and types
 */

// Types
export * from './communityTypes';

// CRUD operations
export {
  getCommunityTypeId,
  createCommunity,
  getCommunity,
  getCommunityWithMembers,
  getPublicCommunities,
  getPlayerCommunities,
  updateCommunity,
  deleteCommunity,
  requestToJoinCommunity,
  requestToJoinCommunityByInviteCode,
  getOrCreateCommunityInviteCode,
  getCommunityInviteLink,
  referPlayerToCommunity,
  approveCommunityMember,
  rejectCommunityMember,
  getPendingCommunityMembers,
  isCommunityMember,
  isCommunityModerator,
  getCommunityMembershipStatus,
  checkCommunityAccess,
  leaveCommunity,
  addCommunityMember,
  removeCommunityMember,
  promoteCommunityMember,
  demoteCommunityMember,
} from './communityCrudService';

// Realtime subscriptions
export {
  subscribeToCommunityMembers,
  subscribeToCommunityActivity,
  subscribeToCommunityMatches,
  subscribeToCommunitySettings,
  subscribeToPlayerCommunities,
  subscribeToPublicCommunities,
  subscribeToPendingRequests,
  unsubscribeFromCommunityChannel,
} from './communityRealtimeService';
