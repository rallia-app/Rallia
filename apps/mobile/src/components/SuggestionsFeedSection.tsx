/**
 * SuggestionsFeedSection Component
 *
 * Appended at the end of match lists (Home, Public Matches) and rendered in
 * their empty states. Auto-fires the matchup suggestions query as soon as the
 * section mounts with valid inputs (sport + playerId or lat/lng). Reuses
 * SuggestionCard, useMatchSuggestions, and per-card invite state.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  withSpring,
  Easing,
  makeMutable,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, primary, neutral } from '@rallia/design-system';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import { useMatchSuggestions } from '@rallia/shared-hooks';
import { createMatchFromSuggestion } from '@rallia/shared-services';
import { useQueryClient } from '@tanstack/react-query';
import { useThemeStyles, useTranslation, useEffectiveLocation } from '../hooks';
import { useAuth, usePlayer } from '../hooks';
import { useActionsSheet, useSport } from '../context';
import { usePlayerSports } from '@rallia/shared-hooks';
import { SuggestionCard, type SuggestionCardLabels, type InvitePayload } from './SuggestionCard';

const MAX_CARDS = 20;

interface SuggestionsFeedSectionProps {
  playerId: string | undefined;
  sportId: string | undefined;
  sportName: string | undefined;
}

export const SuggestionsFeedSection: React.FC<SuggestionsFeedSectionProps> = ({
  playerId,
  sportId,
  sportName,
}) => {
  const { colors, isDark } = useThemeStyles();
  const { t, locale } = useTranslation();
  const { session } = useAuth();
  const { player } = usePlayer();
  const { selectedSport } = useSport();
  const { openSheet: openAuthSheet } = useActionsSheet();
  const { location: effectiveLocation } = useEffectiveLocation();
  const { playerSports } = usePlayerSports(session?.user?.id);
  const callerSportPrefs = playerSports.find(ps => ps.sport_id === (selectedSport?.id ?? sportId));
  const callerDuration = callerSportPrefs?.preferred_match_duration ?? '60';
  const callerMatchType = callerSportPrefs?.preferred_match_type ?? 'both';
  const queryClient = useQueryClient();

  const isAnon = !playerId;
  const anonLat = isAnon ? effectiveLocation?.latitude : undefined;
  const anonLng = isAnon ? effectiveLocation?.longitude : undefined;

  // No inputs → render nothing (e.g., signed-out user with no location yet)
  const hasInputs = !!sportId && (!!playerId || (anonLat != null && anonLng != null));

  const { suggestions, isLoading, isRefetching, refetch } = useMatchSuggestions({
    playerId,
    sportId,
    sportName,
    latitude: anonLat,
    longitude: anonLng,
    limit: MAX_CARDS,
    enabled: true,
  });

  // Per-card invite state
  const [inviteStates, setInviteStates] = useState<Record<string, 'idle' | 'sending' | 'sent'>>({});
  const inviteStatesRef = useRef(inviteStates);
  inviteStatesRef.current = inviteStates;

  const handleRefresh = useCallback(async () => {
    if (isRefetching || isLoading) return;
    lightHaptic();
    await refetch();
  }, [refetch, isRefetching, isLoading]);

  const handleSendInvite = useCallback(
    async (payload: InvitePayload) => {
      // Signed-out users: route to auth instead of creating a match
      if (!session?.user) {
        lightHaptic();
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
          sportId: selectedSport?.id ?? sportId ?? '',
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
      sportId,
      callerDuration,
      callerMatchType,
      queryClient,
      openAuthSheet,
    ]
  );

  const cardLabels: SuggestionCardLabels = useMemo(
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

  // Pulsing loading animation
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

  // Spinning refresh icon animation
  const spinRotation = useSharedValue(0);

  useEffect(() => {
    if (isLoading || isRefetching) {
      spinRotation.value = withRepeat(
        withTiming(360, { duration: 800, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      spinRotation.value = withTiming(0, { duration: 200 });
    }
  }, [isLoading, isRefetching, spinRotation]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinRotation.value}deg` }],
  }));

  // Card stagger animation
  const cardOpacities = useRef(Array.from({ length: MAX_CARDS }, () => makeMutable(0))).current;
  const cardTranslateYs = useRef(Array.from({ length: MAX_CARDS }, () => makeMutable(20))).current;

  useEffect(() => {
    if (!isLoading && suggestions.length > 0) {
      suggestions.forEach((_, index) => {
        if (index < MAX_CARDS) {
          cardOpacities[index].value = withDelay(index * 100, withTiming(1, { duration: 300 }));
          cardTranslateYs[index].value = withDelay(
            index * 100,
            withSpring(0, { damping: 40, stiffness: 300 })
          );
        }
      });
    }
  }, [isLoading, suggestions.length]);

  const accentColor = isDark ? primary[400] : primary[500];

  // ── No inputs available → render nothing ────────────────────────────
  if (!hasInputs) return null;

  const dividerColor = isDark ? neutral[700] : neutral[200];

  const boundary = (
    <>
      <View style={styles.boundary}>
        <View style={[styles.boundaryLine, { backgroundColor: dividerColor }]} />
        <View
          style={[
            styles.boundaryPill,
            {
              backgroundColor: isDark ? `${primary[900]}40` : primary[50],
              borderColor: isDark ? primary[700] : primary[200],
            },
          ]}
        >
          <Ionicons name="sparkles" size={14} color={accentColor} />
          <Text
            size="xs"
            weight="bold"
            color={isDark ? primary[300] : primary[700]}
            style={styles.boundaryLabel}
          >
            {t('onboarding.suggestions.feedSectionTitle')}
          </Text>
        </View>
        <View style={[styles.boundaryLine, { backgroundColor: dividerColor }]} />
      </View>
      <Text size="xs" color={colors.textMuted} style={styles.boundarySubtitle} numberOfLines={1}>
        {t('onboarding.suggestions.feedSectionSubtitle')}
      </Text>
    </>
  );

  // ── Loading state ───────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={styles.section}>
        {boundary}
        <View style={styles.loadingContainer}>
          <Animated.View
            style={[styles.loadingIcon, { backgroundColor: `${accentColor}15` }, pulseStyle]}
          >
            <Ionicons name="sparkles" size={28} color={accentColor} />
          </Animated.View>
          <Text size="sm" color={colors.textMuted} style={styles.loadingText}>
            {t('onboarding.suggestions.loading')}
          </Text>
        </View>
      </View>
    );
  }

  const refreshButton = !session?.user ? null : (
    <TouchableOpacity
      onPress={handleRefresh}
      disabled={isRefetching || isLoading}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={t('onboarding.suggestions.feedRefreshButton')}
      style={[
        styles.refreshButton,
        {
          backgroundColor: isDark ? `${primary[900]}30` : primary[50],
          borderColor: isDark ? primary[700] : primary[200],
        },
      ]}
    >
      <Animated.View style={spinStyle}>
        <Ionicons name="refresh-outline" size={16} color={accentColor} />
      </Animated.View>
      <Text size="sm" weight="semibold" color={accentColor}>
        {t('onboarding.suggestions.feedRefreshButton')}
      </Text>
    </TouchableOpacity>
  );

  // ── Empty result ────────────────────────────────────────────────────
  if (suggestions.length === 0) {
    return (
      <View style={styles.section}>
        {boundary}
        <View style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={32} color={colors.textMuted} />
          <Text size="sm" weight="semibold" color={colors.foreground} style={styles.emptyTitle}>
            {t('onboarding.suggestions.feedEmptyTitle')}
          </Text>
          <Text size="xs" color={colors.textMuted} style={styles.emptySubtitle}>
            {t('onboarding.suggestions.feedEmptySubtitle')}
          </Text>
          {refreshButton}
        </View>
      </View>
    );
  }

  // ── Suggestion cards ────────────────────────────────────────────────
  return (
    <View style={styles.section}>
      {boundary}

      {suggestions.slice(0, MAX_CARDS).map((suggestion, index) => {
        const animStyle =
          index < MAX_CARDS
            ? { opacity: cardOpacities[index], transform: [{ translateY: cardTranslateYs[index] }] }
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

      <View style={styles.refreshFooter}>{refreshButton}</View>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  // Loading
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacingPixels[8],
  },
  loadingIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[3],
  },
  loadingText: {
    textAlign: 'center',
  },

  // Empty
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacingPixels[6],
    paddingHorizontal: spacingPixels[4],
  },
  emptyTitle: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  emptySubtitle: {
    marginBottom: spacingPixels[4],
    textAlign: 'center',
  },

  // Refresh CTA
  refreshFooter: {
    alignItems: 'center',
    marginTop: spacingPixels[3],
    marginBottom: spacingPixels[2],
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[5],
    borderRadius: 999,
    borderWidth: 1,
  },

  // Section with cards
  section: {
    marginTop: spacingPixels[6],
    paddingHorizontal: spacingPixels[4],
  },
  boundary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  boundaryLine: {
    flex: 1,
    height: 1,
  },
  boundaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacingPixels[3],
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  boundaryLabel: {
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  boundarySubtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
  },
});

export default SuggestionsFeedSection;
