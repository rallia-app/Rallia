/**
 * SuggestionsFeedSection Component
 *
 * Appended at the end of match lists (Home, Public Matches).
 * Shows a prompt banner → user taps "Generate" → loads and displays suggestion cards.
 * Reuses SuggestionCard, useMatchSuggestions, and per-card invite state.
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
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import { useMatchSuggestions } from '@rallia/shared-hooks';
import { createMatchFromSuggestion } from '@rallia/shared-services';
import { useQueryClient } from '@tanstack/react-query';
import { useThemeStyles, useTranslation } from '../hooks';
import { useAuth, usePlayer } from '../hooks';
import { useSport } from '../context';
import { usePlayerSports } from '@rallia/shared-hooks';
import { SuggestionCard, type SuggestionCardLabels, type InvitePayload } from './SuggestionCard';

const MAX_CARDS = 10;

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
  const { playerSports } = usePlayerSports(session?.user?.id);
  const callerSportPrefs = playerSports.find(ps => ps.sport_id === (selectedSport?.id ?? sportId));
  const callerDuration = callerSportPrefs?.preferred_match_duration ?? '60';
  const callerMatchType = callerSportPrefs?.preferred_match_type ?? 'both';
  const queryClient = useQueryClient();

  const [showSuggestions, setShowSuggestions] = useState(false);

  const { suggestions, isLoading } = useMatchSuggestions({
    playerId,
    sportId,
    sportName,
    limit: MAX_CARDS,
    enabled: showSuggestions,
  });

  // Per-card invite state
  const [inviteStates, setInviteStates] = useState<Record<string, 'idle' | 'sending' | 'sent'>>({});

  const handleGenerate = useCallback(() => {
    lightHaptic();
    setShowSuggestions(true);
  }, []);

  const inviteStatesRef = useRef(inviteStates);
  inviteStatesRef.current = inviteStates;

  const handleSendInvite = useCallback(
    async (payload: InvitePayload) => {
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
      session?.user?.id,
      selectedSport?.id,
      sportId,
      callerDuration,
      callerMatchType,
      queryClient,
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

  // Loading animation
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

  // Card stagger animation — shared values must be at top level, not inside useMemo
  const cardOpacities = Array.from({ length: MAX_CARDS }, () => useSharedValue(0));
  const cardTranslateYs = Array.from({ length: MAX_CARDS }, () => useSharedValue(20));

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

  // ── Not yet opted in → prompt banner ────────────────────────────────
  if (!showSuggestions) {
    return (
      <View
        style={[
          styles.promptBanner,
          {
            backgroundColor: isDark ? `${primary[900]}40` : primary[50],
            borderColor: isDark ? primary[700] : primary[200],
          },
        ]}
      >
        <Ionicons name="sparkles" size={28} color={accentColor} style={styles.promptIcon} />
        <Text size="base" weight="semibold" color={colors.foreground} style={styles.promptTitle}>
          {t('onboarding.suggestions.feedPromptTitle')}
        </Text>
        <Text size="sm" color={colors.textMuted} style={styles.promptSubtitle}>
          {t('onboarding.suggestions.feedPromptSubtitle')}
        </Text>
        <TouchableOpacity
          style={[styles.promptButton, { backgroundColor: accentColor }]}
          onPress={handleGenerate}
          activeOpacity={0.8}
        >
          <Ionicons
            name="sparkles-outline"
            size={16}
            color="#ffffff"
            style={styles.promptButtonIcon}
          />
          <Text size="sm" weight="bold" color="#ffffff">
            {t('onboarding.suggestions.feedPromptButton')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Loading state ───────────────────────────────────────────────────
  if (isLoading) {
    return (
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
    );
  }

  // ── Empty result ────────────────────────────────────────────────────
  if (suggestions.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="search-outline" size={32} color={colors.textMuted} />
        <Text size="sm" weight="semibold" color={colors.foreground} style={styles.emptyTitle}>
          {t('onboarding.suggestions.feedEmptyTitle')}
        </Text>
        <Text size="xs" color={colors.textMuted}>
          {t('onboarding.suggestions.feedEmptySubtitle')}
        </Text>
      </View>
    );
  }

  // ── Suggestion cards ────────────────────────────────────────────────
  return (
    <View style={styles.section}>
      {/* Section header */}
      <View style={styles.sectionHeader}>
        <Ionicons name="sparkles" size={18} color={accentColor} />
        <Text size="base" weight="bold" color={colors.foreground} style={styles.sectionTitle}>
          {t('onboarding.suggestions.feedSectionTitle')}
        </Text>
      </View>

      {/* Cards */}
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
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  // Prompt banner
  promptBanner: {
    alignItems: 'center',
    padding: spacingPixels[5],
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
  },
  promptIcon: {
    marginBottom: spacingPixels[2],
  },
  promptTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  promptSubtitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[4],
    paddingHorizontal: spacingPixels[2],
  },
  promptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[5],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
  promptButtonIcon: {},

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

  // Section with cards
  section: {
    marginTop: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[3],
  },
  sectionTitle: {},
});

export default SuggestionsFeedSection;
