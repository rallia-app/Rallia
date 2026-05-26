/**
 * Match Suggestions Bottom Sheet
 *
 * Renders a flat list of up to 15 score-ordered match suggestions.
 * Accessible from the Home screen via the FAB.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import ActionSheet, { SheetManager, SheetProps, ScrollView } from 'react-native-actions-sheet';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  withSpring,
  withRepeat,
  withSequence,
  Easing,
  makeMutable,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  lightHaptic,
  getUpcomingDateSection,
  UPCOMING_SECTION_ORDER,
  type UpcomingDateSection,
} from '@rallia/shared-utils';
import { useTopSuggestions } from '@rallia/shared-hooks';

import { suggestionSlotKey, useSuggestionInviteHandler } from '#/hooks/useSuggestionInviteHandler';
import { useThemeStyles, useTranslation, useEffectiveLocation, useAuth, usePlayer } from '#/hooks';
import { useSport } from '#/context';

import { SuggestionCard } from './SuggestionCard';

const MAX_SUGGESTIONS = 15;

export function MatchSuggestionsActionSheet(_props: SheetProps<'match-suggestions'>) {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const { player } = usePlayer();
  const { selectedSport } = useSport();
  const { location: effectiveLocation } = useEffectiveLocation();

  const resolvedPlayerId = player?.id ?? session?.user?.id;

  const { suggestions, isLoading, isRefetching, refetch } = useTopSuggestions({
    playerId: resolvedPlayerId,
    sportId: selectedSport?.id,
    sportName: selectedSport?.name,
    latitude: effectiveLocation?.latitude,
    longitude: effectiveLocation?.longitude,
    maxItems: MAX_SUGGESTIONS,
    enabled: true,
  });

  // Loading pulse
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.6);

  useEffect(() => {
    if (isLoading) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.6, { duration: 800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    }
  }, [isLoading, pulseScale, pulseOpacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  // Refresh spin
  const spinRotation = useSharedValue(0);

  useEffect(() => {
    if (isRefetching) {
      spinRotation.value = withRepeat(
        withTiming(360, { duration: 800, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      spinRotation.value = withTiming(0, { duration: 200 });
    }
  }, [isRefetching, spinRotation]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinRotation.value}deg` }],
  }));

  const totalCards = suggestions.length;

  const sectionLabels = useMemo<Record<UpcomingDateSection, string>>(
    () => ({
      today: t('playerMatches.time.today'),
      tomorrow: t('playerMatches.time.tomorrow'),
      thisWeek: t('playerMatches.time.thisWeek'),
      nextWeek: t('playerMatches.time.nextWeek'),
      later: t('playerMatches.time.later'),
    }),
    [t]
  );

  // Group suggestions by date section in chronological order.
  // Suggestions arrive score-ordered so we collect all items per section first,
  // then emit sections in UPCOMING_SECTION_ORDER — preserving score rank within each section.
  const groupedSuggestions = useMemo(() => {
    const buckets: Partial<
      Record<
        UpcomingDateSection,
        { suggestion: (typeof suggestions)[number]; originalIndex: number }[]
      >
    > = {};
    suggestions.forEach((s, i) => {
      const section = getUpcomingDateSection(s.slot.datetime);
      if (!buckets[section]) buckets[section] = [];
      buckets[section].push({ suggestion: s, originalIndex: i });
    });
    return UPCOMING_SECTION_ORDER.filter(section => (buckets[section]?.length ?? 0) > 0).map(
      section => ({ section, items: buckets[section]! })
    );
  }, [suggestions]);
  const cardOpacities = useRef(
    Array.from({ length: MAX_SUGGESTIONS }, () => makeMutable(0))
  ).current;
  const cardTranslateYs = useRef(
    Array.from({ length: MAX_SUGGESTIONS }, () => makeMutable(20))
  ).current;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isLoading && totalCards > 0 && !hasAnimated.current) {
      hasAnimated.current = true;
      for (let i = 0; i < Math.min(totalCards, MAX_SUGGESTIONS); i++) {
        cardOpacities[i].value = withDelay(i * 60, withTiming(1, { duration: 300 }));
        cardTranslateYs[i].value = withDelay(
          i * 60,
          withSpring(0, { damping: 40, stiffness: 300 })
        );
      }
    }
    if (isRefetching) {
      hasAnimated.current = false;
      cardOpacities.forEach(v => {
        v.value = 0;
      });
      cardTranslateYs.forEach(v => {
        v.value = 20;
      });
    }
  }, [isLoading, totalCards, isRefetching]);

  const handleClose = useCallback(() => {
    lightHaptic();
    SheetManager.hide('match-suggestions');
  }, []);

  const handleRefresh = useCallback(async () => {
    lightHaptic();
    await refetch();
  }, [refetch]);

  const { cardLabels, inviteStates, handleSendInvite } = useSuggestionInviteHandler({
    source: 'sheet',
    onAuthRequired: () => SheetManager.hide('match-suggestions'),
  });

  return (
    <ActionSheet
      gestureEnabled
      useBottomSafeAreaPadding={false}
      containerStyle={[styles.container, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={handleRefresh}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.headerSideBtn}
          disabled={isRefetching}
        >
          <Animated.View style={spinStyle}>
            <Ionicons name="refresh-outline" size={20} color={colors.textMuted} />
          </Animated.View>
        </TouchableOpacity>
        <Text size="lg" weight="bold" color={colors.foreground}>
          {t('onboarding.suggestions.sheetTitle')}
        </Text>
        <TouchableOpacity
          onPress={handleClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.headerSideBtn}
        >
          <Ionicons name="close-outline" size={24} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={[
          styles.content,
          (isLoading || isRefetching) && styles.contentCentered,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {isLoading || isRefetching ? (
          <View style={styles.loadingState}>
            <Animated.View
              style={[
                styles.loadingIconContainer,
                { backgroundColor: colors.primary + '15' },
                pulseStyle,
              ]}
            >
              <Ionicons name="sparkles" size={36} color={colors.primary} />
            </Animated.View>
            <Text size="lg" weight="semibold" color={colors.foreground} style={styles.loadingTitle}>
              {t('onboarding.suggestions.loading')}
            </Text>
            <Text size="sm" color={colors.textMuted} style={styles.loadingSubtitle}>
              {t('onboarding.suggestions.subtitle')}
            </Text>
          </View>
        ) : totalCards === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIconContainer, { backgroundColor: colors.textMuted + '15' }]}>
              <Ionicons name="search-outline" size={36} color={colors.textMuted} />
            </View>
            <Text size="base" weight="semibold" color={colors.foreground} style={styles.emptyTitle}>
              {t('onboarding.suggestions.emptyTitle')}
            </Text>
            <Text size="sm" color={colors.textMuted} style={styles.emptySubtitle}>
              {t('onboarding.suggestions.emptySubtitle')}
            </Text>
          </View>
        ) : (
          <View style={styles.cardsContainer}>
            <View
              style={[
                styles.reassureBanner,
                {
                  backgroundColor: colors.primary + '12',
                  borderColor: colors.primary + '33',
                },
              ]}
            >
              <View
                style={[styles.reassureIconContainer, { backgroundColor: colors.primary + '20' }]}
              >
                <Ionicons name="sparkles" size={18} color={colors.primary} />
              </View>
              <View style={styles.reassureTextContainer}>
                <Text size="sm" weight="semibold" color={colors.foreground}>
                  {t('onboarding.suggestions.reassureTitle')}
                </Text>
                <Text size="xs" color={colors.textSecondary} style={styles.reassureMessage}>
                  {t('onboarding.suggestions.reassureMessage')}
                </Text>
              </View>
            </View>
            {groupedSuggestions.map(({ section, items }) => (
              <React.Fragment key={section}>
                <View style={[styles.sectionHeader, { backgroundColor: colors.cardBackground }]}>
                  <Text size="sm" weight="semibold" color={colors.textMuted}>
                    {sectionLabels[section]}
                  </Text>
                </View>
                {items.map(({ suggestion: s, originalIndex }) => {
                  const slotKey = suggestionSlotKey(
                    s.opponentId,
                    s.facility.facilityId,
                    s.slot.datetime
                  );
                  const animStyle =
                    originalIndex < MAX_SUGGESTIONS
                      ? {
                          opacity: cardOpacities[originalIndex],
                          transform: [{ translateY: cardTranslateYs[originalIndex] }],
                        }
                      : undefined;
                  return (
                    <Animated.View key={`c:${slotKey}:${originalIndex}`} style={animStyle}>
                      <SuggestionCard
                        suggestion={s}
                        colors={{
                          cardBackground: colors.cardBackground,
                          text: colors.foreground,
                          textSecondary: colors.textSecondary,
                          textMuted: colors.textMuted,
                          border: colors.border,
                          buttonActive: colors.primary,
                          buttonTextActive: '#ffffff',
                        }}
                        isDark={isDark}
                        labels={cardLabels}
                        locale={locale}
                        onSendInvite={handleSendInvite}
                        inviteState={inviteStates[slotKey] ?? 'idle'}
                        source="sheet"
                      />
                    </Animated.View>
                  );
                })}
              </React.Fragment>
            ))}
          </View>
        )}
      </ScrollView>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderBottomWidth: 1,
  },
  headerSideBtn: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[10],
  },
  contentCentered: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  cardsContainer: {},
  reassureBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[3],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[3],
  },
  reassureIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reassureTextContainer: {
    flex: 1,
  },
  reassureMessage: {
    marginTop: spacingPixels[1],
    lineHeight: 16,
  },
  sectionHeader: {
    paddingVertical: spacingPixels[2],
    marginBottom: spacingPixels[1],
  },
  loadingState: {
    alignItems: 'center',
  },
  loadingIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  loadingTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  loadingSubtitle: {
    textAlign: 'center',
    paddingHorizontal: spacingPixels[6],
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[10],
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[4],
  },
  emptyTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  emptySubtitle: {
    textAlign: 'center',
    paddingHorizontal: spacingPixels[6],
  },
});
