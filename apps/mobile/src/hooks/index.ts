/**
 * Central export for all custom hooks
 */
export * from './useAuth';
export * from './useNavigateToPlayerProfile';
export * from './useRequireOnboarding';
export * from './useImagePicker';
export * from './usePermissions';
export * from './useTranslation';
export * from './useUserLocation';
export * from './useEffectiveLocation';
export * from './usePushNotifications';
export * from './useTourSequence';
export * from './useShakeDetection';

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

// Re-export commonly used shared hooks
export {
  usePlayer,
  useProfile,
  ProfileProvider,
  type ProfileContextType,
} from '@rallia/shared-hooks';
