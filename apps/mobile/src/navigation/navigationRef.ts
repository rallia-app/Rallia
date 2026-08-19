/**
 * Navigation ref + imperative "navigate from outside the container" helpers.
 *
 * Extracted from `navigation/index.ts` so callers (e.g. `usePushNotifications`,
 * `MatchDetailSheet`) can import these WITHOUT pulling in `AppNavigator` — the
 * barrel re-exports AppNavigator, which imports every screen, which import the
 * `#/hooks` barrel, closing a require cycle. This module depends only on
 * react-navigation + types, so importing it is cycle-free.
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
    // Navigate to the Home tab first, then to the nested screen.
    // Assertion mirrors navigateToCommunityScreen: generic nested-navigator
    // params don't narrow once a screen in the list takes params.
    navigationRef.navigate('Main', {
      screen: 'Home',
      params: {
        screen,
        params,
      } as NavigatorScreenParams<HomeStackParamList>,
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

/**
 * Navigate to IncomingReferenceRequests from outside the NavigationContainer.
 * Used for push notification tap handling.
 */
export function navigateToIncomingReferenceRequestsFromOutside() {
  if (navigationRef.isReady()) {
    navigationRef.navigate('IncomingReferenceRequests');
  }
}

/**
 * Navigate to the current user's UserProfile screen from outside the
 * NavigationContainer. Used as a fallback when push-tap handlers can't
 * complete their primary action (e.g. opening Stripe onboarding fails).
 */
export function navigateToUserProfileFromOutside() {
  if (navigationRef.isReady()) {
    navigationRef.navigate('UserProfile', {});
  }
}

/**
 * Navigate to a ChatConversation from outside the NavigationContainer.
 * Used for new-message push notification tap handling (e.g. the "book your
 * court" system message posted into a match chat).
 */
export function navigateToChatConversationFromOutside(conversationId: string, title?: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('ChatConversation', { conversationId, title });
  }
}

/**
 * Navigate to TournamentDetail from outside the NavigationContainer.
 * Used for tournament push notification tap handling.
 */
export function navigateToTournamentDetailFromOutside(tournamentId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('TournamentDetail', { tournamentId });
  }
}

/**
 * Navigate to LeagueDetail from outside the NavigationContainer.
 * Used for league push notification tap handling (invites, member requests,
 * approvals, season closed).
 */
export function navigateToLeagueDetailFromOutside(leagueId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('LeagueDetail', { leagueId });
  }
}

/**
 * Navigate to SessionDetail from outside the NavigationContainer.
 * Used for session push notification tap handling (published, confirm
 * reminder). SessionDetail needs both the session and its league.
 */
export function navigateToSessionDetailFromOutside(sessionId: string, leagueId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('SessionDetail', { sessionId, leagueId });
  }
}

/**
 * Navigate to the weekly check-in wizard from outside the NavigationContainer.
 * Used for the `availability_refresh_reminder` push tap.
 *
 * Re-entering the modal route while it is already focused (or animating out)
 * strands a touch-eating layer on iOS, so bail when it is already up.
 */
export function navigateToWeeklyCheckInFromOutside(source: string) {
  if (navigationRef.isReady() && navigationRef.getCurrentRoute()?.name !== 'WeeklyCheckIn') {
    navigationRef.navigate('WeeklyCheckIn', { source });
  }
}
