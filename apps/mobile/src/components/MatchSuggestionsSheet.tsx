/**
 * Match Suggestions Bottom Sheet
 *
 * Displays personalized match suggestions in a full-height action sheet.
 * Accessible from the Home screen via a FAB button.
 * Uses the shared SuggestionCard and useMatchSuggestions hook.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import { useMatchSuggestions } from '@rallia/shared-hooks';
import { createMatchFromSuggestion } from '@rallia/shared-services';
import { useQueryClient } from '@tanstack/react-query';
import type { InvitePayload } from './SuggestionCard';
import { useThemeStyles, useTranslation, useEffectiveLocation } from '../hooks';
import { useActionsSheet, useSport } from '../context';
import { useAuth, usePlayer } from '../hooks';
import { usePlayerSports } from '@rallia/shared-hooks';

export function MatchSuggestionsActionSheet(_props: SheetProps<'match-suggestions'>) {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const { player } = usePlayer();
  const { selectedSport } = useSport();
  const { openSheet: openAuthSheet } = useActionsSheet();
  const { location: effectiveLocation } = useEffectiveLocation();
  const { playerSports } = usePlayerSports(session?.user?.id);
  const callerSportPrefs = playerSports.find(ps => ps.sport_id === selectedSport?.id);
  const callerDuration = callerSportPrefs?.preferred_match_duration ?? '60';
  const callerMatchType = callerSportPrefs?.preferred_match_type ?? 'both';

  const queryClient = useQueryClient();

  const resolvedPlayerId = player?.id ?? session?.user?.id;
  const isAnon = !resolvedPlayerId;

  const { suggestions, isLoading, isRefetching, refetch } = useMatchSuggestions({
    playerId: resolvedPlayerId,
    sportId: selectedSport?.id,
    sportName: selectedSport?.name,
    latitude: isAnon ? effectiveLocation?.latitude : undefined,
    longitude: isAnon ? effectiveLocation?.longitude : undefined,
    limit: 10,
    enabled: true,
  });

  // Pulsing animation for loading icon
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

  // Spinning animation for refresh icon
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

  // Staggered card entry animations
  const MAX_ANIMATED = 10;
  const cardOpacities = useRef(Array.from({ length: MAX_ANIMATED }, () => makeMutable(0))).current;
  const cardTranslateYs = useRef(
    Array.from({ length: MAX_ANIMATED }, () => makeMutable(20))
  ).current;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isLoading && suggestions.length > 0 && !hasAnimated.current) {
      hasAnimated.current = true;
      suggestions.forEach((_, index) => {
        if (index < MAX_ANIMATED) {
          cardOpacities[index].value = withDelay(index * 100, withTiming(1, { duration: 300 }));
          cardTranslateYs[index].value = withDelay(
            index * 100,
            withSpring(0, { damping: 40, stiffness: 300 })
          );
        }
      });
    }
    // Reset when refetching finishes with new data
    if (isRefetching) {
      hasAnimated.current = false;
      cardOpacities.forEach(v => {
        v.value = 0;
      });
      cardTranslateYs.forEach(v => {
        v.value = 20;
      });
    }
  }, [isLoading, suggestions.length, isRefetching]);

  const handleClose = useCallback(() => {
    lightHaptic();
    SheetManager.hide('match-suggestions');
  }, []);

  const handleRefresh = useCallback(async () => {
    lightHaptic();
    await refetch();
  }, [refetch]);

  // Per-card invite state
  const [inviteStates, setInviteStates] = useState<Record<string, 'idle' | 'sending' | 'sent'>>({});
  const inviteStatesRef = useRef(inviteStates);
  inviteStatesRef.current = inviteStates;

  const handleSendInvite = useCallback(
    async (payload: InvitePayload) => {
      // Signed-out users: dismiss this sheet and route to auth
      if (!session?.user) {
        lightHaptic();
        SheetManager.hide('match-suggestions');
        openAuthSheet();
        return;
      }

      const id = payload.suggestion.opponentId;
      if (inviteStatesRef.current[id] === 'sending' || inviteStatesRef.current[id] === 'sent')
        return;

      setInviteStates(prev => ({ ...prev, [id]: 'sending' }));
      try {
        await createMatchFromSuggestion({
          createdBy: player?.id ?? session?.user?.id ?? '',
          opponentId: payload.suggestion.opponentId,
          sportId: selectedSport?.id ?? '',
          matchType: callerMatchType,
          matchDuration: callerDuration,
          facilityId: payload.selectedFacility.facilityId,
          startTime: payload.selectedTime,
          endTime: payload.selectedEndTime,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        successHaptic();
        setInviteStates(prev => ({ ...prev, [id]: 'sent' }));
        queryClient.invalidateQueries({ queryKey: ['matches', 'list', 'player'] });
        queryClient.invalidateQueries({ queryKey: ['matches', 'list', 'nearby'] });
      } catch {
        setInviteStates(prev => ({ ...prev, [id]: 'idle' }));
      }
    },
    [
      player?.id,
      session?.user,
      selectedSport?.id,
      callerDuration,
      callerMatchType,
      queryClient,
      openAuthSheet,
    ]
  );

  const cardLabels = useMemo(
    () => ({
      facility: t('onboarding.suggestions.facility'),
      when: t('onboarding.suggestions.when'),
      noAvailableTimes: t('onboarding.suggestions.noAvailableTimes'),
      unknownPlayer: t('onboarding.suggestions.unknownPlayer'),
      sendInvite: t('onboarding.suggestions.sendInvite'),
      inviteSent: t('onboarding.suggestions.inviteSent'),
      periodMorning: t('onboarding.suggestions.periodMorning'),
      periodAfternoon: t('onboarding.suggestions.periodAfternoon'),
      periodEvening: t('onboarding.suggestions.periodEvening'),
      today: t('common.time.today'),
      tomorrow: t('common.time.tomorrow'),
      selectDate: t('onboarding.suggestions.selectDate'),
      selectTime: t('onboarding.suggestions.selectTime'),
    }),
    [t]
  );

  return (
    <ActionSheet
      gestureEnabled
      useBottomSafeAreaPadding={false}
      containerStyle={[styles.container, { backgroundColor: colors.cardBackground }]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      {/* Header */}
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

      {/* Content */}
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
        ) : suggestions.length === 0 ? (
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
            {suggestions.map((suggestion, index) => {
              const animStyle =
                index < MAX_ANIMATED
                  ? {
                      opacity: cardOpacities[index],
                      transform: [{ translateY: cardTranslateYs[index] }],
                    }
                  : undefined;
              return (
                <Animated.View key={suggestion.opponentId} style={animStyle}>
                  <SuggestionCard
                    suggestion={suggestion}
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
                    inviteState={inviteStates[suggestion.opponentId] ?? 'idle'}
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
  // Loading state
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

  // Empty state
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
