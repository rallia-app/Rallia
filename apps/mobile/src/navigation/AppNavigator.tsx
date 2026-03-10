/**
 * App Navigator - Main navigation structure
 *
 * Architecture:
 * - Root Stack: Contains Main (tabs) and all shared screens
 * - Bottom Tabs: Home, Courts, Actions (opens sheet), Community, Chat
 * - Each tab has a minimal stack with only tab-specific screens
 * - Shared screens (UserProfile, Settings, etc.) are in Root Stack for full-screen experience
 *
 * Note: Splash animation is handled by SplashOverlay component in App.tsx
 */

import React, { useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleProp,
  ViewStyle,
  GestureResponderEvent,
  Text as RNText,
} from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StackActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { CopilotStep } from 'react-native-copilot';
import { WalkthroughableView } from '../context/TourContext';
import { lightHaptic } from '@rallia/shared-utils';

// WalkthroughableView is now imported from TourContext with collapsable={false} for reliable Android measurement
import {
  ProfilePictureButton,
  NotificationButton,
  SettingsButton,
} from '@rallia/shared-components';
import { useActionsSheet, useSport, useOverlay } from '../context';
import SportSelector from '../components/SportSelector';
import TennisIcon from '../../assets/icons/tennis.svg';
import PickleballIcon from '../../assets/icons/pickleball.svg';
import TennisCourtIcon from '../../assets/icons/tennis-court.svg';
import { useUnreadNotificationCount, useProfile, useTotalUnreadCount } from '@rallia/shared-hooks';
import { useAuth, useThemeStyles, useTranslation, useRequireOnboarding } from '../hooks';
import { useTheme } from '@rallia/shared-hooks';
import { useAppNavigation } from './hooks';
import { spacingPixels, fontSizePixels } from '@rallia/design-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  NativeStackNavigationProp,
  NativeStackHeaderProps,
} from '@react-navigation/native-stack';

// Screens
import Home from '../screens/Home';
import Community from '../screens/Community';
import Chat from '../screens/Chat';
import ChatConversation from '../screens/ChatConversation';
import ArchivedChats from '../screens/ArchivedChats';
import SettingsScreen from '../screens/SettingsScreen';
import UserProfile from '../screens/UserProfile';
import SportProfile from '../screens/SportProfile';
import RatingProofs from '../screens/RatingProofs';
import IncomingReferenceRequests from '../screens/IncomingReferenceRequests';
import Notifications from '../screens/Notifications';
import NotificationPreferencesScreen from '../screens/NotificationPreferencesScreen';
import PermissionsScreen from '../screens/PermissionsScreen';
import PlayerProfile from '../screens/PlayerProfile';
import SharedLists from '../screens/SharedLists';
import SharedListDetail from '../screens/SharedListDetail';
import Groups from '../screens/Groups';
import GroupDetail from '../screens/GroupDetail';
import PreOnboardingScreen from '../screens/PreOnboarding';
import GroupChatInfo from '../screens/GroupChatInfo';
import PlayedMatchDetail from '../screens/PlayedMatchDetail';
import Communities from '../screens/Communities';
import CommunityDetail from '../screens/CommunityDetail';
import FeedbackScreen from '../screens/FeedbackScreen';
import AdminPanelScreen from '../screens/AdminPanelScreen';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';
import AdminUsersScreen from '../screens/AdminUsersScreen';
import AdminUserDetailScreen from '../screens/AdminUserDetailScreen';
import AdminActivityLogScreen from '../screens/AdminActivityLogScreen';
import AdminAlertsScreen from '../screens/AdminAlertsScreen';
import AdminSettingsScreen from '../screens/AdminSettingsScreen';
import AdminModerationScreen from '../screens/AdminModerationScreen';
// Phase 2 Analytics Sub-Views
import AdminOnboardingAnalyticsScreen from '../screens/admin/AdminOnboardingAnalyticsScreen';
import AdminUserAnalyticsScreen from '../screens/admin/AdminUserAnalyticsScreen';
import AdminMatchAnalyticsScreen from '../screens/admin/AdminMatchAnalyticsScreen';
// Phase 3 Analytics Sub-Views
import AdminEngagementAnalyticsScreen from '../screens/admin/AdminEngagementAnalyticsScreen';
import AdminMessagingAnalyticsScreen from '../screens/admin/AdminMessagingAnalyticsScreen';
// Phase 4 Analytics Sub-Views
import AdminRatingAnalyticsScreen from '../screens/admin/AdminRatingAnalyticsScreen';
import AdminModerationAnalyticsScreen from '../screens/admin/AdminModerationAnalyticsScreen';
// Phase 5 Analytics Sub-Views
import AdminCommunityAnalyticsScreen from '../screens/admin/AdminCommunityAnalyticsScreen';
import AdminSportAnalyticsScreen from '../screens/admin/AdminSportAnalyticsScreen';
import MapScreen from '../screens/Map';

// Components
import { ThemeLogo } from '../components/ThemeLogo';

// Types
import type {
  RootStackParamList,
  BottomTabParamList,
  HomeStackParamList,
  CourtsStackParamList,
  CommunityStackParamList,
  ChatStackParamList,
} from './types';
import PublicMatches from '../features/matches/screens/PublicMatches';
import PlayerMatches from '../features/matches/screens/PlayerMatches';
import { FacilitiesDirectory, FacilityDetail } from '../features/facilities';
import { MyBookingsScreen, BookingDetailScreen } from '../features/bookings';
import { InviteReferralScreen } from '../screens/InviteReferralScreen';

// =============================================================================
// TYPED NAVIGATORS
// =============================================================================

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<BottomTabParamList>();
const HomeStackNavigator = createNativeStackNavigator<HomeStackParamList>();
const CourtsStackNavigator = createNativeStackNavigator<CourtsStackParamList>();
const CommunityStackNavigator = createNativeStackNavigator<CommunityStackParamList>();
const ChatStackNavigator = createNativeStackNavigator<ChatStackParamList>();

// =============================================================================
// SHARED HEADER COMPONENTS
// =============================================================================

/**
 * Notification button with badge showing unread count
 */
function NotificationButtonWithBadge({ color }: { color?: string }) {
  const navigation = useAppNavigation();
  const { session } = useAuth();
  const { data: unreadCount } = useUnreadNotificationCount(session?.user?.id);
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
  const { selectedSport, userSports, setSelectedSport } = useSport();
  const { theme } = useTheme();
  const { session } = useAuth();
  const { contentMode } = useActionsSheet();
  const { refetch } = useProfile();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

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
      // Onboarding was just completed, refetch profile to get updated onboarding_completed status
      refetch();
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
  return (
    <CopilotStep text={t('tour.header.profile.description')} order={6} name="header-profile">
      <WalkthroughableView style={{ flexDirection: 'row', alignItems: 'center' }}>
        <ProfilePictureButton onPress={handlePress} isDark={isDark} />
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
  const { colors } = useThemeStyles();

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
      <HomeStackNavigator.Screen name="HomeScreen" component={Home} options={mainScreenOptions} />
      <HomeStackNavigator.Screen
        name="PublicMatches"
        component={PublicMatches}
        options={publicMatchesOptions}
      />
      <HomeStackNavigator.Screen
        name="PlayerMatches"
        component={PlayerMatches}
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
        component={FacilitiesDirectory}
        options={mainScreenOptions}
      />
      <CourtsStackNavigator.Screen
        name="FacilityDetail"
        component={FacilityDetail}
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
        component={Community}
        options={mainScreenOptions}
      />
      <CommunityStackNavigator.Screen
        name="ShareLists"
        component={SharedLists}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('community.shareLists') || 'Shared Lists',
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />
      <CommunityStackNavigator.Screen
        name="SharedListDetail"
        component={SharedListDetail}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('sharedLists.title') || 'List',
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />
      <CommunityStackNavigator.Screen
        name="Groups"
        component={Groups}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('community.groups') || 'Groups',
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />
      <CommunityStackNavigator.Screen
        name="Communities"
        component={Communities}
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
        component={Chat}
        options={mainScreenOptions}
      />
      <ChatStackNavigator.Screen
        name="ArchivedChats"
        component={ArchivedChats}
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
function CenterTabButton({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  // These are passed by React Navigation but we intentionally ignore them
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: ((e: GestureResponderEvent) => void) | null;
  accessibilityRole?: string;
  accessibilityState?: { selected?: boolean };
  testID?: string;
}) {
  const { openSheet } = useActionsSheet();

  return (
    <TouchableOpacity
      onPress={() => {
        lightHaptic();
        openSheet();
      }}
      style={[
        {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      {children}
    </TouchableOpacity>
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
    <CopilotStep text={t('tour.mainNavigation.matches.description')} order={2} name="courts-tab">
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
 * Actions/Create tab icon with tour step
 */
function ActionsTabIcon({ color, size }: { color: string; size: number }) {
  const { t } = useTranslation();
  const adjustedSize = size * 1.2;
  return (
    <CopilotStep
      text={t('tour.matchesScreen.createMatch.description')}
      order={3}
      name="actions-tab"
    >
      <WalkthroughableView
        style={{
          width: adjustedSize + TAB_ICON_PADDING * 2,
          height: adjustedSize + TAB_ICON_PADDING * 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="add-circle-outline" size={adjustedSize} color={color} />
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
      text={t('tour.profileScreen.sportProfiles.description')}
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
  const { data: unreadCount } = useTotalUnreadCount(session?.user?.id);
  const { colors } = useThemeStyles();

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
  return (
    <Tab.Navigator
      id="BottomTabs"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: spacingPixels[20],
          paddingBottom: spacingPixels[2],
          paddingTop: spacingPixels[2],
        },
        tabBarButton: props => <TabButtonWithHaptic {...props} />,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeStack}
        options={{
          tabBarIcon: ({ color, size }) => <HomeTabIcon color={color} size={size} />,
        }}
        listeners={resetStackOnBlur}
      />
      <Tab.Screen
        name="Courts"
        component={CourtsStack}
        options={{
          tabBarIcon: ({ color, size }) => <CourtsTabIcon color={color} size={size} />,
        }}
        listeners={resetStackOnBlur}
      />
      <Tab.Screen
        name="Actions"
        component={ActionsPlaceholder}
        options={{
          tabBarIcon: ({ color, size }) => <ActionsTabIcon color={color} size={size} />,
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
        component={CommunityStack}
        options={{
          tabBarIcon: ({ color, size }) => <CommunityTabIcon color={color} size={size} />,
        }}
        listeners={resetStackOnBlur}
      />
      <Tab.Screen
        name="Chat"
        component={ChatStack}
        options={{
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
          component={PreOnboardingScreen}
          options={{ headerShown: false, animation: 'fade' }}
        />
      )}

      {/* Main app entry - only rendered after sport selection is complete */}
      <RootStack.Screen name="Main" component={MainWithSheets} options={{ headerShown: false }} />

      {/* Shared screens - full screen, tabs hidden */}
      <RootStack.Screen
        name="UserProfile"
        component={UserProfile}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.profile'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="PlayerProfile"
        component={PlayerProfile}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.playerProfile'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="SportProfile"
        component={SportProfile}
        options={({ route, navigation }) => ({
          ...sharedOptions,
          headerTitle: route.params?.sportName || t('screens.sportProfile'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.settings'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="Notifications"
        component={Notifications}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.notifications'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.notificationPreferences'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="Permissions"
        component={PermissionsScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.permissions'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="Feedback"
        component={FeedbackScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.feedback'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminPanel"
        component={AdminPanelScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('admin.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminDashboard"
        component={AdminDashboardScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('admin.analytics.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminUsers"
        component={AdminUsersScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('admin.users.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminUserDetail"
        component={AdminUserDetailScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('admin.users.detail.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="AdminActivityLog"
        component={AdminActivityLogScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminAlerts"
        component={AdminAlertsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminSettings"
        component={AdminSettingsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminModeration"
        component={AdminModerationScreen}
        options={{ headerShown: false }}
      />

      {/* Phase 2 Analytics Sub-Views */}
      <RootStack.Screen
        name="AdminOnboardingAnalytics"
        component={AdminOnboardingAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminUserAnalytics"
        component={AdminUserAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminMatchAnalytics"
        component={AdminMatchAnalyticsScreen}
        options={{ headerShown: false }}
      />

      {/* Phase 3 Analytics Sub-Views */}
      <RootStack.Screen
        name="AdminEngagementAnalytics"
        component={AdminEngagementAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminMessagingAnalytics"
        component={AdminMessagingAnalyticsScreen}
        options={{ headerShown: false }}
      />

      {/* Phase 4 Analytics Sub-Views */}
      <RootStack.Screen
        name="AdminRatingAnalytics"
        component={AdminRatingAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminModerationAnalytics"
        component={AdminModerationAnalyticsScreen}
        options={{ headerShown: false }}
      />

      {/* Phase 5 Analytics Sub-Views */}
      <RootStack.Screen
        name="AdminCommunityAnalytics"
        component={AdminCommunityAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="AdminSportAnalytics"
        component={AdminSportAnalyticsScreen}
        options={{ headerShown: false }}
      />

      <RootStack.Screen
        name="Map"
        component={MapScreen}
        options={{
          headerShown: false,
          presentation: 'fullScreenModal' as const,
        }}
      />

      <RootStack.Screen
        name="RatingProofs"
        component={RatingProofs}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('screens.ratingProofs'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="IncomingReferenceRequests"
        component={IncomingReferenceRequests}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('referenceRequest.screenTitle'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="GroupDetail"
        component={GroupDetail}
        options={({ route, navigation }) => ({
          ...sharedOptions,
          headerTitle: route.params?.groupName || t('screens.group'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="CommunityDetail"
        component={CommunityDetail}
        options={({ route, navigation }) => ({
          ...sharedOptions,
          headerTitle: route.params?.communityName || 'Community',
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="FacilityDetail"
        component={FacilityDetail}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('facilitiesTab.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="GroupChatInfo"
        component={GroupChatInfo}
        options={{
          headerShown: false,
        }}
      />

      <RootStack.Screen
        name="PlayedMatchDetail"
        component={PlayedMatchDetail}
        options={{
          headerShown: false,
        }}
      />

      <RootStack.Screen
        name="ChatConversation"
        component={ChatConversation}
        options={{
          headerShown: false,
        }}
      />

      {/* My Bookings screens commented out for now
      <RootStack.Screen
        name="MyBookings"
        component={MyBookingsScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('myBookings.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />

      <RootStack.Screen
        name="BookingDetail"
        component={BookingDetailScreen}
        options={({ navigation }) => ({
          ...sharedOptions,
          headerTitle: t('myBookings.detail.title'),
          headerLeft: () => <ThemedBackButton navigation={navigation} />,
        })}
      />
      */}

      <RootStack.Screen
        name="InviteReferral"
        component={InviteReferralScreen}
        options={{ headerShown: false }}
      />
    </RootStack.Navigator>
  );
}
