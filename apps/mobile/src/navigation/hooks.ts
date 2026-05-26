/**
 * Navigation Hooks - Typed navigation hooks for the app
 *
 * These hooks provide type-safe navigation throughout the app.
 * Use these instead of the base useNavigation/useRoute from @react-navigation/native.
 */

import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import type {
  RootStackParamList,
  HomeStackParamList,
  CourtsStackParamList,
  CommunityStackParamList,
  ChatStackParamList,
} from './types';

// =============================================================================
// ROOT NAVIGATION HOOK
// Main hook - can navigate to any screen in the app including shared screens
// =============================================================================

/**
 * Type-safe navigation hook for the entire app.
 * Can navigate to any screen in RootStackParamList (including shared screens).
 *
 * @example
 * const navigation = useAppNavigation();
 * navigation.navigate('UserProfile', { userId: '123' });
 * navigation.navigate('Settings');
 */
export const useAppNavigation = () =>
  useNavigation<NativeStackNavigationProp<RootStackParamList>>();

// =============================================================================
// ROUTE HOOKS
// Type-safe route hooks for accessing screen params
// =============================================================================

/**
 * Type-safe route hook for Root Stack screens.
 *
 * @example
 * // In UserProfile.tsx
 * const route = useRootRoute<'UserProfile'>();
 * const userId = route.params?.userId;
 */
export const useRootRoute = <T extends keyof RootStackParamList>() =>
  useRoute<RouteProp<RootStackParamList, T>>();

/**
 * Type-safe route hook for Home Stack screens.
 */
export const useHomeRoute = <T extends keyof HomeStackParamList>() =>
  useRoute<RouteProp<HomeStackParamList, T>>();

/**
 * Type-safe route hook for Courts Stack screens.
 */
export const useCourtsRoute = <T extends keyof CourtsStackParamList>() =>
  useRoute<RouteProp<CourtsStackParamList, T>>();

/**
 * Type-safe route hook for Community Stack screens.
 */
export const useCommunityRoute = <T extends keyof CommunityStackParamList>() =>
  useRoute<RouteProp<CommunityStackParamList, T>>();

/**
 * Type-safe route hook for Chat Stack screens.
 */
export const useChatRoute = <T extends keyof ChatStackParamList>() =>
  useRoute<RouteProp<ChatStackParamList, T>>();

// =============================================================================
// STACK-SPECIFIC NAVIGATION HOOKS
// For cases where you only need to navigate within a specific stack
// =============================================================================

/**
 * Navigation hook for Home Stack only.
 * Use useAppNavigation() if you need to navigate to shared screens.
 */
export const useHomeNavigation = () =>
  useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

/**
 * Navigation hook for Courts Stack only.
 */
export const useCourtsNavigation = () =>
  useNavigation<NativeStackNavigationProp<CourtsStackParamList>>();

/**
 * Navigation hook for Community Stack only.
 */
export const useCommunityNavigation = () =>
  useNavigation<NativeStackNavigationProp<CommunityStackParamList>>();

/**
 * Navigation hook for Chat Stack only.
 */
export const useChatNavigation = () =>
  useNavigation<NativeStackNavigationProp<ChatStackParamList>>();
