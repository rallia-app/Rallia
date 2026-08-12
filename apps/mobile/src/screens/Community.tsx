/**
 * Community Screen
 *
 * Main community hub with:
 * - Quick action buttons: Groups, Communities, Tournaments, Leagues (horizontal carousel)
 * - Player directory for finding and connecting with players
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, accent, primary, secondary } from '@rallia/design-system';
import type { PlayerSearchResult } from '@rallia/shared-services';
import type { CompositeNavigationProp } from '@react-navigation/native';

import {
  useAuth,
  useThemeStyles,
  useTranslation,
  useNavigateToPlayerProfile,
  useRequireOnboarding,
} from '#/hooks';
import { useSport } from '#/context';
import { PlayerDirectory } from '#/features/community';
import { GradientNavTile, NAV_TILE_WATERMARK_COLOR } from '#/components/GradientNavTile';
import type { RootStackParamList, CommunityStackParamList } from '#/navigation/types';

type CommunityNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<CommunityStackParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface ActionButton {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  watermark: keyof typeof Ionicons.glyphMap;
  gradient: [string, string];
  borderColor: string;
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

  // Action button handlers — the tile fires the haptic on press.
  const handleGroups = useCallback(() => {
    if (!guardAction()) return;
    navigation.navigate('Groups');
  }, [navigation, guardAction]);

  const handleCommunities = useCallback(() => {
    navigation.navigate('Communities');
  }, [navigation]);

  const handleCompete = useCallback(() => {
    if (!guardAction()) return;
    navigation.navigate('Compete');
  }, [navigation, guardAction]);

  // Action buttons configuration — gradients match the Home play grid so each
  // destination keeps one color identity across the app (tournaments coral,
  // leagues deep teal).
  const actionButtons: ActionButton[] = useMemo(() => {
    const buttons: ActionButton[] = [];

    // One destination, one tile: the Compete hub holds both formats.
    buttons.push({
      id: 'compete',
      icon: 'trophy-outline',
      watermark: 'trophy',
      gradient: [secondary[400], secondary[600]],
      borderColor: secondary[500],
      label: t('community.compete'),
      onPress: handleCompete,
    });

    buttons.push(
      {
        id: 'communities',
        icon: 'globe-outline',
        watermark: 'globe',
        gradient: [accent[400], accent[600]],
        borderColor: accent[500],
        label: t('community.communities'),
        onPress: handleCommunities,
      },
      {
        id: 'groups',
        icon: 'people-outline',
        watermark: 'people',
        gradient: [primary[500], primary[700]],
        borderColor: primary[600],
        label: t('community.groups'),
        onPress: handleGroups,
      }
    );

    return buttons;
  }, [handleGroups, handleCommunities, handleCompete, t]);

  // When there are few enough buttons to fit without scrolling, stretch them
  // to fill the width.
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
      <GradientNavTile
        key={button.id}
        style={fillWidth ? styles.actionButtonFill : styles.actionButtonFixed}
        icon={color => <Ionicons name={button.icon} size={24} color={color} />}
        watermark={<Ionicons name={button.watermark} size={56} color={NAV_TILE_WATERMARK_COLOR} />}
        gradient={button.gradient}
        borderColor={button.borderColor}
        label={button.label}
        onPress={button.onPress}
      />
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
  actionButtonFixed: {
    width: 140,
  },
  actionButtonFill: {
    flex: 1,
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
