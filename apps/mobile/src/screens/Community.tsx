/**
 * Community Screen
 *
 * Main community hub with:
 * - Quick action buttons: Groups, Communities
 * - Player directory for finding and connecting with players
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
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
import { spacingPixels, radiusPixels, accent } from '@rallia/design-system';
import { LinearGradient } from 'expo-linear-gradient';
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
  const { colors } = useThemeStyles();
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

  // Action buttons configuration
  const actionButtons: ActionButton[] = useMemo(
    () => [
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
    ],
    [handleGroups, handleCommunities, t]
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
        <View style={styles.actionButtonsRow}>
          {actionButtons.map(button => (
            <TouchableOpacity
              key={button.id}
              style={styles.actionButton}
              onPress={button.onPress}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[accent[300], accent[400], accent[500]]}
                locations={[0, 0.55, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.actionButtonGradient}
              >
                <View style={styles.actionButtonTopHighlight} />
                <View style={styles.actionButtonIcon}>
                  <Ionicons name={button.icon} size={28} color="#ffffff" />
                </View>
                <Text
                  size="base"
                  weight="semibold"
                  color="#ffffff"
                  style={styles.actionButtonLabel}
                >
                  {button.label}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.sectionHeader}>
          <Text size="xl" weight="bold" color={colors.text} style={styles.sectionTitle}>
            {t('community.players')}
          </Text>
        </View>
      </>
    ),
    [actionButtons, colors.text, t]
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
  actionButtonsRow: {
    flexDirection: 'row',
    gap: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[2],
  },
  actionButton: {
    flex: 1,
    aspectRatio: 1.5,
    borderRadius: radiusPixels['2xl'],
  },
  actionButtonGradient: {
    flex: 1,
    borderRadius: radiusPixels['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[3],
    overflow: 'hidden',
  },
  actionButtonTopHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  actionButtonIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
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
