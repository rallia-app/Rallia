/**
 * Community Screen
 *
 * Main community hub with:
 * - Quick action buttons: Groups, Communities, Tournaments, Leagues (horizontal carousel)
 * - Player directory for finding and connecting with players
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { useAdminStatus } from '@rallia/shared-hooks';
import { spacingPixels, radiusPixels, accent } from '@rallia/design-system';
import type { PlayerSearchResult } from '@rallia/shared-services';
import type { CompositeNavigationProp } from '@react-navigation/native';

import {
  useAuth,
  useThemeStyles,
  useTranslation,
  useNavigateToPlayerProfile,
  useRequireOnboarding,
  type TranslationKey,
} from '#/hooks';
import { useSport } from '#/context';
import { PlayerDirectory } from '#/features/community';
import type { RootStackParamList, CommunityStackParamList } from '#/navigation/types';

type CommunityNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<CommunityStackParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface ActionButton {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

const Community = () => {
  const { colors } = useThemeStyles();
  const { session } = useAuth();
  const { isAdmin } = useAdminStatus();
  const { selectedSport } = useSport();
  const navigation = useNavigation<CommunityNavigationProp>();
  const { t } = useTranslation();
  const { guardAction } = useRequireOnboarding();

  // Theme colors for components
  const themeColors = useMemo(
    () => ({
      background: colors.background,
      cardBackground: colors.cardBackground,
      text: colors.text,
      textSecondary: colors.textSecondary,
      textMuted: colors.textMuted,
      border: colors.border,
      primary: colors.primary,
      inputBackground: colors.inputBackground,
    }),
    [colors]
  );

  // Action button handlers
  const handleGroups = useCallback(() => {
    if (!guardAction()) return;
    lightHaptic();
    navigation.navigate('Groups');
  }, [navigation, guardAction]);

  const handleCommunities = useCallback(() => {
    lightHaptic();
    navigation.navigate('Communities');
  }, [navigation]);

  const handleTournaments = useCallback(() => {
    if (!guardAction()) return;
    lightHaptic();
    navigation.navigate('Tournaments');
  }, [navigation, guardAction]);

  const handleLeagues = useCallback(() => {
    if (!guardAction()) return;
    lightHaptic();
    navigation.navigate('Leagues');
  }, [navigation, guardAction]);

  // Action buttons configuration
  const actionButtons: ActionButton[] = useMemo(() => {
    const buttons: ActionButton[] = [];

    buttons.push({
      id: 'tournaments',
      icon: 'trophy-outline',
      label: t('community.tournaments'),
      onPress: handleTournaments,
    });

    // Leagues stay admin-gated while the feature is in rollout.
    if (isAdmin) {
      buttons.push({
        id: 'leagues',
        icon: 'ribbon-outline',
        label: t('community.leagues'),
        onPress: handleLeagues,
      });
    }

    buttons.push(
      {
        id: 'communities',
        icon: 'globe-outline',
        label: t('community.communities'),
        onPress: handleCommunities,
      },
      {
        id: 'groups',
        icon: 'people-outline',
        label: t('community.groups'),
        onPress: handleGroups,
      }
    );

    return buttons;
  }, [handleGroups, handleCommunities, handleTournaments, handleLeagues, isAdmin, t]);

  // When there are few enough buttons to fit without scrolling (e.g. non-admin
  // users only see Tournaments + Communities + Groups), stretch them to fill the width.
  const fillWidth = actionButtons.length <= 2;

  const navigateToPlayerProfile = useNavigateToPlayerProfile();
  const handlePlayerPress = useCallback(
    (player: PlayerSearchResult) => {
      // Guard: prompt sign-in/onboarding if user is not authenticated or not onboarded
      if (!guardAction()) return;
      navigateToPlayerProfile(player.id, selectedSport?.id);
    },
    [navigateToPlayerProfile, selectedSport?.id, guardAction]
  );

  // List header with action buttons and section title
  const listHeader = useMemo(() => {
    const buttonElements = actionButtons.map(button => (
      <TouchableOpacity
        key={button.id}
        style={[
          styles.actionButton,
          fillWidth ? styles.actionButtonFill : styles.actionButtonFixed,
        ]}
        onPress={button.onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={button.label}
      >
        <View style={styles.actionButtonInner}>
          <View style={styles.actionButtonIcon}>
            <Ionicons name={button.icon} size={26} color="#ffffff" />
          </View>
          <View style={styles.actionButtonLabelBlock}>
            <Text
              size="sm"
              weight="semibold"
              color="#ffffff"
              style={styles.actionButtonLabel}
              numberOfLines={1}
            >
              {button.label}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    ));

    return (
      <>
        {fillWidth ? (
          <View style={styles.actionButtonsRow}>{buttonElements}</View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actionButtonsRow}
          >
            {buttonElements}
          </ScrollView>
        )}

        <View style={styles.sectionHeader}>
          <Text size="xl" weight="bold" color={colors.text} style={styles.sectionTitle}>
            {t('community.players')}
          </Text>
        </View>
      </>
    );
  }, [actionButtons, fillWidth, colors.text, t]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <PlayerDirectory
        sportId={selectedSport?.id}
        sportName={selectedSport?.name}
        currentUserId={session?.user?.id}
        colors={themeColors}
        onPlayerPress={handlePlayerPress}
        ListHeaderComponent={listHeader}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  actionButton: {
    borderRadius: radiusPixels['2xl'],
  },
  actionButtonFixed: {
    width: 132,
  },
  actionButtonFill: {
    flex: 1,
  },
  actionButtonInner: {
    flexDirection: 'column',
    borderRadius: radiusPixels['2xl'],
    borderWidth: 1.5,
    borderColor: accent[500],
    backgroundColor: accent[400],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[3],
    overflow: 'hidden',
  },
  actionButtonIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    flexShrink: 0,
  },
  actionButtonLabelBlock: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  actionButtonLabel: {
    textAlign: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[2],
    gap: spacingPixels[2],
  },
  sectionTitle: {
    flex: 1,
  },
});

export default Community;
