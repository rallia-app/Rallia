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
// useBadgeCountSync moved to apps/mobile/src/hooks/ (native-only hook, requires expo-notifications)
export * from './useNotificationPreferences';
export * from './useOrgNotifications';
export * from './useCreateMatch';
export * from './useCoPlayerUpcomingGames';
export * from './useTournaments';
export * from './useLeagues';
export * from './useEvents';
export * from './useUpdateMatch';
export * from './useMatches';
export * from './useMatchActions';
export * from './useMatchFeedback';
export * from './useNearbyMatches';
export * from './useTopSuggestions';
export * from './useJustForYou';
export * from './suggestionFilters';
export * from './feedTypes';
export * from './useMatchRelevanceScore';
export * from './usePlayerMatches';
export * from './usePlayerMatchHistory';
export * from './usePlayerMatchFilters';
export * from './usePublicMatches';
export * from './usePublicMatchFilters';
export * from './forYouPreset';
export * from './useRatingScoresForSport';
export * from './useRatingScoreReferees';
export * from './useFacilitySearch';
export * from './useFavoriteFacilityAvailability';
export * from './useNearbyOpenCourtCount';
export * from './useSharedAvailability';
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
export * from './useFeedbackBrowse';
export * from './useCommunities';
export * from './useChat';
export * from './useMatchOrganizer';
export * from './useQuickMatch';
export * from './useConversationFilter';
export * from './useBlockedStatus';
export * from './useFavoriteStatus';
export * from './useSharedLists';
export * from './usePlayPreferences';
export * from './useFavoriteFacilities';
export * from './useCommunityFavoriteFacilities';
export * from './useCommunitiesForFacility';
export * from './useAdminStatus';
export * from './useAdminUsers';
export * from './useAdminNetworks';
export * from './useAdminAnalytics';
export * from './useAnalyticsTimeRange';
export * from './useAdminAudit';
export * from './useModeration';
// useAdminPush moved to apps/mobile/src/hooks/ (native-only hook)
export * from './useBooking';
export * from './usePlayerBookingFilters';
export * from './useReferral';
export * from './useReviewPrompt';
export * from './useSportLeaderboard';
export * from './useTournamentRanking';
export * from './useMapData';
export * from './useProfileCompleteness';
export * from './useOnboardingGaps';
export * from './onboardingGapItems';
export * from './useCoverageCheck';

// Platform-specific exports - Metro resolves .native.ts for React Native builds
// Web bundlers will use the stub .ts files which throw helpful errors at runtime
export * from './useTheme';
export * from './useThemeStyles';
export * from './useMatchInviteCandidates';
