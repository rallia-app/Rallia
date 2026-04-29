/**
 * SuggestionsStep Component
 *
 * Displays personalized match suggestions after onboarding success.
 * Uses the shared SuggestionCard component for card rendering.
 * Includes confirmation modal for "Send Game Invite" and staggered animations.
 */

import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import { StyleSheet, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  makeMutable,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { SuggestionCard } from '../../../../../components/SuggestionCard';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { pickSlotForSuggestion } from '@rallia/shared-hooks';
import type { MatchSuggestion } from '@rallia/shared-services';
import type { TranslationKey } from '@rallia/shared-translations';
import * as Analytics from '../../../../../services/analytics';
import {
  suggestionSlotKey,
  useSuggestionInviteHandler,
} from '../../../../../hooks/useSuggestionInviteHandler';

const BASE_WHITE = '#ffffff';
const MAX_CARDS = 5;

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
  buttonTextActive: string;
  success: string;
}

interface SuggestionsStepProps {
  suggestions: MatchSuggestion[];
  isLoading: boolean;
  onComplete: () => void;
  onRefresh?: () => void;
  colors: ThemeColors;
  t: (key: TranslationKey) => string;
  locale: string;
  isDark: boolean;
  currentSport: { id: string; name: string; display_name: string } | null;
  playerId?: string | null;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const SuggestionsStep: React.FC<SuggestionsStepProps> = ({
  suggestions,
  isLoading,
  onComplete,
  onRefresh,
  colors,
  t,
  locale,
  isDark,
  currentSport,
  playerId,
}) => {
  const { cardLabels, inviteStates, handleSendInvite } = useSuggestionInviteHandler({
    sportId: currentSport?.id,
    playerId: playerId ?? undefined,
    onSendSuccess: () =>
      Analytics.onboardingStepCompleted({
        step_name: 'suggestions_invite_sent',
        step_index: -1,
      }),
  });

  // Animation values
  const headerOpacity = useSharedValue(0);
  const skipOpacity = useSharedValue(0);
  const cardOpacities = useRef(Array.from({ length: MAX_CARDS }, () => makeMutable(0))).current;
  const cardTranslateYs = useRef(Array.from({ length: MAX_CARDS }, () => makeMutable(20))).current;

  // Trigger animations
  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 300 }));

    if (!isLoading && suggestions.length > 0) {
      suggestions.forEach((_, index) => {
        if (index < MAX_CARDS) {
          cardOpacities[index].value = withDelay(
            300 + index * 150,
            withTiming(1, { duration: 350 })
          );
          cardTranslateYs[index].value = withDelay(
            300 + index * 150,
            withSpring(0, { damping: 40, stiffness: 300 })
          );
        }
      });

      skipOpacity.value = withDelay(
        300 + Math.min(suggestions.length, MAX_CARDS) * 150 + 200,
        withTiming(1, { duration: 400 })
      );
    } else if (!isLoading) {
      skipOpacity.value = withDelay(600, withTiming(1, { duration: 400 }));
    }
  }, [isLoading, suggestions.length]);

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
  }));

  const skipAnimatedStyle = useAnimatedStyle(() => ({
    opacity: skipOpacity.value,
  }));

  const hasSentInvite = useMemo(
    () => Object.values(inviteStates).some(state => state === 'sent'),
    [inviteStates]
  );

  const handleSkip = useCallback(() => {
    Analytics.onboardingStepCompleted({
      step_name: hasSentInvite ? 'suggestions_continued' : 'suggestions_skipped',
      step_index: -1,
    });
    onComplete();
  }, [onComplete, hasSentInvite]);

  return (
    <View style={styles.wrapper}>
      <SheetScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View style={[styles.headerContainer, headerAnimatedStyle]}>
          <View style={[styles.iconContainer, { backgroundColor: colors.buttonActive }]}>
            <Ionicons name="sparkles" size={32} color={BASE_WHITE} />
          </View>
          <Text size="xl" weight="bold" color={colors.text} style={styles.title}>
            {t('onboarding.suggestions.title' as TranslationKey)}
          </Text>
          <Text size="base" color={colors.textMuted} style={styles.subtitle}>
            {t('onboarding.suggestions.subtitle' as TranslationKey)}
          </Text>
        </Animated.View>

        {/* Content */}
        {isLoading ? (
          <View style={styles.centeredState}>
            <ActivityIndicator size="large" color={colors.buttonActive} />
            <Text size="sm" color={colors.textMuted} style={styles.stateText}>
              {t('onboarding.suggestions.loading' as TranslationKey)}
            </Text>
          </View>
        ) : suggestions.length === 0 ? (
          <View style={styles.centeredState}>
            <Ionicons name="search-outline" size={48} color={colors.textMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.stateText}>
              {t('onboarding.suggestions.emptyTitle' as TranslationKey)}
            </Text>
            <Text size="sm" color={colors.textMuted}>
              {t('onboarding.suggestions.emptySubtitle' as TranslationKey)}
            </Text>
            {onRefresh && (
              <TouchableOpacity
                style={[styles.refreshButton, { borderColor: colors.buttonActive }]}
                onPress={onRefresh}
                activeOpacity={0.7}
              >
                <Ionicons name="refresh-outline" size={18} color={colors.buttonActive} />
                <Text size="sm" weight="semibold" color={colors.buttonActive}>
                  {t('common.refresh' as TranslationKey)}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.cardsContainer}>
            {suggestions.slice(0, MAX_CARDS).map((suggestion, index) => {
              const cardAnimatedStyle = {
                opacity: cardOpacities[index],
                transform: [{ translateY: cardTranslateYs[index] }],
              };
              const picked = pickSlotForSuggestion(suggestion, Date.now());
              if (!picked) return null;
              const pickedFacility = suggestion.facilities[picked.facilityIndex];
              const slotKey = suggestionSlotKey(
                suggestion.opponentId,
                pickedFacility.facilityId,
                picked.slot.datetime
              );
              return (
                <Animated.View key={suggestion.opponentId} style={cardAnimatedStyle}>
                  <SuggestionCard
                    suggestion={suggestion}
                    colors={colors}
                    isDark={isDark}
                    onSendInvite={handleSendInvite}
                    inviteState={inviteStates[slotKey] ?? 'idle'}
                    labels={cardLabels}
                    locale={locale}
                    lockSelections
                    pickedSlot={picked.slot}
                    pickedFacilityIndex={picked.facilityIndex}
                  />
                </Animated.View>
              );
            })}
          </View>
        )}

        {/* Skip / Continue button */}
        <Animated.View style={skipAnimatedStyle}>
          {hasSentInvite ? (
            <TouchableOpacity
              onPress={handleSkip}
              activeOpacity={0.8}
              style={[styles.continueButton, { backgroundColor: colors.buttonActive }]}
            >
              <Text
                size="base"
                weight="semibold"
                color={colors.buttonTextActive}
                style={styles.continueText}
              >
                {t('common.continue' as TranslationKey)}
              </Text>
              <Ionicons name="arrow-forward" size={18} color={colors.buttonTextActive} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleSkip} activeOpacity={0.6} style={styles.skipButton}>
              <Text size="sm" color={colors.textMuted} style={styles.skipText}>
                {t('onboarding.suggestions.exploreLater' as TranslationKey)}
              </Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </SheetScrollView>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: spacingPixels[5],
    paddingTop: spacingPixels[8],
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: spacingPixels[5],
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[3],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacingPixels[1],
  },
  subtitle: {
    textAlign: 'center',
    paddingHorizontal: spacingPixels[4],
  },

  // Cards
  cardsContainer: {},

  // States
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[8],
  },
  stateText: {
    marginTop: spacingPixels[3],
    textAlign: 'center',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[5],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[2],
  },

  // Skip
  skipButton: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  skipText: {
    textAlign: 'center',
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    marginHorizontal: spacingPixels[1],
    marginTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  continueText: {
    textAlign: 'center',
  },
});

export default SuggestionsStep;
