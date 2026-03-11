/**
 * Navigation Types - Centralized type definitions for all navigation routes
 *
 * Architecture:
 * - RootStackParamList: Root-level navigator including shared screens
 * - BottomTabParamList: Bottom tab navigator
 * - [Tab]StackParamList: Individual tab stack navigators (minimal, tab-specific only)
 *
 * Shared screens (UserProfile, SportProfile, Settings, etc.) live in the Root Stack
 * and are accessible from any tab. This eliminates duplication and provides full-screen experience.
 */

import type { NavigatorScreenParams, CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  RatingProofsScreenParams,
  SportProfileScreenParams,
  FacilityDetailScreenParams,
} from '@rallia/shared-types';

// =============================================================================
// ROOT STACK PARAM LIST
// Includes all shared screens that are accessible from anywhere in the app
// =============================================================================

export type RootStackParamList = {
  // First-time pre-onboarding wizard (shown before Main for new users)
  PreOnboarding: undefined;

  // App entry point
  Main: NavigatorScreenParams<BottomTabParamList>;

  // Shared screens - full screen, hides tabs when navigated to
  UserProfile: { userId?: string }; // undefined = current user's profile
  PlayerProfile: { playerId: string; sportId?: string }; // View another player's profile
  SportProfile: SportProfileScreenParams;
  Settings: undefined;
  Notifications: undefined;
  NotificationPreferences: undefined;
  Permissions: undefined;
  Feedback: undefined; // Feedback/Suggestion box
  Map: NavigatorScreenParams<MapStackParamList> | undefined;
  RatingProofs: RatingProofsScreenParams;
  IncomingReferenceRequests: undefined; // Incoming reference requests from other players
  GroupDetail: { groupId: string; groupName?: string }; // Group detail view
  CommunityDetail: { communityId: string; communityName?: string }; // Community detail view
  FacilityDetail: FacilityDetailScreenParams; // Facility detail (root-level for external navigation)
  GroupChatInfo: { conversationId: string }; // Group chat info/settings view
  ChatConversation: { conversationId: string; title?: string }; // Direct chat navigation
  PlayedMatchDetail: { match: unknown }; // Played match detail view
  MyBookings: undefined; // My Bookings screen (court bookings management)
  BookingDetail: { bookingId: string }; // Booking detail screen (deep link / notification target)
  InviteReferral: { referralCode: string }; // Referral deep link handler

  // Admin screens - accessible only to users with admin role
  AdminPanel: undefined; // Admin dashboard entry point
  AdminDashboard: undefined; // Analytics dashboard
  AdminUsers: undefined; // User management list
  AdminUserDetail: { userId: string }; // User detail view
  AdminNetworks: undefined; // Network management list (groups & communities)
  AdminNetworkDetail: { networkId: string }; // Network detail view
  AdminActivityLog: undefined; // Audit trail / activity log
  AdminAlerts: undefined; // Admin alerts and notifications
  AdminSettings: undefined; // Admin settings and preferences
  AdminModeration: undefined; // Moderation - reports and bans management

  // Admin Analytics Sub-Views (Phase 2)
  AdminOnboardingAnalytics: undefined; // Onboarding funnel analytics
  AdminUserAnalytics: undefined; // User growth and retention analytics
  AdminMatchAnalytics: undefined; // Match lifecycle analytics

  // Admin Analytics Sub-Views (Phase 3)
  AdminEngagementAnalytics: undefined; // User engagement analytics
  AdminMessagingAnalytics: undefined; // Messaging and communication analytics

  // Admin Analytics Sub-Views (Phase 4)
  AdminRatingAnalytics: undefined; // Rating & reputation analytics
  AdminModerationAnalytics: undefined; // Moderation and safety analytics

  // Admin Analytics Sub-Views (Phase 5)
  AdminCommunityAnalytics: undefined; // Community and network analytics
  AdminSportAnalytics: undefined; // Sport-specific analytics
};

// =============================================================================
// BOTTOM TAB PARAM LIST
// =============================================================================

export type BottomTabParamList = {
  Home: NavigatorScreenParams<HomeStackParamList>;
  Courts: NavigatorScreenParams<CourtsStackParamList>;
  Actions: undefined; // Doesn't navigate - opens bottom sheet
  Community: NavigatorScreenParams<CommunityStackParamList>;
  Chat: NavigatorScreenParams<ChatStackParamList>;
};

// =============================================================================
// TAB-SPECIFIC STACK PARAM LISTS
// Each tab only defines screens specific to that tab's flow
// =============================================================================

/**
 * Home Stack - Match discovery and player's own matches
 */
export type HomeStackParamList = {
  HomeScreen: undefined;
  PlayerMatches: undefined;
  PublicMatches: undefined;
};

/**
 * Courts Stack - Facility discovery and booking
 */
export type CourtsStackParamList = {
  FacilitiesDirectory: undefined;
  FacilityDetail: FacilityDetailScreenParams;
};

/**
 * Community Stack - Social features, groups, tournaments
 */
export type CommunityStackParamList = {
  PlayerDirectory: undefined;
  ShareLists: undefined;
  SharedListDetail: { listId: string; listName: string };
  Groups: undefined;
  Communities: undefined;
  Tournaments: undefined;
  Leagues: undefined;
  CommunityDetail: { communityId: string };
  TournamentDetail: { tournamentId: string };
  LeagueDetail: { leagueId: string };
};

/**
 * Chat Stack - Messaging
 */
export type ChatStackParamList = {
  Conversations: undefined;
  ArchivedChats: undefined;
};

/**
 * Map Stack - Map view with facility detail drill-down
 */
export type MapStackParamList = {
  MapView: { focusLocation?: { lat: number; lng: number } } | undefined;
  FacilityDetail: FacilityDetailScreenParams;
};

// =============================================================================
// COMPOSITE SCREEN PROPS
// For screens that need access to both their stack navigation and root navigation
// =============================================================================

/**
 * Props for screens in the Home Stack
 * Provides typed navigation that can navigate within HomeStack AND to Root screens
 */
export type HomeStackScreenProps<T extends keyof HomeStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

/**
 * Props for screens in the Courts Stack
 */
export type CourtsStackScreenProps<T extends keyof CourtsStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<CourtsStackParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

/**
 * Props for screens in the Community Stack
 */
export type CommunityStackScreenProps<T extends keyof CommunityStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<CommunityStackParamList, T>,
    NativeStackScreenProps<RootStackParamList>
  >;

/**
 * Props for screens in the Chat Stack
 */
export type ChatStackScreenProps<T extends keyof ChatStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<ChatStackParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

/**
 * Props for screens in the Root Stack (shared screens)
 */
export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

// =============================================================================
// GLOBAL TYPE DECLARATION
// Enables untyped useNavigation() calls to still resolve correctly
// This maintains backward compatibility with existing navigation calls
// =============================================================================

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
