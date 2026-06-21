/**
 * SuggestionsStep Component
 *
 * Final onboarding step: real PUBLIC matches with open spots that fit what the
 * player just set up (favorite courts, rating, declared availability). Same
 * MatchCard + one-click join used by the weekly check-in's "Games for you"
 * step — Join / Ask to join fires the join directly (no MatchDetailSheet) and
 * the card CTA flips to a disabled Joined / Requested state on success.
 *
 * Joining is optional: the footer always lets the player continue (or skip)
 * into the app. When no open game fits, the empty state nudges them to the home
 * screen.
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { ScrollView as SheetScrollView } from 'react-native-actions-sheet';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { MatchCard, Text } from '@rallia/shared-components';
import { useAuth } from '@rallia/shared-hooks';
import { base, primary, spacingPixels, radiusPixels } from '@rallia/design-system';
import type { MatchWithDetails } from '@rallia/shared-types';
import type { TranslationKey } from '@rallia/shared-translations';

import * as Analytics from '#/services/analytics';
import { useJoinOpportunity, type JoinOutcome } from '#/features/weekly-checkin/useJoinOpportunity';

const BASE_WHITE = '#ffffff';
const MAX_CARDS = 5;
const NOOP = () => {};

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
  /** Real public matches with open spots that fit the player's setup. */
  opportunities: MatchWithDetails[];
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
  opportunities,
  isLoading,
  onComplete,
  onRefresh,
  colors,
  t,
  locale,
  isDark,
  playerId,
}) => {
  // Prefer the LIVE auth session id (the same source the weekly check-in uses)
  // over the `playerId` prop. That prop is the wizard's async `successPlayerId`
  // React state, which can lag or hold a previous account's id across multiple
  // onboardings in one app session — making joinMatch insert player_id != the
  // current auth.uid(), which RLS rejects (error haptic, no row created).
  const { session } = useAuth();
  const effectivePlayerId = session?.user?.id ?? playerId ?? null;

  // Join failures surface via a native Alert here, not the global toast: this
  // step lives in a bottom sheet, which renders above the toast layer and would
  // hide it. Success needs no toast — the CTA flips to its Joined/Requested pill.
  const handleJoinError = useCallback((msg: string) => Alert.alert(t('alerts.error'), msg), [t]);

  // One-click join, scoped to onboarding for the discovery_source on analytics.
  const { join, outcomes, pendingId } = useJoinOpportunity(effectivePlayerId, {
    source: 'onboarding',
    notifyError: handleJoinError,
  });

  // Cap the preview at MAX_CARDS — the caller already fetches up to 20, but the
  // post-onboarding moment only needs a short, joinable shortlist.
  const previewOpportunities = useMemo<MatchWithDetails[]>(
    () => opportunities.slice(0, MAX_CARDS),
    [opportunities]
  );

  // Header + footer fade-in. The cards themselves render unwrapped (see below):
  // a per-card Animated.View wrapper memoizes the MatchCard subtree under the
  // React Compiler, which stops the one-click Join CTA from flipping to its
  // Joined/Requested state when `outcomes` updates. Weekly check-in renders the
  // cards bare for the same reason.
  const headerOpacity = useSharedValue(0);
  const skipOpacity = useSharedValue(0);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 300 }));
    if (!isLoading) {
      skipOpacity.value = withDelay(400, withTiming(1, { duration: 400 }));
    }
  }, [isLoading]);

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
  }));

  const skipAnimatedStyle = useAnimatedStyle(() => ({
    opacity: skipOpacity.value,
  }));

  // True once the player has joined / requested / waitlisted at least one game —
  // flips the footer from a quiet "skip" into a confident "Continue".
  const hasJoined = useMemo(() => Object.keys(outcomes).length > 0, [outcomes]);

  const renderCta = useCallback(
    (match: MatchWithDetails) => (
      <OpportunityCta
        match={match}
        outcome={outcomes[match.id]}
        isPending={pendingId === match.id}
        isDark={isDark}
        t={t}
        onJoin={join}
      />
    ),
    [outcomes, pendingId, isDark, t, join]
  );

  const handleSkip = useCallback(() => {
    Analytics.onboardingStepCompleted({
      step_name: hasJoined ? 'suggestions_continued' : 'suggestions_skipped',
      step_index: -1,
    });
    onComplete();
  }, [onComplete, hasJoined]);

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
            {t('onboarding.suggestions.title')}
          </Text>
          <Text size="base" color={colors.textMuted} style={styles.subtitle}>
            {t('onboarding.suggestions.gamesSubtitle')}
          </Text>
        </Animated.View>

        {/* Content */}
        {isLoading ? (
          <View style={styles.centeredState}>
            <ActivityIndicator size="large" color={colors.buttonActive} />
            <Text size="sm" color={colors.textMuted} style={styles.stateText}>
              {t('onboarding.suggestions.loading')}
            </Text>
          </View>
        ) : previewOpportunities.length === 0 ? (
          <View style={styles.centeredState}>
            <Ionicons name="search-outline" size={48} color={colors.textMuted} />
            <Text size="base" weight="semibold" color={colors.text} style={styles.stateText}>
              {t('onboarding.suggestions.emptyTitle')}
            </Text>
            <Text size="sm" color={colors.textMuted}>
              {t('onboarding.suggestions.emptySubtitle')}
            </Text>
            {onRefresh && (
              <TouchableOpacity
                style={[styles.refreshButton, { borderColor: colors.buttonActive }]}
                onPress={onRefresh}
                activeOpacity={0.7}
              >
                <Ionicons name="refresh-outline" size={18} color={colors.buttonActive} />
                <Text size="sm" weight="semibold" color={colors.buttonActive}>
                  {t('common.refresh')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.cardsContainer}>
            {previewOpportunities.map(match => (
              <MatchCard
                key={match.id}
                match={match}
                isDark={isDark}
                t={t}
                locale={locale}
                currentPlayerId={effectivePlayerId ?? undefined}
                onPress={NOOP}
                renderCta={renderCta}
              />
            ))}
          </View>
        )}

        {/* Skip / Continue button */}
        <Animated.View style={skipAnimatedStyle}>
          {hasJoined ? (
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
                {t('common.continue')}
              </Text>
              <Ionicons name="arrow-forward" size={18} color={colors.buttonTextActive} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleSkip} activeOpacity={0.6} style={styles.skipButton}>
              <Text size="sm" color={colors.textMuted} style={styles.skipText}>
                {t('onboarding.suggestions.exploreLater')}
              </Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </SheetScrollView>
    </View>
  );
};

// =============================================================================
// JOIN CTA — replaces MatchCard's default footer with a one-click join button
// =============================================================================

interface OpportunityCtaProps {
  match: MatchWithDetails;
  outcome: JoinOutcome | undefined;
  isPending: boolean;
  isDark: boolean;
  t: (key: TranslationKey) => string;
  onJoin: (match: MatchWithDetails) => void;
}

function OpportunityCta({ match, outcome, isPending, isDark, t, onJoin }: OpportunityCtaProps) {
  const positive = isDark ? primary[400] : primary[500];

  if (outcome) {
    const label =
      outcome === 'joined'
        ? t('weeklyCheckIn.opportunities.joined')
        : outcome === 'requested'
          ? t('weeklyCheckIn.opportunities.requested')
          : t('weeklyCheckIn.opportunities.waitlisted');
    const icon = outcome === 'requested' ? 'time-outline' : 'checkmark-circle';
    return (
      <View style={styles.cardFooter}>
        <View style={[styles.cta, { backgroundColor: `${positive}${isDark ? '30' : '20'}` }]}>
          <Ionicons name={icon} size={14} color={positive} style={styles.ctaIcon} />
          <Text size="sm" weight="bold" color={positive}>
            {label}
          </Text>
        </View>
      </View>
    );
  }

  const isRequest = match.join_mode === 'request';
  const label = isRequest ? t('match.cta.askToJoin') : t('match.cta.join');
  const icon = isRequest ? 'hand-left-outline' : 'add-circle-outline';

  return (
    <View style={styles.cardFooter}>
      <TouchableOpacity
        style={[styles.cta, { backgroundColor: positive }, isPending && styles.ctaPending]}
        onPress={() => onJoin(match)}
        disabled={isPending}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {isPending ? (
          <ActivityIndicator color={base.white} />
        ) : (
          <>
            <Ionicons name={icon} size={14} color={base.white} style={styles.ctaIcon} />
            <Text size="sm" weight="bold" color={base.white}>
              {label}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

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

  // Join CTA
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacingPixels[3],
    gap: spacingPixels[2],
  },
  cta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.lg,
  },
  ctaPending: {
    opacity: 0.7,
  },
  ctaIcon: {
    marginRight: spacingPixels[1],
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
