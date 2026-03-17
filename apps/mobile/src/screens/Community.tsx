/**
 * Community Screen
 *
 * Main community hub with:
 * - Quick action buttons: Share Lists, Groups, Communities
 * - Player directory for finding and connecting with players
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import {
  useAuth,
  useThemeStyles,
  useTranslation,
  useNavigateToPlayerProfile,
  useRequireOnboarding,
  type TranslationKey,
} from '../hooks';
import { useSport } from '../context';
import { spacingPixels } from '@rallia/design-system';
import { primary, neutral } from '@rallia/design-system';
import { PlayerDirectory } from '../features/community';
import type { PlayerSearchResult } from '@rallia/shared-services';
import type { RootStackParamList, CommunityStackParamList } from '../navigation/types';
import type { CompositeNavigationProp } from '@react-navigation/native';

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
  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
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

  // Action button colors
  const buttonColors = useMemo(
    () => ({
      background: isDark ? neutral[800] : primary[50],
      iconColor: isDark ? primary[400] : primary[600],
    }),
    [isDark]
  );

  // Action button handlers
  const handleShareLists = useCallback(() => {
    if (!guardAction()) return;
    lightHaptic();
    navigation.navigate('ShareLists');
  }, [navigation, guardAction]);

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
    lightHaptic();
    Alert.alert(t('community.tournaments'), t('community.tournamentsComingSoon'));
  }, [t]);

  const handleLeagues = useCallback(() => {
    lightHaptic();
    Alert.alert(t('community.leagues'), t('community.leaguesComingSoon'));
  }, [t]);

  // Action buttons configuration
  const actionButtons: ActionButton[] = useMemo(
    () => [
      {
        id: 'share-lists',
        icon: 'paper-plane-outline',
        label: t('community.shareLists'),
        onPress: handleShareLists,
      },
      {
        id: 'groups',
        icon: 'people-outline',
        label: t('community.groups'),
        onPress: handleGroups,
      },
      {
        id: 'communities',
        icon: 'globe-outline',
        label: t('community.communities'),
        onPress: handleCommunities,
      },
      {
        id: 'tournaments',
        icon: 'trophy-outline',
        label: t('community.tournaments'),
        onPress: handleTournaments,
      },
      {
        id: 'leagues',
        icon: 'podium-outline',
        label: t('community.leagues'),
        onPress: handleLeagues,
      },
    ],
    [handleShareLists, handleGroups, handleCommunities, handleTournaments, handleLeagues, t]
  );

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
  const listHeader = useMemo(
    () => (
      <>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.actionButtonsScrollView}
          contentContainerStyle={styles.actionButtonsContainer}
        >
          {actionButtons.map(button => (
            <TouchableOpacity
              key={button.id}
              style={styles.actionButton}
              onPress={button.onPress}
              activeOpacity={0.7}
            >
              <View style={[styles.actionButtonIcon, { backgroundColor: buttonColors.background }]}>
                <Ionicons name={button.icon} size={28} color={buttonColors.iconColor} />
              </View>
              <Text
                size="xs"
                weight="medium"
                color={colors.text}
                style={styles.actionButtonLabel}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {button.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.sectionHeader}>
          <Text size="xl" weight="bold" color={colors.text} style={styles.sectionTitle}>
            {t('community.players')}
          </Text>
        </View>
      </>
    ),
    [actionButtons, buttonColors, colors.text, t]
  );

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
  actionButtonsScrollView: {
    flexGrow: 0,
    paddingTop: spacingPixels[2],
    flexShrink: 0,
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    gap: spacingPixels[6],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[2],
  },
  actionButton: {
    alignItems: 'center',
    width: 80,
  },
  actionButtonIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[2],
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
