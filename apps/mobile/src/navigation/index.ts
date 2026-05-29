/**
 * Navigation - Barrel exports
 */

// Navigation ref + imperative navigate-from-outside helpers. Defined in a
// dedicated module (not here) so importing them doesn't pull in AppNavigator
// and create a require cycle; re-exported here for back-compat.
export {
  navigationRef,
  navigateFromOutside,
  navigateToCommunityScreen,
  navigateToPlayerProfileFromOutside,
  navigateToIncomingReferenceRequestsFromOutside,
  navigateToUserProfileFromOutside,
} from './navigationRef';

// Main navigator
export { default as AppNavigator } from './AppNavigator';

// Linking configuration
export { linking, isAdminRoute, getRouteFromUrl, generateDeepLink } from './linking';

// Deep link security guard
export { useAdminDeepLinkGuard } from './useAdminDeepLinkGuard';

// Typed hooks
export {
  useAppNavigation,
  useRootRoute,
  useHomeRoute,
  useCourtsRoute,
  useCommunityRoute,
  useChatRoute,
  useHomeNavigation,
  useCourtsNavigation,
  useCommunityNavigation,
  useChatNavigation,
} from './hooks';

// Types
export type {
  RootStackParamList,
  BottomTabParamList,
  HomeStackParamList,
  CourtsStackParamList,
  CommunityStackParamList,
  ChatStackParamList,
  HomeStackScreenProps,
  CourtsStackScreenProps,
  CommunityStackScreenProps,
  ChatStackScreenProps,
  RootStackScreenProps,
} from './types';
