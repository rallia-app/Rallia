/**
 * Central export for all custom hooks
 */
export * from './useAuth';
export * from './useNavigateToPlayerProfile';
export * from './useRequireOnboarding';
export * from './useImagePicker';
export * from './usePermissions';
export * from './useTranslation';
// useUserLocation (GPS-only) intentionally not re-exported; prefer useEffectiveLocation.
export * from './useEffectiveLocation';
export * from './usePushNotifications';
export * from './useTourSequence';
export * from './useSportSetup';
export * from './useOpenExternalBooking';
export * from './usePendingReferenceRequestsCount';
export * from './useDeviceContacts';
export * from './useSuggestionInviteHandler';
export * from './useActiveConversation';

// Group chat hooks
export * from './groupChat';

// Theme hooks - import from native files directly for proper TypeScript resolution
export {
  ThemeProvider,
  useTheme,
  type ThemePreference,
  type ResolvedTheme,
} from '@rallia/shared-hooks/src/useTheme.native';
export { useThemeStyles, type ThemeColors } from '@rallia/shared-hooks/src/useThemeStyles.native';
export { useThemedStyles, type ThemedStylesContext } from './useThemedStyles';

// Re-export commonly used shared hooks
export {
  usePlayer,
  useProfile,
  ProfileProvider,
  type ProfileContextType,
} from '@rallia/shared-hooks';
