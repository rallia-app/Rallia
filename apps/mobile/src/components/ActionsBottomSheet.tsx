/**
 * Actions Bottom Sheet - Main action sheet for the app
 *
 * This bottom sheet opens when the center tab button is pressed.
 * It displays different content based on authentication state:
 * - Guest: AuthWizard for sign in/sign up
 * - Authenticated (not onboarded): OnboardingWizard to complete profile
 * - Onboarded: Actions wizard for creating matches, groups, etc.
 *
 * Content mode is managed by ActionsSheetContext as the single source of truth,
 * eliminating race conditions and complex state synchronization.
 *
 * All four actions slide in their respective wizard panels.
 */

import * as React from 'react';
import { useCallback, useMemo, useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
} from 'react-native-reanimated';
import ActionSheet, { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton, ToastOverlay } from '@rallia/shared-components';
import {
  lightTheme,
  darkTheme,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  status,
} from '@rallia/design-system';

const BASE_WHITE = '#ffffff';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import { useTheme, useAdminStatus } from '@rallia/shared-hooks';
import { getMatchWithDetails } from '@rallia/shared-services';

import { useTranslation, type TranslationKey } from '#/hooks';
import { useActionsSheet, useMatchDetailSheet, useSport } from '#/context';
import { MatchCreationWizard } from '#/features/matches';
import { TournamentCreationWizard } from '#/features/tournaments';
import { LeagueCreationWizard } from '#/features/leagues';
import { InvitePlayersWizard } from '#/features/referral';
import { CreateNetworkWizard } from '#/features/groups';
import { AuthWizard } from '#/features/auth';
import { OnboardingWizard } from '#/features/onboarding/components/wizard';
import { navigateFromOutside, navigationRef } from '#/navigation';
import * as Analytics from '#/services/analytics';

import { SportIcon } from './SportIcon';

// =============================================================================
// TYPES
// =============================================================================

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  icon: string;
  iconMuted: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  buttonTextInactive: string;
  // Extended colors for auth/onboarding wizards
  progressActive: string;
  progressInactive: string;
  inputBackground: string;
  inputBorder: string;
  inputBorderFocused: string;
  error: string;
  success: string;
  divider: string;
}

/**
 * Action item for the actions wizard
 */
interface ActionItemProps {
  icon: keyof typeof Ionicons.glyphMap | 'sport';
  title: string;
  description: string;
  onPress: () => void;
  colors: ThemeColors;
  testID?: string;
}

const ActionItem: React.FC<ActionItemProps> = ({
  icon,
  title,
  description,
  onPress,
  colors,
  testID,
}) => {
  const { selectedSport } = useSport();
  return (
    <TouchableOpacity
      style={[styles.actionItem, { borderBottomColor: colors.border }]}
      onPress={() => {
        lightHaptic();
        onPress();
      }}
      activeOpacity={0.7}
      testID={testID}
    >
      <View style={[styles.actionIconContainer, { backgroundColor: colors.buttonInactive }]}>
        {icon === 'sport' ? (
          <SportIcon
            sportName={selectedSport?.name ?? 'tennis'}
            size={24}
            color={colors.buttonActive}
          />
        ) : (
          <Ionicons name={icon} size={24} color={colors.buttonActive} />
        )}
      </View>
      <View style={styles.actionTextContainer}>
        <Text size="base" weight="semibold" color={colors.text}>
          {title}
        </Text>
        <Text size="sm" color={colors.textMuted} style={styles.actionDescription}>
          {description}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.iconMuted} />
    </TouchableOpacity>
  );
};

/**
 * Actions wizard content - Shown to fully onboarded users
 */
interface ActionsContentProps {
  onClose: () => void;
  onCreateMatch: () => void;
  onCreateTournament: () => void;
  onCreateLeague: () => void;
  onInvitePlayers: () => void;
  onCreateNetwork: () => void;
  showCreateTournament: boolean;
  showCreateLeague: boolean;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
}

const ActionsContent: React.FC<ActionsContentProps> = ({
  onClose,
  onCreateMatch,
  onCreateTournament,
  onCreateLeague,
  onInvitePlayers,
  onCreateNetwork,
  showCreateTournament,
  showCreateLeague,
  colors,
  t,
}) => {
  return (
    <View style={[styles.contentContainer, { paddingBottom: spacingPixels[4] }]}>
      <View style={styles.actionsList}>
        <ActionItem
          icon="person-add-outline"
          title={t('actions.invitePlayers')}
          description={t('actions.invitePlayersDescription')}
          onPress={onInvitePlayers}
          colors={colors}
        />

        <ActionItem
          icon="sport"
          title={t('actions.createMatch')}
          description={t('actions.createMatchDescription')}
          onPress={onCreateMatch}
          colors={colors}
        />

        {showCreateTournament && (
          <ActionItem
            icon="trophy-outline"
            title={t('actions.createTournament')}
            description={t('actions.createTournamentDescription')}
            onPress={onCreateTournament}
            colors={colors}
            testID="action-create-tournament"
          />
        )}

        {showCreateLeague && (
          <ActionItem
            icon="ribbon-outline"
            title={t('actions.createLeague')}
            description={t('actions.createLeagueDescription')}
            onPress={onCreateLeague}
            colors={colors}
            testID="action-create-league"
          />
        )}

        <ActionItem
          icon="people-outline"
          title={t('actions.createNetwork')}
          description={t('actions.createNetworkDescription')}
          onPress={onCreateNetwork}
          colors={colors}
        />
      </View>
    </View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');
const MAX_SHEET_HEIGHT = SCREEN_HEIGHT * 0.9; // 90% of screen height

export const ActionsBottomSheet: React.FC = () => {
  // Get contentMode and setContentMode from context - single source of truth
  const {
    closeSheet,
    contentMode,
    setContentMode,
    refreshProfile,
    editMatchData,
    clearEditMatch,
    shouldOpenMatchCreation,
    matchCreationSource,
    matchCreationPrefill,
    clearMatchCreationPrefill,
    clearMatchCreationFlag,
    shouldOpenTournamentCreation,
    clearTournamentCreationFlag,
    shouldOpenLeagueCreation,
    clearLeagueCreationFlag,
    shouldOpenInvitePlayers,
    clearInvitePlayersFlag,
    initialBookingForWizard,
    clearInitialBookingFlag,
  } = useActionsSheet();
  const { openSheet: openMatchDetail } = useMatchDetailSheet();
  const { theme } = useTheme();
  const { isAdmin } = useAdminStatus();
  const { t } = useTranslation();
  const isDark = theme === 'dark';
  // Both leagues and tournaments are admin-gated during rollout.
  const showCreateTournament = isAdmin;
  const showCreateLeague = isAdmin;

  // Wizard state for all sliding panels (local, only for slide animation)
  const [showWizard, setShowWizard] = useState(false);
  const [showTournamentWizard, setShowTournamentWizard] = useState(false);
  const [showLeagueWizard, setShowLeagueWizard] = useState(false);
  const [showInviteWizard, setShowInviteWizard] = useState(false);
  const [showNetworkWizard, setShowNetworkWizard] = useState(false);

  // Track which tab the invite wizard should open to
  const [inviteInitialTab, setInviteInitialTab] = useState<'code' | 'qr' | 'contacts' | undefined>(
    undefined
  );

  // If we have editMatchData, we're in edit mode - show wizard immediately
  const isEditMode = !!editMatchData;

  // Animation value for slide transition
  const slideProgress = useSharedValue(0);

  // Helper to slide wizard in
  const slideIn = useCallback(() => {
    // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are designed to be mutated
    slideProgress.value = withSpring(1, { damping: 80, stiffness: 600, overshootClamping: false });
  }, [slideProgress]);

  // Helper to slide wizard out with callback
  const slideOut = useCallback(
    (onComplete: () => void) => {
      // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are designed to be mutated
      slideProgress.value = withSpring(0, {
        damping: 80,
        stiffness: 600,
        overshootClamping: false,
      });
      setTimeout(onComplete, 300);
    },
    [slideProgress]
  );

  // Effect to automatically open match creation wizard when flag is set
  useEffect(() => {
    if (shouldOpenMatchCreation && contentMode === 'actions' && !showWizard && !isEditMode) {
      Analytics.matchCreationStarted({ source: matchCreationSource ?? 'direct' });
      // Clear the flag first
      clearMatchCreationFlag();
      // Then trigger the wizard with a small delay to ensure sheet is fully presented
      setTimeout(() => {
        setShowWizard(true);
        slideIn();
      }, 100);
    }
  }, [
    shouldOpenMatchCreation,
    matchCreationSource,
    contentMode,
    showWizard,
    isEditMode,
    clearMatchCreationFlag,
    slideIn,
  ]);

  // Effect to automatically open tournament creation wizard when flag is set
  useEffect(() => {
    if (
      showCreateTournament &&
      shouldOpenTournamentCreation &&
      contentMode === 'actions' &&
      !showTournamentWizard &&
      !isEditMode
    ) {
      clearTournamentCreationFlag();
      setTimeout(() => {
        setShowTournamentWizard(true);
        slideIn();
      }, 100);
    }
  }, [
    showCreateTournament,
    shouldOpenTournamentCreation,
    contentMode,
    showTournamentWizard,
    isEditMode,
    clearTournamentCreationFlag,
    slideIn,
  ]);

  // Effect to automatically open league creation wizard when flag is set.
  // showCreateLeague keeps the admin gate: a non-admin who somehow sets the flag
  // lands on the actions menu instead of the wizard.
  useEffect(() => {
    if (
      showCreateLeague &&
      shouldOpenLeagueCreation &&
      contentMode === 'actions' &&
      !showLeagueWizard &&
      !isEditMode
    ) {
      clearLeagueCreationFlag();
      setTimeout(() => {
        setShowLeagueWizard(true);
        slideIn();
      }, 100);
    }
  }, [
    showCreateLeague,
    shouldOpenLeagueCreation,
    contentMode,
    showLeagueWizard,
    isEditMode,
    clearLeagueCreationFlag,
    slideIn,
  ]);

  // Effect to automatically open invite players wizard when flag is set
  useEffect(() => {
    if (shouldOpenInvitePlayers && contentMode === 'actions' && !showInviteWizard && !isEditMode) {
      clearInvitePlayersFlag();
      setTimeout(() => {
        setShowInviteWizard(true);
        slideIn();
      }, 100);
    }
  }, [
    shouldOpenInvitePlayers,
    contentMode,
    showInviteWizard,
    isEditMode,
    clearInvitePlayersFlag,
    slideIn,
  ]);

  // Theme-aware colors from design system
  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = useMemo<ThemeColors>(
    () => ({
      background: themeColors.background,
      cardBackground: themeColors.card,
      text: themeColors.foreground,
      textSecondary: isDark ? primary[300] : neutral[600],
      textMuted: themeColors.mutedForeground,
      border: themeColors.border,
      icon: themeColors.foreground,
      iconMuted: themeColors.mutedForeground,
      buttonInactive: themeColors.muted,
      buttonActive: isDark ? primary[500] : primary[600],
      buttonTextInactive: themeColors.mutedForeground,
      buttonTextActive: BASE_WHITE,
      // Extended colors for auth/onboarding wizards
      progressActive: isDark ? primary[500] : primary[600],
      progressInactive: themeColors.muted,
      inputBackground: isDark ? neutral[800] : neutral[100],
      inputBorder: isDark ? neutral[700] : neutral[200],
      inputBorderFocused: isDark ? primary[500] : primary[600],
      error: status.error.DEFAULT,
      success: status.success.DEFAULT,
      divider: isDark ? neutral[700] : neutral[200],
    }),
    [themeColors, isDark]
  );

  // Handle auth success - simple and direct
  const handleAuthSuccess = useCallback(
    (needsOnboarding: boolean) => {
      if (needsOnboarding) {
        // Transition to onboarding - smooth, same sheet stays open
        setContentMode('onboarding');
      } else {
        // Returning user with completed onboarding - close sheet
        successHaptic();
        closeSheet();
      }
    },
    [setContentMode, closeSheet]
  );

  // Handle onboarding complete
  const handleOnboardingComplete = useCallback(async () => {
    successHaptic();
    // Refresh profile to update onboarding_completed status before closing
    // This ensures the next openSheet() call computes the correct mode
    await refreshProfile();
    closeSheet();
  }, [closeSheet, refreshProfile]);

  // Handle going back from auth/onboarding - closes sheet
  const handleBackToActionsLanding = useCallback(() => {
    closeSheet();
  }, [closeSheet]);

  // Handle create match - show wizard with slide animation
  const handleCreateMatch = useCallback(() => {
    lightHaptic();
    Analytics.matchCreationStarted({ source: 'plus_menu' });
    setShowWizard(true);
    slideIn();
  }, [slideIn]);

  // Handle invite players - show invite wizard with slide animation
  const handleInvitePlayers = useCallback(() => {
    lightHaptic();
    Analytics.referralInviteOpened({ source: 'actions_sheet' });
    setInviteInitialTab(undefined);
    setShowInviteWizard(true);
    slideIn();
  }, [slideIn]);

  // Handle create network - show network wizard with slide animation
  const handleCreateNetwork = useCallback(() => {
    lightHaptic();
    setShowNetworkWizard(true);
    slideIn();
  }, [slideIn]);

  // Handle create tournament - show tournament wizard with slide animation
  const handleCreateTournament = useCallback(() => {
    lightHaptic();
    setShowTournamentWizard(true);
    slideIn();
  }, [slideIn]);

  const handleCreateLeague = useCallback(() => {
    lightHaptic();
    setShowLeagueWizard(true);
    slideIn();
  }, [slideIn]);

  const handleTournamentWizardClose = useCallback(() => {
    slideOut(() => setShowTournamentWizard(false));
  }, [slideOut]);

  // Handle tournament wizard success - close sheet and navigate to detail screen
  const handleTournamentSuccess = useCallback(
    (tournamentId: string, openInviteSheet = false) => {
      successHaptic();
      closeSheet();
      setShowTournamentWizard(false);
      // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are designed to be mutated
      slideProgress.value = 0;

      // Wait for the sheet's close animation before pushing the screen so
      // the navigation transition isn't competing with the sheet collapse.
      setTimeout(() => {
        if (navigationRef.isReady()) {
          navigationRef.navigate('TournamentDetail', { tournamentId, openInviteSheet });
        }
      }, 300);
    },
    [closeSheet, slideProgress]
  );

  // "Share invite link" on the success screen: same close-and-navigate, but
  // the detail screen opens the invite sheet on arrival. The actions sheet is
  // fully closed before any sheet shows, so no sheet-to-sheet transition.
  const handleTournamentShareInvite = useCallback(
    (tournamentId: string) => handleTournamentSuccess(tournamentId, true),
    [handleTournamentSuccess]
  );

  const handleLeagueWizardClose = useCallback(() => {
    slideOut(() => setShowLeagueWizard(false));
  }, [slideOut]);

  const handleLeagueSuccess = useCallback(
    (leagueId: string) => {
      successHaptic();
      closeSheet();
      setShowLeagueWizard(false);
      // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are designed to be mutated
      slideProgress.value = 0;
      setTimeout(() => {
        if (navigationRef.isReady()) {
          navigationRef.navigate('LeagueDetail', { leagueId });
        }
      }, 300);
    },
    [closeSheet, slideProgress]
  );

  // Handle invite wizard close - slide back to actions list
  const handleInviteWizardClose = useCallback(() => {
    slideOut(() => {
      setShowInviteWizard(false);
      setInviteInitialTab(undefined);
    });
  }, [slideOut]);

  // Handle network wizard close - slide back to actions list
  const handleNetworkWizardClose = useCallback(() => {
    slideOut(() => setShowNetworkWizard(false));
  }, [slideOut]);

  // Handle wizard close - slide back to actions list
  const handleWizardClose = useCallback(() => {
    // If in edit mode, close the sheet entirely
    if (isEditMode) {
      clearEditMatch();
      closeSheet();
      return;
    }

    slideOut(() => setShowWizard(false));
  }, [slideOut, isEditMode, clearEditMatch, closeSheet]);

  // Handle wizard success
  const handleWizardSuccess = useCallback(
    async (matchId: string) => {
      successHaptic();
      // Close the sheet and reset wizard state
      closeSheet();
      setShowWizard(false);
      // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are designed to be mutated
      slideProgress.value = 0;
      clearEditMatch();

      // Fetch the match details and open the match detail sheet
      try {
        const matchDetails = await getMatchWithDetails(matchId);
        if (matchDetails) {
          // Navigate to PlayerMatches screen first (using ref-based navigation for outside NavigationContainer)
          navigateFromOutside('PlayerMatches');
          // Small delay to ensure navigation completes before opening sheet
          setTimeout(() => {
            openMatchDetail(matchDetails, { source: 'match_creation' });
          }, 300);
        }
      } catch (error) {
        console.error('Failed to fetch match details:', error);
        // Still navigate to PlayerMatches even if fetch fails
        navigateFromOutside('PlayerMatches');
      }
    },
    [closeSheet, slideProgress, openMatchDetail, clearEditMatch]
  );

  // Handle network wizard success - navigate to created group or community
  const handleNetworkSuccess = useCallback(
    (type: 'group' | 'community', id: string) => {
      successHaptic();
      closeSheet();
      setShowNetworkWizard(false);
      // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are designed to be mutated
      slideProgress.value = 0;

      if (type === 'group') {
        if (navigationRef.isReady()) {
          navigationRef.navigate('GroupDetail', { groupId: id });
        }
      } else {
        if (navigationRef.isReady()) {
          navigationRef.navigate('CommunityDetail', { communityId: id });
        }
      }
    },
    [closeSheet, slideProgress]
  );

  // Handle sheet dismiss - just reset local wizard state
  const handleSheetDismiss = useCallback(() => {
    setShowWizard(false);
    setShowTournamentWizard(false);
    setShowInviteWizard(false);
    setInviteInitialTab(undefined);
    setShowNetworkWizard(false);
    // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are designed to be mutated
    slideProgress.value = 0;
    clearEditMatch();
    // Note: contentMode is reset by openSheet when the sheet is opened again
  }, [slideProgress, clearEditMatch]);

  // Animated styles for content sliding
  const actionsAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(slideProgress.value, [0, 1], [0, -SCREEN_WIDTH]),
      },
    ],
    opacity: interpolate(slideProgress.value, [0, 0.5, 1], [1, 0.5, 0]),
  }));

  const wizardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(slideProgress.value, [0, 1], [SCREEN_WIDTH, 0]),
      },
    ],
    opacity: interpolate(slideProgress.value, [0, 0.5, 1], [0, 0.5, 1]),
  }));

  // Theme-aware skeleton colors (match FacilityDetail / FacilitiesDirectory)
  const skeletonBg = isDark ? neutral[800] : '#E1E9EE';
  const skeletonHighlight = isDark ? neutral[700] : '#F2F8FC';

  // Determine which content to show based on contentMode from context
  const renderContent = () => {
    if (contentMode === 'loading') {
      const ACTION_ITEMS_COUNT = 3 + (showCreateTournament ? 1 : 0) + (showCreateLeague ? 1 : 0);
      const iconSize = spacingPixels[11];
      return (
        <View style={[styles.contentContainer, { paddingBottom: spacingPixels[4] }]}>
          <View style={styles.actionsList}>
            {Array.from({ length: ACTION_ITEMS_COUNT }).map((_, index) => (
              <View key={index} style={[styles.actionItem, { borderBottomColor: colors.border }]}>
                <Skeleton
                  width={iconSize}
                  height={iconSize}
                  circle
                  backgroundColor={skeletonBg}
                  highlightColor={skeletonHighlight}
                />
                <View style={styles.actionTextContainer}>
                  <Skeleton
                    width="80%"
                    height={16}
                    borderRadius={4}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                  />
                  <Skeleton
                    width="60%"
                    height={12}
                    borderRadius={4}
                    backgroundColor={skeletonBg}
                    highlightColor={skeletonHighlight}
                    style={{ marginTop: spacingPixels[0.5] }}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      );
    }

    if (contentMode === 'auth') {
      return (
        <AuthWizard
          onSuccess={handleAuthSuccess}
          onClose={closeSheet}
          onBackToLanding={handleBackToActionsLanding}
          colors={colors}
          t={t}
          isDark={isDark}
        />
      );
    }

    if (contentMode === 'onboarding') {
      return (
        <OnboardingWizard
          onComplete={handleOnboardingComplete}
          onClose={closeSheet}
          onBackToLanding={handleBackToActionsLanding}
          colors={colors}
          t={t}
          isDark={isDark}
        />
      );
    }

    // contentMode === 'actions' - show actions wizard or match creation/edit wizard
    // If in edit mode, show wizard directly without the actions list
    if (isEditMode) {
      return (
        <MatchCreationWizard
          onClose={closeSheet}
          onBackToLanding={handleWizardClose}
          onSuccess={handleWizardSuccess}
          editMatch={editMatchData}
          initialBookingForWizard={initialBookingForWizard}
          onConsumeInitialBooking={clearInitialBookingFlag}
        />
      );
    }

    return (
      <View style={styles.slidingContainer}>
        {/* Actions list */}
        <Animated.View style={[styles.slidePanel, actionsAnimatedStyle]}>
          <ActionsContent
            onClose={closeSheet}
            onCreateMatch={handleCreateMatch}
            onCreateTournament={handleCreateTournament}
            onCreateLeague={handleCreateLeague}
            onInvitePlayers={handleInvitePlayers}
            onCreateNetwork={handleCreateNetwork}
            showCreateTournament={showCreateTournament}
            showCreateLeague={showCreateLeague}
            colors={colors}
            t={t}
          />
        </Animated.View>

        {/* Match creation wizard */}
        {showWizard && (
          <Animated.View style={[styles.slidePanel, styles.wizardPanel, wizardAnimatedStyle]}>
            <MatchCreationWizard
              onClose={closeSheet}
              onBackToLanding={handleWizardClose}
              onSuccess={handleWizardSuccess}
              initialBookingForWizard={initialBookingForWizard}
              onConsumeInitialBooking={clearInitialBookingFlag}
              matchCreationPrefill={matchCreationPrefill}
              onConsumePrefill={clearMatchCreationPrefill}
            />
          </Animated.View>
        )}

        {/* Tournament creation wizard */}
        {showTournamentWizard && (
          <Animated.View style={[styles.slidePanel, styles.wizardPanel, wizardAnimatedStyle]}>
            <TournamentCreationWizard
              onClose={closeSheet}
              onBackToLanding={handleTournamentWizardClose}
              onSuccess={handleTournamentSuccess}
              onShareInvite={handleTournamentShareInvite}
            />
          </Animated.View>
        )}

        {showLeagueWizard && (
          <Animated.View style={[styles.slidePanel, styles.wizardPanel, wizardAnimatedStyle]}>
            <LeagueCreationWizard
              onClose={closeSheet}
              onBackToLanding={handleLeagueWizardClose}
              onSuccess={handleLeagueSuccess}
            />
          </Animated.View>
        )}

        {/* Invite players wizard */}
        {showInviteWizard && (
          <Animated.View style={[styles.slidePanel, styles.wizardPanel, wizardAnimatedStyle]}>
            <InvitePlayersWizard
              onClose={closeSheet}
              onBackToLanding={handleInviteWizardClose}
              initialTab={inviteInitialTab}
            />
          </Animated.View>
        )}

        {/* Network wizard (Group / Community) */}
        {showNetworkWizard && (
          <Animated.View style={[styles.slidePanel, styles.wizardPanel, wizardAnimatedStyle]}>
            <CreateNetworkWizard
              onClose={closeSheet}
              onBackToLanding={handleNetworkWizardClose}
              onSuccess={handleNetworkSuccess}
            />
          </Animated.View>
        )}
      </View>
    );
  };

  // Full-height mode: sheet fills available space (flex:1 chain).
  // Auth is deliberately NOT in this list — it sizes to content.
  const isFullHeight =
    showWizard ||
    showTournamentWizard ||
    showLeagueWizard ||
    showInviteWizard ||
    showNetworkWizard ||
    isEditMode ||
    contentMode === 'onboarding';

  // Disable gestures/backdrop-dismiss during any wizard flow, including auth,
  // so typing doesn't accidentally close the sheet.
  const disableGestures = isFullHeight || contentMode === 'auth';

  return (
    <ActionSheet
      gestureEnabled={!disableGestures}
      closeOnTouchBackdrop={!disableGestures}
      onClose={handleSheetDismiss}
      ExtraOverlayComponent={<ToastOverlay />}
      containerStyle={[
        styles.sheetBackground,
        { backgroundColor: colors.cardBackground },
        isFullHeight && styles.sheetFullHeight,
      ]}
      indicatorStyle={{
        width: spacingPixels[10],
        height: 4,
        borderRadius: 4,
        alignSelf: 'center',
        backgroundColor: colors.border,
      }}
    >
      {contentMode === 'auth' ? (
        /* Auth wizard has its own SheetScrollView per step — render directly so it auto-sizes */
        renderContent()
      ) : isFullHeight ? (
        /* Full-height wizards manage their own internal scrolling */
        <View style={styles.sheetContent}>{renderContent()}</View>
      ) : (
        /* For actions content, use SheetScrollView — no flex:1 so it auto-sizes to content */
        <SheetScrollView>{renderContent()}</SheetScrollView>
      )}
    </ActionSheet>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
    overflow: 'hidden',
  },
  sheetFullHeight: {
    flex: 1,
  },
  sheetContent: {
    flex: 1,
  },
  wizardContent: {
    flex: 1,
  },
  wizardScrollContent: {
    flexGrow: 1,
  },
  slidingContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  slidePanel: {
    width: '100%',
  },
  wizardPanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  contentContainer: {
    paddingHorizontal: spacingPixels[6],
    paddingTop: spacingPixels[2],
  },
  actionsList: {
    paddingTop: spacingPixels[2],
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
    borderBottomWidth: 1,
  },
  actionIconContainer: {
    width: spacingPixels[11],
    height: spacingPixels[11],
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextContainer: {
    flex: 1,
    marginLeft: spacingPixels[3],
  },
  actionDescription: {
    marginTop: spacingPixels[0.5],
  },
});

export default ActionsBottomSheet;
