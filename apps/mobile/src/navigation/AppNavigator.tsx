/**
 * App Navigator - Main navigation structure
 *
 * Architecture:
 * - Root Stack: Contains Main (tabs) and all shared screens
 * - Bottom Tabs: Home, Courts, Actions (opens sheet), Community, Chat
 * - Each tab has a minimal stack with only tab-specific screens
 * - Shared screens (UserProfile, Settings, etc.) are in Root Stack for full-screen experience
 */

import React, { useEffect, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  Image,
  StyleProp,
  ViewStyle,
  GestureResponderEvent,
  Text as RNText,
  Platform,
  AppState,
} from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StackActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CopilotStep } from 'react-native-copilot';
import { lightHaptic, getProfilePictureUrl } from '@rallia/shared-utils';
import { SheetManager } from 'react-native-actions-sheet';

// WalkthroughableView is now imported from TourContext with collapsable={false} for reliable Android measurement
import {
  ProfilePictureButton,
  NotificationButton,
  SettingsButton,
} from '@rallia/shared-components';
import {
  useUnreadCountForSport,
  useProfile,
  useTotalUnreadCount,
  useOtherSportsUnreadCount,
  useProfileCompleteness,
  chatKeys,
  useTheme,
} from '@rallia/shared-hooks';
import { useQueryClient } from '@tanstack/react-query';
import { spacingPixels, fontSizePixels, neutral } from '@rallia/design-system';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  NativeStackNavigationProp,
  NativeStackHeaderProps,
} from '@react-navigation/native-stack';
import { getTierColors } from '#/features/profile/completionTierColors';
import { useAuth, useThemeStyles, useTranslation, useRequireOnboarding } from '#/hooks';
import ProfileCompletionRing from '#/features/profile/components/ProfileCompletionRing';
import SportSelector from '#/components/SportSelector';
import { useActionsSheet, useSport, useOverlay } from '#/context';
import { WalkthroughableView } from '#/context/TourContext';

// Screens
import Home from '#/screens/Home';
import Community from '#/screens/Community';
import Chat from '#/screens/Chat';
import ChatConversation from '#/screens/ChatConversation';
import ArchivedChats from '#/screens/ArchivedChats';
import SettingsScreen from '#/screens/SettingsScreen';
import Paywall from '#/screens/Paywall';
import SubscriptionManagement from '#/screens/SubscriptionManagement';
import UserProfile from '#/screens/UserProfile';
import SportProfile from '#/screens/SportProfile';
import RatingProofs from '#/screens/RatingProofs';
import RatingReferences from '#/screens/RatingReferences';
import IncomingReferenceRequests from '#/screens/IncomingReferenceRequests';
import Notifications from '#/screens/Notifications';
import NotificationPreferencesScreen from '#/screens/NotificationPreferencesScreen';
import PermissionsScreen from '#/screens/PermissionsScreen';
import PlayerProfile from '#/screens/PlayerProfile';
import SharedLists from '#/screens/SharedLists';
import SharedListDetail from '#/screens/SharedListDetail';
import Groups from '#/screens/Groups';
import GroupDetail from '#/screens/GroupDetail';
import PreOnboardingScreen from '#/screens/PreOnboarding';
import GroupChatInfo from '#/screens/GroupChatInfo';
import PlayedMatchDetail from '#/screens/PlayedMatchDetail';
import Communities from '#/screens/Communities';
import CommunityDetail from '#/screens/CommunityDetail';
import TournamentDetail from '#/screens/TournamentDetail';
import Tournaments from '#/screens/Tournaments';
import MyTournaments from '#/screens/MyTournaments';
import NetworkMatches from '#/screens/NetworkMatches';
import AdminPanelScreen from '#/screens/AdminPanelScreen';
import AdminDashboardScreen from '#/screens/AdminDashboardScreen';
import AdminUsersScreen from '#/screens/AdminUsersScreen';
import AdminUserDetailScreen from '#/screens/AdminUserDetailScreen';
import AdminNetworksScreen from '#/screens/AdminNetworksScreen';
import AdminNetworkDetailScreen from '#/screens/AdminNetworkDetailScreen';
import AdminActivityLogScreen from '#/screens/AdminActivityLogScreen';
import AdminAlertsScreen from '#/screens/AdminAlertsScreen';
import AdminSettingsScreen from '#/screens/AdminSettingsScreen';
import AdminModerationScreen from '#/screens/AdminModerationScreen';
// Phase 2 Analytics Sub-Views
import AdminOnboardingAnalyticsScreen from '#/screens/admin/AdminOnboardingAnalyticsScreen';
import AdminUserAnalyticsScreen from '#/screens/admin/AdminUserAnalyticsScreen';
import AdminMatchAnalyticsScreen from '#/screens/admin/AdminMatchAnalyticsScreen';
// Phase 3 Analytics Sub-Views
import AdminEngagementAnalyticsScreen from '#/screens/admin/AdminEngagementAnalyticsScreen';
import AdminMessagingAnalyticsScreen from '#/screens/admin/AdminMessagingAnalyticsScreen';
// Phase 4 Analytics Sub-Views
import AdminRatingAnalyticsScreen from '#/screens/admin/AdminRatingAnalyticsScreen';
import AdminModerationAnalyticsScreen from '#/screens/admin/AdminModerationAnalyticsScreen';
// Phase 5 Analytics Sub-Views
import AdminCommunityAnalyticsScreen from '#/screens/admin/AdminCommunityAnalyticsScreen';
import AdminSportAnalyticsScreen from '#/screens/admin/AdminSportAnalyticsScreen';
import MapScreen from '#/screens/Map';

// Components
import { ThemeLogo } from '#/components/ThemeLogo';

// Types
import PublicMatches from '#/features/matches/screens/PublicMatches';
import PlayerMatches from '#/features/matches/screens/PlayerMatches';
import { FacilitiesDirectory, FacilityDetail } from '#/features/facilities';
import { MyBookingsScreen, BookingDetailScreen } from '#/features/bookings';
import { InviteReferralScreen } from '#/screens/InviteReferralScreen';
import { WeeklyCheckInScreen } from '#/features/weekly-checkin/WeeklyCheckInScreen';

import TennisCourtIcon from '../../assets/icons/tennis-court.svg';
import PickleballIcon from '../../assets/icons/pickleball.svg';
import TennisIcon from '../../assets/icons/tennis.svg';

import { useAppNavigation } from './hooks';
import type {
  RootStackParamList,
  BottomTabParamList,
  HomeStackParamList,
  CourtsStackParamList,
  CommunityStackParamList,
  ChatStackParamList,
  MapStackParamList,
} from './types';

// =============================================================================
// TYPED NAVIGATORS
// =============================================================================

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<BottomTabParamList>();
const HomeStackNavigator = createNativeStackNavigator<HomeStackParamList>();
const CourtsStackNavigator = createNativeStackNavigator<CourtsStackParamList>();
const CommunityStackNavigator = createNativeStackNavigator<CommunityStackParamList>();
const ChatStackNavigator = createNativeStackNavigator<ChatStackParamList>();
const MapStackNavigator = createNativeStackNavigator<MapStackParamList>();

// =============================================================================
// SHARED HEADER COMPONENTS
// =============================================================================

/**
 * Notification button with badge showing unread count
 */
function NotificationButtonWithBadge({ color }: { color?: string }) {
  const navigation = useAppNavigation();
  const { session } = useAuth();
  const { selectedSport } = useSport();
  const { data: unreadCount } = useUnreadCountForSport(session?.user?.id, selectedSport?.name);
  const { colors } = useThemeStyles();

  return (
    <NotificationButton
      onPress={() => navigation.navigate('Notifications')}
      unreadCount={unreadCount ?? 0}
      color={color ?? colors.headerForeground}
      badgeColor={colors.error}
      badgeTextColor={colors.primaryForeground}
    />
  );
}

/**
 * Sport selector with context integration
 * Uses useSport hook to get/set selected sport and useTheme for dark mode
 * Shows for:
 * - Signed-out users (guests) browsing public matches
 * - Signed-in users who have completed onboarding
 */
function SportSelectorWithContext() {
  const { selectedSport, userSports, setSelectedSport, refetch: refetchSports } = useSport();
  const { theme } = useTheme();
  const { session } = useAuth();
  const { contentMode } = useActionsSheet();
  const { refetch } = useProfile();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  // Fetch unread counts for other sports to show badge on selector
  const { otherSportsUnreadCount } = useOtherSportsUnreadCount(
    session?.user?.id,
    userSports,
    selectedSport?.name
  );

  // Determine if user is a guest (not signed in)
  // const isGuest = !session?.user;

  // Refetch profile when auth state changes (e.g., user first authenticates)
  useEffect(() => {
    if (session?.user) {
      refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, refetch]);

  // Refetch profile when actions sheet mode changes from 'onboarding' to 'actions'
  // This indicates onboarding was completed and the profile needs to be refreshed
  const prevContentModeRef = React.useRef<typeof contentMode>(contentMode);
  useEffect(() => {
    if (prevContentModeRef.current === 'onboarding' && contentMode === 'actions' && session?.user) {
      // Onboarding was just completed, refetch profile and sports
      refetch();
      refetchSports();
    }
    prevContentModeRef.current = contentMode;
  }, [contentMode, session?.user, refetch]);

  // For signed-in users, only show if onboarding is completed
  // For guests, always allow (they browse all public matches)
  // if (!isGuest && !profile?.onboarding_completed) {
  //   return null;
  // }

  // Don't show sport selector if user has only one or no sports
  if (!userSports || userSports.length <= 1) {
    return null;
  }

  return (
    <CopilotStep
      text={t('tour.header.sportToggle.description')}
      order={7}
      name="header-sport-toggle"
    >
      <WalkthroughableView>
        <SportSelector
          selectedSport={selectedSport}
          userSports={userSports}
          onSelectSport={setSelectedSport}
          isDark={isDark}
          confirmBeforeSwitch
          t={t as (key: string) => string}
          otherSportsUnreadCount={otherSportsUnreadCount}
        />
      </WalkthroughableView>
    </CopilotStep>
  );
}

// =============================================================================
// SCREEN OPTIONS
// =============================================================================

/**
 * Custom header for shared screens (UserProfile, Settings, etc.)
 * Matches MainTabHeader height/style but shows back button + centered title.
 */
function SharedScreenHeader({ navigation, options }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useThemeStyles();
  const title = typeof options.headerTitle === 'string' ? options.headerTitle : '';
  const HeaderRight = options.headerRight;

  return (
    <View
      style={{
        backgroundColor: colors.headerBackground,
        paddingTop: insets.top,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.border,
      }}
    >
      <View
        style={{
          height: HEADER_CONTENT_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacingPixels[1],
        }}
      >
        <View style={{ position: 'absolute', left: 0 }}>
          <ThemedBackButton navigation={navigation} />
        </View>
        <RNText
          style={{
            fontSize: fontSizePixels.lg,
            fontWeight: '600',
            color: colors.headerForeground,
          }}
        >
          {title}
        </RNText>
        {HeaderRight && (
          <View style={{ position: 'absolute', right: spacingPixels[1] }}>
            <HeaderRight tintColor={colors.headerForeground} />
          </View>
        )}
      </View>
    </View>
  );
}

const getSharedScreenOptions = () => ({
  headerShown: true,
  header: (props: NativeStackHeaderProps) => <SharedScreenHeader {...props} />,
});

/**
 * Profile picture button with auth and onboarding-aware behavior
 * - If authenticated and onboarded: navigates to UserProfile
 * - If not authenticated or not onboarded: opens auth/onboarding sheet
 */
function ProfilePictureButtonWithAuth() {
  const navigation = useAppNavigation();
  const { isReady, guardAction } = useRequireOnboarding();
  useAuth();
  useActionsSheet();
  const { t } = useTranslation();
  const { profile } = useProfile();
  const completeness = useProfileCompleteness();

  const handlePress = () => {
    if (isReady) {
      // Authenticated and onboarded: navigate to profile
      navigation.navigate('UserProfile', {});
    } else {
      // Not authenticated or not onboarded: open auth/onboarding sheet
      guardAction();
    }
  };

  const { isDark } = useThemeStyles();
  const showRing = isReady && !completeness.loading && !completeness.isComplete;

  const profilePictureUrl = useMemo(
    () => getProfilePictureUrl(profile?.profile_picture_url),
    [profile?.profile_picture_url]
  );

  // Ring colors based on tier
  const tierColors = useMemo(
    () => getTierColors(completeness.tier, isDark),
    [completeness.tier, isDark]
  );
  const ringColor = tierColors.accent;
  const ringTrackColor = tierColors.trackColor;
  const avatarSize = 28;
  const ringSize = avatarSize + 5; // 33px — ring sits tight against the avatar
  const iconColor = isDark ? neutral[50] : neutral[900];
  const placeholderBg = isDark ? neutral[700] : neutral[200];

  return (
    <CopilotStep text={t('tour.header.profile.description')} order={6} name="header-profile">
      <WalkthroughableView style={{ flexDirection: 'row', alignItems: 'center' }}>
        {showRing ? (
          <TouchableOpacity
            onPress={handlePress}
            style={{
              marginLeft: spacingPixels[2],
              width: ringSize,
              height: ringSize,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Ring — absolutely positioned to fill the touchable */}
            <View style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
              <ProfileCompletionRing
                percentage={completeness.percentage}
                size={ringSize}
                strokeWidth={2.5}
                color={ringColor}
                trackColor={ringTrackColor}
                showLabel={false}
              />
            </View>
            {/* Avatar — centered inside the ring */}
            {profilePictureUrl ? (
              <Image
                source={{ uri: profilePictureUrl }}
                style={{
                  width: avatarSize,
                  height: avatarSize,
                  borderRadius: avatarSize / 2,
                  backgroundColor: placeholderBg,
                }}
              />
            ) : (
              <Ionicons name="person-circle-outline" size={ringSize} color={iconColor} />
            )}
            {/* Percentage badge */}
            <View
              style={{
                position: 'absolute',
                bottom: -3,
                right: -6,
                backgroundColor: ringColor,
                borderRadius: 6,
                paddingHorizontal: 3,
                paddingVertical: 1,
                minWidth: 22,
                alignItems: 'center',
              }}
            >
              <RNText
                style={{
                  color: '#fff',
                  fontSize: 8,
                  fontWeight: '700',
                  lineHeight: 10,
                }}
              >
                {completeness.percentage}%
              </RNText>
            </View>
          </TouchableOpacity>
        ) : (
          <ProfilePictureButton onPress={handlePress} isDark={isDark} />
        )}
      </WalkthroughableView>
    </CopilotStep>
  );
}

/**
 * Header right component with notification and settings buttons
 */
function HeaderRightButtons() {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  return (
    <CopilotStep text={t('tour.header.actions.description')} order={8} name="header-actions">
      <WalkthroughableView
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacingPixels[2],
          marginRight: spacingPixels[2],
        }}
      >
        <NotificationButtonWithBadge color={colors.headerForeground} />
        <SettingsButton color={colors.headerForeground} />
      </WalkthroughableView>
    </CopilotStep>
  );
}

/**
 * Custom header for main tab screens with configurable content height.
 * Native stack's headerStyle.height has no effect on iOS, so we use
 * a fully custom header via the `header` prop instead.
 */
const HEADER_CONTENT_HEIGHT = 52; // default native is 44

function MainTabHeader() {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useThemeStyles();

  return (
    <View
      style={{
        backgroundColor: colors.headerBackground,
        paddingTop: insets.top,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.border,
      }}
    >
      <View
        style={{
          height: HEADER_CONTENT_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacingPixels[1],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ProfilePictureButtonWithAuth />
          <SportSelectorWithContext />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            alignItems: 'center',
            paddingBottom: 4,
          }}
        >
          <ThemeLogo width={100} height={30} />
        </View>
        <HeaderRightButtons />
      </View>
    </View>
  );
}

/**
 * Header options for main tab screens (Home, Courts, Community, Chat)
 */
function useMainScreenOptions() {
  return {
    headerShown: true,
    header: () => <MainTabHeader />,
  };
}

// =============================================================================
// TAB STACKS - Minimal, tab-specific screens only
// =============================================================================

/**
 * Header options for PublicMatches screen
 */
function usePublicMatchesScreenOptions() {
  const { t } = useTranslation();
  const sharedOptions = getSharedScreenOptions();

  return ({
    navigation,
  }: {
    navigation: NativeStackNavigationProp<HomeStackParamList, 'PublicMatches'>;
  }) => ({
    ...sharedOptions,
    headerTitle: t('screens.publicMatches'),
    headerLeft: () => <ThemedBackButton navigation={navigation} />,
  });
}

/**
 * Header options for PlayerMatches screen
 */
function usePlayerMatchesScreenOptions() {
  const { t } = useTranslation();
  const sharedOptions = getSharedScreenOptions();

  return ({
    navigation,
  }: {
    navigation: NativeStackNavigationProp<HomeStackParamList, 'PlayerMatches'>;
  }) => ({
    ...sharedOptions,
    headerTitle: t('screens.playerMatches'),
    headerLeft: () => <ThemedBackButton navigation={navigation} />,
  });
}

// Shared screen options for fast animations across all stacks
const fastAnimationOptions = {
  animation: 'slide_from_right' as const,
  animationDuration: 200,
  gestureEnabled: true,
};

/**
 * Home Stack - Match discovery and player's own matches
 */
function HomeStack() {
  const mainScreenOptions = useMainScreenOptions();
  const publicMatchesOptions = usePublicMatchesScreenOptions();
  const playerMatchesOptions = usePlayerMatchesScreenOptions();
  return (
    <HomeStackNavigator.Navigator id="HomeStack" screenOptions={fastAnimationOptions}>
      <HomeStackNavigator.Screen
        name="HomeScreen"
        getComponent={() => Home}
        options={mainScreenOptions}
      />
      <HomeStackNavigator.Screen
        name="PublicMatches"
        getComponent={() => PublicMatches}
        options={publicMatchesOptions}
      />
      <HomeStackNavigator.Screen
        name="PlayerMatches"
        getComponent={() => PlayerMatches}
        options={playerMatchesOptions}
      />
    </HomeStackNavigator.Navigator>
  );
}

/**
 * Courts Stack - Facility discovery and booking
 */
function CourtsStack() {
  const mainScreenOptions = useMainScreenOptions();
  const { t } = useTranslation();
  const sharedOptions = getSharedScreenOptions();

  return (
    <CourtsStackNavigator.Navigator id="CourtsStack" screenOptions={fastAnimationOptions}>
      <CourtsStackNavigator.Screen
        name="FacilitiesDirectory"
        getComponent={() => FacilitiesDirectory}
        options={mainScreenOptions}
      />
      <CourtsStackNavigator.Screen
        name="FacilityDetail"
        getComponent={() => FacilityDetail}
        options={({ navigation, route }) => {
          const rootNav = navigation.getParent()?.getParent();
          const { returnTo } = route.params ?? {};
          // Handle returnTo for navigation from MyBookings
          const goBack =
            returnTo === 'MyBookings' && rootNav
              ? () => rootNav.navigate('MyBookings')
              : () => navigation.goBack();

          return {
            ...sharedOptions,
            headerTitle: t('facilitiesTab.title'),
            headerLeft: () => <ThemedBackButton navigation={{ goBack }} />,
          };
        }}
      />
    </CourtsStackNavigator.Navigator>
  );
}

function CreateListHeaderButton() {
  const { colors } = useThemeStyles();
  const { guardAction } = useRequireOnboarding();
  return (
    <TouchableOpacity
      onPress={() => {
        if (!guardAction()) return;
        lightHaptic();
        SheetManager.show('create-list', { payload: { editingList: null } });
      }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={{ marginRight: spacingPixels[2] }}
    >
      <Ionicons name="add" size={28} color={colors.headerForeground} />
    </TouchableOpacity>
  );
}

/**
 * Community Stack - Social features
 */
function CommunityStack() {
  const mainScreenOptions = useMainScreenOptions();
  const { t } = useTranslation();
  const sharedOptions = getSharedScreenOptions();

  return (
    <CommunityStackNavigator.Navigator id="CommunityStack" screenOptions={fastAnimationOptions}>
      <CommunityStackNavigator.Screen
        name="PlayerDirectory"
        getComponent={() => Community}
        options={mainScreenOptions}
      />
      <CommunityStackNavigator.Screen
        name="ShareLists"
        getComponent={() => SharedLists}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('community.shareLists') || 'Shared Lists',
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
          headerRight: () => <CreateListHeaderButton />,
        })}
      />
      <CommunityStackNavigator.Screen
        name="SharedListDetail"
        getComponent={() => SharedListDetail}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('sharedLists.title') || 'List',
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />
      <CommunityStackNavigator.Screen
        name="Groups"
        getComponent={() => Groups}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('community.groups') || 'Groups',
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />
      <CommunityStackNavigator.Screen
        name="Communities"
        getComponent={() => Communities}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('community.communities') || 'Communities',
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />
    </CommunityStackNavigator.Navigator>
  );
}

/**
 * Chat Stack - Messaging
 */
function ChatStack() {
  const mainScreenOptions = useMainScreenOptions();
  const { t } = useTranslation();
  const sharedOptions = getSharedScreenOptions();
  return (
    <ChatStackNavigator.Navigator id="ChatStack" screenOptions={fastAnimationOptions}>
      <ChatStackNavigator.Screen
        name="Conversations"
        getComponent={() => Chat}
        options={mainScreenOptions}
      />
      <ChatStackNavigator.Screen
        name="ArchivedChats"
        getComponent={() => ArchivedChats}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('chat.archivedChats.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />
    </ChatStackNavigator.Navigator>
  );
}

// =============================================================================
// TAB BUTTON WITH HAPTICS
// =============================================================================

/**
 * Wrapper component for tab bar buttons that adds haptic feedback
 */
function TabButtonWithHaptic(props: {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  [key: string]: unknown;
}) {
  const { children, onPress, ...otherProps } = props;

  const handlePress = (e: GestureResponderEvent) => {
    lightHaptic();
    if (onPress) {
      onPress(e);
    }
  };

  return (
    <TouchableOpacity onPress={handlePress} {...otherProps}>
      {children}
    </TouchableOpacity>
  );
}

// =============================================================================
// CENTER TAB BUTTON - Opens Actions Bottom Sheet
// =============================================================================

/**
 * Custom center tab button that opens the Actions bottom sheet
 * instead of navigating to a screen
 */
const CENTER_TAB_SIZE = 80;

function CenterTabButton({
  style,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  // These are passed by React Navigation but we intentionally ignore them
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: ((e: GestureResponderEvent) => void) | null;
  accessibilityRole?: string;
  accessibilityState?: { selected?: boolean };
  testID?: string;
}) {
  const { t } = useTranslation();
  const { openSheet } = useActionsSheet();
  const { isDark } = useThemeStyles();

  return (
    <View style={[{ flex: 1, alignItems: 'center' }, style]}>
      <CopilotStep text={t('tour.mainNavigation.actions.description')} order={3} name="actions-tab">
        <WalkthroughableView
          style={{
            position: 'absolute',
            top: -CENTER_TAB_SIZE / 4,
            width: CENTER_TAB_SIZE,
            height: CENTER_TAB_SIZE,
            borderRadius: CENTER_TAB_SIZE / 2,
          }}
        >
          <TouchableOpacity
            onPress={() => {
              lightHaptic();
              openSheet();
            }}
            activeOpacity={0.85}
            testID="tab-create-fab"
            accessibilityLabel="Create"
            style={{
              flex: 1,
              borderRadius: CENTER_TAB_SIZE / 2,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.8)',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 10,
              ...(Platform.OS === 'ios' && { elevation: 6 }),
              overflow: 'hidden',
            }}
          >
            {/* Base gradient — light refraction from top-left to bottom-right */}
            <LinearGradient
              colors={
                isDark
                  ? ['rgba(255,255,255,0.18)', 'rgba(255,255,255,0.04)', 'rgba(0,0,0,0.1)']
                  : ['rgba(255,255,255,0.95)', 'rgba(220,230,235,0.6)', 'rgba(180,200,210,0.4)']
              }
              locations={[0, 0.5, 1]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={{
                flex: 1,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Ionicons
                name="add"
                size={34}
                color={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.35)'}
              />
            </LinearGradient>
          </TouchableOpacity>
        </WalkthroughableView>
      </CopilotStep>
    </View>
  );
}

/**
 * Dummy component for Actions tab - never rendered since we intercept the tap
 */
function ActionsPlaceholder() {
  return null;
}

/**
 * Main screen wrapper: bottom tabs.
 * MatchDetailSheet, ActionsBottomSheet and FeedbackSheet are rendered
 * at the top level inside NavigationContainer in App.tsx.
 */
function MainWithSheets() {
  return <BottomTabs />;
}

// =============================================================================
// BOTTOM TABS
// =============================================================================

// =============================================================================
// TOUR TAB ICONS - Wrapped with CopilotStep for guided tour
// =============================================================================

// Standard padding for tab icon highlight area
const TAB_ICON_PADDING = 8;

/**
 * Home tab icon with tour step
 */
/**
 * Home tab icon. Shows tennis.svg when tennis is selected, pickleball.svg when pickleball is selected.
 */
function HomeTabIcon({ color, size }: { color: string; size: number }) {
  const { t } = useTranslation();
  const { selectedSport } = useSport();
  const isPickleball = selectedSport?.name?.toLowerCase() === 'pickleball';
  const IconComponent = isPickleball ? PickleballIcon : TennisIcon;
  return (
    <CopilotStep text={t('tour.mainNavigation.home.description')} order={1} name="home-tab">
      <WalkthroughableView
        style={{
          width: size + TAB_ICON_PADDING * 2,
          height: size + TAB_ICON_PADDING * 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <IconComponent width={size} height={size} fill={color} />
      </WalkthroughableView>
    </CopilotStep>
  );
}

/**
 * Courts/Games tab icon with tour step. Uses tennis-court.svg.
 */
function CourtsTabIcon({ color, size }: { color: string; size: number }) {
  const { t } = useTranslation();
  return (
    <CopilotStep text={t('tour.mainNavigation.courts.description')} order={2} name="courts-tab">
      <WalkthroughableView
        style={{
          width: size + TAB_ICON_PADDING * 2,
          height: size + TAB_ICON_PADDING * 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <TennisCourtIcon width={size} height={size} stroke={color} />
        </View>
      </WalkthroughableView>
    </CopilotStep>
  );
}

/**
 * Community tab icon with tour step
 */
function CommunityTabIcon({ color, size }: { color: string; size: number }) {
  const { t } = useTranslation();
  return (
    <CopilotStep
      text={t('tour.mainNavigation.community.description')}
      order={4}
      name="community-tab"
    >
      <WalkthroughableView
        style={{
          width: size + TAB_ICON_PADDING * 2,
          height: size + TAB_ICON_PADDING * 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="people-outline" size={size} color={color} />
      </WalkthroughableView>
    </CopilotStep>
  );
}

/**
 * Chat tab icon with tour step and unread badge
 */
function ChatTabIconWithTour({ color, size }: { color: string; size: number }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const playerId = session?.user?.id;
  const { data: unreadCount } = useTotalUnreadCount(playerId);
  const { colors } = useThemeStyles();
  const queryClient = useQueryClient();

  // Self-heal the badge when returning to foreground: realtime channels can
  // drop while the app is suspended, so refetch unread counts on every wake.
  useEffect(() => {
    if (!playerId) return;
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        queryClient.invalidateQueries({ queryKey: chatKeys.unreadCount(playerId) });
        queryClient.invalidateQueries({ queryKey: chatKeys.playerConversations(playerId) });
        queryClient.invalidateQueries({ queryKey: chatKeys.unreadConversationsCount(playerId) });
      }
    });
    return () => sub.remove();
  }, [playerId, queryClient]);

  const count = unreadCount ?? 0;
  const showBadge = count > 0;
  const displayCount = count > 99 ? '99+' : count.toString();

  return (
    <CopilotStep text={t('tour.mainNavigation.chat.description')} order={5} name="chat-tab">
      <WalkthroughableView
        style={{
          width: size + TAB_ICON_PADDING * 2,
          height: size + TAB_ICON_PADDING * 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="chatbubbles-outline" size={size} color={color} />
        {showBadge && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              backgroundColor: colors.error,
              borderRadius: 10,
              minWidth: count > 99 ? 24 : count > 9 ? 20 : 16,
              height: 16,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 4,
            }}
          >
            <RNText
              style={{
                color: '#FFFFFF',
                fontSize: count > 99 ? 8 : count > 9 ? 9 : 10,
                fontWeight: '700',
                textAlign: 'center',
              }}
            >
              {displayCount}
            </RNText>
          </View>
        )}
      </WalkthroughableView>
    </CopilotStep>
  );
}

type TabName = keyof BottomTabParamList;

/**
 * Listener that resets a tab's nested stack to its root screen when the tab loses focus.
 * This ensures users always see the home screen when switching back to a tab.
 *
 * Only resets on actual tab switches — NOT when a parent stack screen (e.g. PlayerProfile)
 * is pushed on top, which also triggers blur but should preserve the nested stack.
 */
const resetStackOnBlur = ({
  navigation,
  route,
}: BottomTabScreenProps<BottomTabParamList, TabName>) => ({
  blur: () => {
    const state = navigation.getState();
    const tabIndex = state.routes.findIndex(r => r.key === route.key);

    // If this tab is still the active tab, blur was caused by a parent navigator
    // pushing a screen (e.g. PlayerProfile) — don't reset the stack.
    if (state.index === tabIndex) return;

    const tabRoute = state.routes[tabIndex];
    if (tabRoute?.state && typeof tabRoute.state.index === 'number' && tabRoute.state.index > 0) {
      navigation.dispatch({
        ...StackActions.popToTop(),
        target: tabRoute.state.key,
      });
    }
  },
});

function BottomTabs() {
  const { colors } = useThemeStyles();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      id="BottomTabs"
      safeAreaInsets={{
        bottom: insets.bottom + (Platform.OS === 'android' ? spacingPixels[6] : spacingPixels[2]),
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 10,
        },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          overflow: 'visible',
        },
        tabBarItemStyle: {
          paddingVertical: spacingPixels[2],
        },
        tabBarButton: props => <TabButtonWithHaptic {...props} />,
      }}
    >
      <Tab.Screen
        name="Home"
        getComponent={() => HomeStack}
        options={{
          tabBarLabel: t('navigation.matches'),
          tabBarIcon: ({ color, size }) => <HomeTabIcon color={color} size={size} />,
        }}
        listeners={resetStackOnBlur}
      />
      <Tab.Screen
        name="Courts"
        getComponent={() => CourtsStack}
        options={{
          tabBarLabel: t('navigation.courts'),
          tabBarIcon: ({ color, size }) => <CourtsTabIcon color={color} size={size} />,
        }}
        listeners={resetStackOnBlur}
      />
      <Tab.Screen
        name="Actions"
        getComponent={() => ActionsPlaceholder}
        options={{
          tabBarShowLabel: false,
          tabBarIcon: () => null,
          tabBarButton: props => <CenterTabButton {...props} />,
        }}
        listeners={{
          tabPress: e => {
            // Prevent default navigation to the Actions tab
            e.preventDefault();
            // The actual sheet opening is handled by CenterTabButton
          },
        }}
      />
      <Tab.Screen
        name="Community"
        getComponent={() => CommunityStack}
        options={{
          tabBarLabel: t('navigation.players'),
          tabBarIcon: ({ color, size }) => <CommunityTabIcon color={color} size={size} />,
        }}
        listeners={resetStackOnBlur}
      />
      <Tab.Screen
        name="Chat"
        getComponent={() => ChatStack}
        options={{
          tabBarLabel: t('navigation.chat'),
          tabBarIcon: ({ color, size }) => <ChatTabIconWithTour color={color} size={size} />,
        }}
        listeners={resetStackOnBlur}
      />
    </Tab.Navigator>
  );
}

// =============================================================================
// ROOT NAVIGATOR
// =============================================================================

/**
 * Back button component with theme-aware colors
 * Uses TouchableOpacity for proper touch handling and immediate response
 */
function ThemedBackButton({
  navigation,
  icon = 'chevron-back-outline',
}: {
  navigation: { goBack: () => void };
  icon?: string;
}) {
  const { colors } = useThemeStyles();
  return (
    <TouchableOpacity
      onPress={() => {
        lightHaptic();
        navigation.goBack();
      }}
      activeOpacity={0.6}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={{ marginLeft: spacingPixels[2], padding: spacingPixels[1] }}
    >
      <Ionicons
        name={icon as keyof typeof Ionicons.glyphMap}
        size={28}
        color={colors.headerForeground}
      />
    </TouchableOpacity>
  );
}

/**
 * Map Stack - Map view with facility detail drill-down
 * Presented as a fullScreenModal from the root stack, with FacilityDetail
 * pushing as a regular card inside the modal.
 */
function MapStack() {
  const { t } = useTranslation();
  const sharedOptions = getSharedScreenOptions();

  return (
    <MapStackNavigator.Navigator id="MapStack" screenOptions={fastAnimationOptions}>
      <MapStackNavigator.Screen
        name="MapView"
        getComponent={() => MapScreen}
        options={{ headerShown: false }}
      />
      <MapStackNavigator.Screen
        name="FacilityDetail"
        getComponent={() => FacilityDetail}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('facilitiesTab.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />
    </MapStackNavigator.Navigator>
  );
}

/**
 * Main App Navigator
 *
 * Structure:
 * - PreOnboarding: First-time wizard (sports, postal code, location permission) for new users
 * - Main: Bottom tabs with minimal stacks (shown after pre-onboarding complete)
 * - Shared screens: UserProfile, SportProfile, Settings, Notifications, RatingProofs
 *   These are full-screen (tabs hidden) and accessible from anywhere
 */
export default function AppNavigator() {
  const { t } = useTranslation();
  const { isSportSelectionComplete } = useOverlay();
  const sharedOptions = getSharedScreenOptions();

  return (
    <RootStack.Navigator
      id="RootStack"
      initialRouteName={isSportSelectionComplete ? 'Main' : 'PreOnboarding'}
      screenOptions={fastAnimationOptions}
    >
      {/* First-time pre-onboarding wizard - shown before Main for new users */}
      {!isSportSelectionComplete && (
        <RootStack.Screen
          name="PreOnboarding"
          getComponent={() => PreOnboardingScreen}
          options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
        />
      )}

      {/* Main app entry - only rendered after sport selection is complete */}
      <RootStack.Screen
        name="Main"
        getComponent={() => MainWithSheets}
        options={{ headerShown: false }}
      />

      {/* Shared screens - full screen, tabs hidden */}
      <RootStack.Screen
        name="UserProfile"
        getComponent={() => UserProfile}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.profile'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="PlayerProfile"
        getComponent={() => PlayerProfile}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.playerProfile'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="SportProfile"
        getComponent={() => SportProfile}
        options={({ route, navigation }) => ({
          ...sharedOptions,
          headerTitle: route.params?.sportName
            ? route.params.sportName.charAt(0).toUpperCase() + route.params.sportName.slice(1)
            : t('screens.sportProfile'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="Settings"
        getComponent={() => SettingsScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.settings'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="Paywall"
        getComponent={() => Paywall}
        options={{ headerShown: false, presentation: 'modal' }}
      />

      <RootStack.Screen
        name="SubscriptionManagement"
        getComponent={() => SubscriptionManagement}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('subscription.manage'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="Notifications"
        getComponent={() => Notifications}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.notifications'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="NotificationPreferences"
        getComponent={() => NotificationPreferencesScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.notificationPreferences'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="Permissions"
        getComponent={() => PermissionsScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.permissions'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminPanel"
        getComponent={() => AdminPanelScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('admin.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminDashboard"
        getComponent={() => AdminDashboardScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('admin.analytics.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminUsers"
        getComponent={() => AdminUsersScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('admin.users.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminUserDetail"
        getComponent={() => AdminUserDetailScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('admin.users.detail.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminNetworks"
        getComponent={() => AdminNetworksScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('admin.networks.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminNetworkDetail"
        getComponent={() => AdminNetworkDetailScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('admin.networks.detail.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminActivityLog"
        getComponent={() => AdminActivityLogScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminAlerts"
        getComponent={() => AdminAlertsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminSettings"
        getComponent={() => AdminSettingsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminModeration"
        getComponent={() => AdminModerationScreen}
        options={{ headerShown: false }}
      />

      {/* Phase 2 Analytics Sub-Views */}
      <RootStack.Screen
        name="AdminOnboardingAnalytics"
        getComponent={() => AdminOnboardingAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminUserAnalytics"
        getComponent={() => AdminUserAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminMatchAnalytics"
        getComponent={() => AdminMatchAnalyticsScreen}
        options={{ headerShown: false }}
      />

      {/* Phase 3 Analytics Sub-Views */}
      <RootStack.Screen
        name="AdminEngagementAnalytics"
        getComponent={() => AdminEngagementAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminMessagingAnalytics"
        getComponent={() => AdminMessagingAnalyticsScreen}
        options={{ headerShown: false }}
      />

      {/* Phase 4 Analytics Sub-Views */}
      <RootStack.Screen
        name="AdminRatingAnalytics"
        getComponent={() => AdminRatingAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminModerationAnalytics"
        getComponent={() => AdminModerationAnalyticsScreen}
        options={{ headerShown: false }}
      />

      {/* Phase 5 Analytics Sub-Views */}
      <RootStack.Screen
        name="AdminCommunityAnalytics"
        getComponent={() => AdminCommunityAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminSportAnalytics"
        getComponent={() => AdminSportAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="Map"
        getComponent={() => MapStack}
        options={{
          headerShown: false,
        }}
      />

      <RootStack.Screen
        name="RatingProofs"
        getComponent={() => RatingProofs}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.ratingProofs'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="RatingReferences"
        getComponent={() => RatingReferences}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.ratingReferences'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="IncomingReferenceRequests"
        getComponent={() => IncomingReferenceRequests}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('referenceRequest.screenTitle'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="GroupDetail"
        getComponent={() => GroupDetail}
        options={({ route, navigation }) => ({
          ...sharedOptions,
          headerTitle: route.params?.groupName || t('screens.group'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="CommunityDetail"
        getComponent={() => CommunityDetail}
        options={({ route, navigation }) => ({
          ...sharedOptions,
          headerTitle: route.params?.communityName || t('community.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="Tournaments"
        component={Tournaments}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('tournamentList.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="MyTournaments"
        component={MyTournaments}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('tournamentList.myTournaments'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="TournamentDetail"
        component={TournamentDetail}
        options={({ route, navigation }) => ({
          ...sharedOptions,
          headerTitle: route.params?.tournamentName || t('tournamentDetail.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="FacilityDetail"
        getComponent={() => FacilityDetail}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('facilitiesTab.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="GroupChatInfo"
        getComponent={() => GroupChatInfo}
        options={{
          headerShown: false,
        }}
      />

      <RootStack.Screen
        name="PlayedMatchDetail"
        getComponent={() => PlayedMatchDetail}
        options={{
          headerShown: false,
        }}
      />

      <RootStack.Screen
        name="NetworkMatches"
        getComponent={() => NetworkMatches}
        options={{
          headerShown: false,
        }}
      />

      <RootStack.Screen
        name="ChatConversation"
        getComponent={() => ChatConversation}
        options={{
          headerShown: false,
        }}
      />

      {/* My Bookings screens commented out for now
      <RootStack.Screen
        name="MyBookings"
        getComponent={() => MyBookingsScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('myBookings.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="BookingDetail"
        getComponent={() => BookingDetailScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('myBookings.detail.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />
      */}

      <RootStack.Screen
        name="InviteReferral"
        getComponent={() => InviteReferralScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="WeeklyCheckIn"
        getComponent={() => WeeklyCheckInScreen}
        options={{
          headerShown: false,
          presentation: 'modal',
          gestureEnabled: false, // mandatory check-in — no swipe-to-dismiss
        }}
      />
    </RootStack.Navigator>
  );
}
