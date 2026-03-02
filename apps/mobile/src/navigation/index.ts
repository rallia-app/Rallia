/**
 * Navigation - Barrel exports
 */

import { createNavigationContainerRef } from '@react-navigation/native';
import type { NavigatorScreenParams } from '@react-navigation/native';
import type { RootStackParamList, HomeStackParamList, CommunityStackParamList } from './types';

// Navigation ref for use outside NavigationContainer (e.g., ActionsBottomSheet)
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Navigate to a screen from outside the NavigationContainer.
 * This is useful for components like ActionsBottomSheet that render outside the navigation tree.
 */
export function navigateFromOutside<T extends keyof HomeStackParamList>(
  screen: T,
  params?: HomeStackParamList[T]
) {
  if (navigationRef.isReady()) {
    // Navigate to the Home tab first, then to the nested screen
    navigationRef.navigate('Main', {
      screen: 'Home',
      params: {
        screen,
        params,
      },
    });
  }
}

/**
 * Navigate to a Community stack screen from outside the NavigationContainer.
 *
 * Note: We use a type assertion here because React Navigation's TypeScript types
 * don't properly support generic constraints with nested navigators. This is a
 * known limitation documented at:
 * https://reactnavigation.org/docs/typescript/#type-checking-screens
 *
 * The assertion is safe because the function signature ensures callers pass
 * valid screen names and params that match CommunityStackParamList.
 */
export function navigateToCommunityScreen<T extends keyof CommunityStackParamList>(
  screen: T,
  params?: CommunityStackParamList[T]
) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', {
      screen: 'Community',
      params: {
        screen,
        params,
      } as NavigatorScreenParams<CommunityStackParamList>,
    });
  }
}

/**
 * Navigate to PlayerProfile from outside the NavigationContainer.
 * Use in components like MatchDetailSheet that render outside the navigation tree.
 * Caller is responsible for auth/onboarding checks (open auth sheet if not signed in or not onboarded).
 */
export function navigateToPlayerProfileFromOutside(playerId: string, sportId?: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('PlayerProfile', { playerId, sportId });
  }
}

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
