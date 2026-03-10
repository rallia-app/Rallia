/**
 * Shared Hooks - Barrel Export
 *
 * Note: useTheme and useThemeStyles are React Native-only hooks.
 * They are exported from separate files to avoid bundling react-native in web builds.
 * - For React Native: import from './useTheme.native' and './useThemeStyles.native'
 * - For Web: use `next-themes` instead
 */

// Storage adapter for platform-agnostic persistence
export * from './storage';

export * from './useAuth';
export * from './useDebounce';
export * from './useProfile'; // Also exports ProfileProvider and ProfileContextType
export * from './useSports';
export * from './usePlayerSports';
export * from './usePlayer';
export * from './useNotifications';
export * from './useNotificationRealtime';
export * from './useNotificationPreferences';
export * from './useOrgNotifications';
export * from './useCreateMatch';
export * from './useUpdateMatch';
export * from './useMatches';
export * from './useMatchActions';
export * from './useMatchFeedback';
export * from './useNearbyMatches';
export * from './usePlayerMatches';
export * from './usePlayerMatchFilters';
export * from './usePublicMatches';
export * from './usePublicMatchFilters';
export * from './useRatingScoresForSport';
export * from './useFacilitySearch';
export * from './useFacilityDetail';
export * from './usePreferredFacility';
export * from './useFacilityReservationContact';
export * from './useCourtAvailability';
export * from './usePlacesAutocomplete';
export * from './usePostalCodeGeocode';
export * from './usePlayerSearch';
export * from './useInviteToMatch';
export * from './usePlayerReputation';
export * from './useGroups';
export * from './usePendingFeedbackCheck';
export * from './useCommunities';
export * from './useChat';
export * from './useBlockedStatus';
export * from './useFavoriteStatus';
export * from './useSharedLists';
export * from './usePlayPreferences';
export * from './useFavoriteFacilities';
export * from './useCommunityFavoriteFacilities';
export * from './useAdminStatus';
export * from './useAdminUsers';
export * from './useAdminAnalytics';
export * from './useAnalyticsTimeRange';
export * from './useAdminAudit';
export * from './useModeration';
// useAdminPush moved to apps/mobile/src/hooks/ (native-only hook)
export * from './useBooking';
export * from './usePlayerBookingFilters';
export * from './useReferral';

// Platform-specific exports - Metro resolves .native.ts for React Native builds
// Web bundlers will use the stub .ts files which throw helpful errors at runtime
export * from './useTheme';
export * from './useThemeStyles';
