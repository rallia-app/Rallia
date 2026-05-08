/**
 * Match Suggestions Bottom Sheet
 *
 * Renders the 7-day suggestion grid: each day has a date header and up to 5
 * single-slot cards. Accessible from the Home screen via the FAB.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { TouchableOpacity } from 'react-native';
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
import { SuggestionCard } from './SuggestionCard';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, formatIntuitiveDateInTimezone } from '@rallia/shared-utils';
import { useMatchSuggestions } from '@rallia/shared-hooks';
import { suggestionSlotKey, useSuggestionInviteHandler } from '../hooks/useSuggestionInviteHandler';
import { useThemeStyles, useTranslation, useEffectiveLocation } from '../hooks';
import { useSport } from '../context';
import { useAuth, usePlayer } from '../hooks';

export function MatchSuggestionsActionSheet(_props: SheetProps<'match-suggestions'>) {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const { player } = usePlayer();
  const { selectedSport } = useSport();
  const { location: effectiveLocation } = useEffectiveLocation();

  const resolvedPlayerId = player?.id ?? session?.user?.id;

  const { days, isLoading, isRefetching, refetch } = useMatchSuggestions({
    playerId: resolvedPlayerId,
    sportId: selectedSport?.id,
    sportName: selectedSport?.name,
    latitude: effectiveLocation?.latitude,
    longitude: effectiveLocation?.longitude,
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

  // Flatten the day grid for staggered entry animation
  const flatItems = useMemo(() => {
    const out: Array<
      | { kind: 'header'; date: string }
      | {
          kind: 'card';
          index: number;
          suggestion: import('@rallia/shared-services').SlotSuggestion;
        }
    > = [];
    let cardIndex = 0;
    for (const day of days) {
      if (day.suggestions.length === 0) continue;
      out.push({ kind: 'header', date: day.date });
      for (const s of day.suggestions) {
        out.push({ kind: 'card', index: cardIndex++, suggestion: s });
      }
    }
    return out;
  }, [days]);

  const totalCards = flatItems.filter(i => i.kind === 'card').length;
  const MAX_ANIMATED = 35;
  const cardOpacities = useRef(Array.from({ length: MAX_ANIMATED }, () => makeMutable(0))).current;
  const cardTranslateYs = useRef(
    Array.from({ length: MAX_ANIMATED }, () => makeMutable(20))
  ).current;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isLoading && totalCards > 0 && !hasAnimated.current) {
      hasAnimated.current = true;
      for (let i = 0; i < Math.min(totalCards, MAX_ANIMATED); i++) {
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

  const deviceTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const renderDateHeader = useCallback(
    (dateKey: string) => {
      const result = formatIntuitiveDateInTimezone(dateKey, deviceTz, locale);
      let label: string;
      if (result.type === 'today') label = t('common.time.today');
      else if (result.type === 'tomorrow') label = t('common.time.tomorrow');
      else label = result.label;
      return (
        <Text size="sm" weight="bold" color={colors.textMuted} style={styles.sectionHeader}>
          {label}
        </Text>
      );
    },
    [deviceTz, locale, t, colors.textMuted]
  );

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
          {t('onboarding.suggestions.title')}
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
            {flatItems.map((item, idx) => {
              if (item.kind === 'header') {
                return <View key={`h:${item.date}`}>{renderDateHeader(item.date)}</View>;
              }
              const s = item.suggestion;
              const slotKey = suggestionSlotKey(
                s.opponentId,
                s.facility.facilityId,
                s.slot.datetime
              );
              const animStyle =
                item.index < MAX_ANIMATED
                  ? {
                      opacity: cardOpacities[item.index],
                      transform: [{ translateY: cardTranslateYs[item.index] }],
                    }
                  : undefined;
              return (
                <Animated.View key={`c:${slotKey}:${idx}`} style={animStyle}>
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
  sectionHeader: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[2],
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
