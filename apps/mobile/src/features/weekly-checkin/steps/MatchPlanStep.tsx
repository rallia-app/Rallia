/**
 * Step 4 — Match plan (one suggestion at a time).
 *
 * The best game configurations the check-in can create from the availability
 * the player just declared are presented as a deck, ONE card at a time: the
 * game's setting (sport, day, time, place) plus the top opponents who'd get
 * invited. The player either skips the suggestion or trims its invite list and
 * confirms it — a deliberate approve/pass rhythm instead of a long checklist.
 * The header's back button rewinds one card (wizard.goBack handles that).
 *
 * When the last card is decided the step submits automatically: exactly the
 * approved games get created, and only the invitees left selected get invited.
 * Skipping everything submits an empty plan (create nothing).
 *
 * A discreet link under the deck persists auto_create_matches = false for
 * future check-ins; the paused state offers the mirror link to re-enable.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { primary, spacingPixels } from '@rallia/design-system';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import {
  PlanProposalDetail,
  PlanProposalDetailSkeleton,
} from '#/features/weekly-checkin/components/PlanProposalDetail';
import type { CheckInMatchPlan } from '#/features/weekly-checkin/api';
import type {
  PlanDecision,
  PlanDecisionEntry,
} from '#/features/weekly-checkin/useWeeklyCheckInWizard';
import { formatWeekdayName } from '#/features/weekly-checkin/window';
import { useTranslation } from '#/hooks';
import { useLocale } from '#/context';
import { lightHaptic, selectionHaptic, successHaptic } from '#/utils/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface MatchPlanStepProps {
  plan: CheckInMatchPlan | null;
  isLoading: boolean;
  error: boolean;
  planDecisions: PlanDecisionEntry[];
  decideProposal: (key: string, decision: PlanDecision) => void;
  inviteSelections: Record<string, string[]>;
  toggleInvitee: (proposalKey: string, playerId: string) => void;
  optOut: boolean;
  setOptOut: (b: boolean) => void;
  isSubmitting: boolean;
  /** Runs the check-in submit; resolves false when it failed (retry stays here). */
  onSubmit: () => Promise<boolean>;
  /** ISO date of the window's first day — anchors "Today"/"Tomorrow" labels. */
  todayDate: string | null;
  tomorrowDate: string | null;
}

export function MatchPlanStep({
  plan,
  isLoading,
  error,
  planDecisions,
  decideProposal,
  inviteSelections,
  toggleInvitee,
  optOut,
  setOptOut,
  isSubmitting,
  onSubmit,
  todayDate,
  tomorrowDate,
}: MatchPlanStepProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { colors, isDark } = useThemeStyles();
  const linkColor = isDark ? primary[400] : primary[600];
  const accentSoft = isDark ? `${primary[400]}1F` : `${primary[600]}14`;

  const proposals = useMemo(() => plan?.proposals ?? [], [plan]);
  const decisionByKey = useMemo(() => {
    const map: Record<string, PlanDecision> = {};
    for (const d of planDecisions) map[d.key] = d.decision;
    return map;
  }, [planDecisions]);

  // The deck cursor is DERIVED: the first proposal without a verdict. Undo
  // (header back) pops a verdict in the wizard and the cursor falls back here.
  const currentIndex = useMemo(
    () => proposals.findIndex(p => !decisionByKey[p.key]),
    [proposals, decisionByKey]
  );
  const currentProposal = currentIndex >= 0 ? proposals[currentIndex] : null;
  const allDecided = proposals.length > 0 && currentIndex === -1;
  const createdCount = useMemo(
    () => proposals.filter(p => decisionByKey[p.key] === 'create').length,
    [proposals, decisionByKey]
  );

  const committed = plan?.committedCount ?? 0;

  // Relative day label: "Today"/"Tomorrow" for the first two window dates,
  // otherwise the localized weekday name.
  const dayLabelFor = (matchDate: string): string => {
    if (todayDate && matchDate === todayDate) return t('common.time.today');
    if (tomorrowDate && matchDate === tomorrowDate) return t('common.time.tomorrow');
    return formatWeekdayName(matchDate, locale);
  };

  // ---------------------------------------------------------------------------
  // Deck transitions — a single translateX drives the leaving/entering
  // proposal. Skip exits left, create exits right (approve/pass reads
  // directionally); the next proposal always enters from the right. Always
  // driven through Animated.timing (a bare setValue can be dropped by the
  // native driver — see WeeklyCheckInScreen's pager comment), so the "jump"
  // legs use duration 0.
  // ---------------------------------------------------------------------------
  const slideAnim = useMemo(() => new Animated.Value(0), []);
  // Success beat on approve: a check badge pops over the card and holds a
  // moment before the slide-out, so "this game is happening" lands before the
  // next suggestion appears. Skips exit immediately.
  const successAnim = useMemo(() => new Animated.Value(0), []);
  const [animating, setAnimating] = useState(false);
  // The LAST card settles in place: no slide-out and no interstitial spinner
  // panel — the pressed button carries the loading state until the submit
  // resolves and the wizard slides to All-Set. Holds which button spins.
  const [finalizing, setFinalizing] = useState<PlanDecision | null>(null);

  const undecidedCount = useMemo(
    () => proposals.filter(p => !decisionByKey[p.key]).length,
    [proposals, decisionByKey]
  );

  const handleDecision = useCallback(
    (decision: PlanDecision) => {
      if (animating || isSubmitting || finalizing || !currentProposal) return;
      if (undecidedCount === 1) {
        // Last suggestion: record the verdict without sliding away — the deck
        // stays visible (success overlay on create) while the auto-submit
        // effect runs and the pressed button shows the spinner.
        setFinalizing(decision);
        if (decision === 'create') {
          void successHaptic();
          setAnimating(true);
          Animated.timing(successAnim, {
            toValue: 1,
            duration: 200,
            easing: Easing.out(Easing.back(1.5)),
            useNativeDriver: true,
          }).start(() => {
            setAnimating(false);
            decideProposal(currentProposal.key, decision);
          });
        } else {
          void lightHaptic();
          decideProposal(currentProposal.key, decision);
        }
        return;
      }
      setAnimating(true);
      const advance = () => {
        decideProposal(currentProposal.key, decision);
        Animated.sequence([
          Animated.timing(successAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(slideAnim, {
            toValue: SCREEN_WIDTH,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 240,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start(() => setAnimating(false));
      };
      if (decision === 'create') {
        void successHaptic();
        Animated.sequence([
          Animated.timing(successAnim, {
            toValue: 1,
            duration: 200,
            easing: Easing.out(Easing.back(1.5)),
            useNativeDriver: true,
          }),
          Animated.delay(450),
          Animated.timing(slideAnim, {
            toValue: SCREEN_WIDTH,
            duration: 220,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start(advance);
      } else {
        void lightHaptic();
        Animated.timing(slideAnim, {
          toValue: -SCREEN_WIDTH,
          duration: 200,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(advance);
      }
    },
    [
      animating,
      isSubmitting,
      finalizing,
      undecidedCount,
      currentProposal,
      decideProposal,
      slideAnim,
      successAnim,
    ]
  );

  // While the last verdict settles, the cursor is already past the end — keep
  // showing the proposal that was just decided.
  const finalizedProposal = useMemo(() => {
    if (!finalizing) return null;
    const lastKey = planDecisions[planDecisions.length - 1]?.key;
    return proposals.find(p => p.key === lastKey) ?? null;
  }, [finalizing, planDecisions, proposals]);
  const displayProposal = currentProposal ?? finalizedProposal;

  // Backward (header back → the wizard pops the last verdict): the restored
  // card slides in from the LEFT, mirroring the forward direction of travel.
  // The forward path animates itself in handleDecision, so this only reacts
  // to the decision count shrinking.
  const prevDecisionCountRef = useRef(planDecisions.length);
  useLayoutEffect(() => {
    const prev = prevDecisionCountRef.current;
    prevDecisionCountRef.current = planDecisions.length;
    if (planDecisions.length >= prev) return;
    setAnimating(true);
    Animated.sequence([
      Animated.timing(slideAnim, {
        toValue: -SCREEN_WIDTH,
        duration: 0,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => setAnimating(false));
  }, [planDecisions.length, slideAnim]);

  const deckOpacity = slideAnim.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: [0, 1, 0],
  });
  const successScale = successAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  // ---------------------------------------------------------------------------
  // Auto-submit once every card is decided. One attempt per completion — undo
  // after a failure resets the guard so re-completing retries naturally.
  // ---------------------------------------------------------------------------
  const [submitFailed, setSubmitFailed] = useState(false);
  const attemptedRef = useRef(false);
  useEffect(() => {
    if (!allDecided) {
      attemptedRef.current = false;
      setSubmitFailed(false);
      setFinalizing(null);
    }
  }, [allDecided]);
  useEffect(() => {
    if (!allDecided || optOut || animating || isSubmitting || attemptedRef.current) return;
    attemptedRef.current = true;
    void onSubmit().then(ok => {
      if (!ok) {
        // Fall out of the settled card into the failed panel (retry CTA).
        setSubmitFailed(true);
        setFinalizing(null);
        Animated.timing(successAnim, { toValue: 0, duration: 0, useNativeDriver: true }).start();
      }
    });
  }, [allDecided, optOut, animating, isSubmitting, onSubmit, successAnim]);

  const handleRetry = useCallback(() => {
    setSubmitFailed(false);
    void onSubmit().then(ok => {
      if (!ok) setSubmitFailed(true);
    });
  }, [onSubmit]);

  const handleOptOutLink = useCallback(
    (next: boolean) => {
      void selectionHaptic();
      setOptOut(next);
    },
    [setOptOut]
  );

  // The empty / error / paused paths finish through an explicit CTA instead of
  // the deck's auto-submit.
  const handleFinish = useCallback(() => {
    void onSubmit().then(ok => {
      if (!ok) setSubmitFailed(true);
    });
  }, [onSubmit]);

  const hasProposals = proposals.length > 0;
  // Last verdict settling in place — the deck stays up, a button spins.
  const settlingOnDeck = allDecided && !!finalizing && !submitFailed;
  const showDeck =
    !isLoading && !error && !optOut && hasProposals && (!allDecided || settlingOnDeck);
  // Deck exhausted outside the in-place settle: only the retry-after-failure
  // path (and its spinner while retrying) lands here now.
  const inSubmitPanel = !isLoading && !error && !optOut && allDecided && !settlingOnDeck;
  // Every terminal state that finishes through an explicit CTA instead:
  // preview error (legacy fallback), opted out, or nothing to propose.
  const showFinishFooter = !isLoading && !showDeck && !inSubmitPanel;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        // The deck (and its skeleton) stretches to the full remaining height —
        // one suggestion owns the screen; scrolling only kicks in when the
        // invite list genuinely overflows a small display.
        contentContainerStyle={[styles.scroll, (showDeck || isLoading) && styles.scrollFill]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.bubbleWrap}>
          <MascotBubble text={t('weeklyCheckIn.plan.bubble')} textKey="match-plan" />
        </View>

        {isLoading ? (
          <PlanProposalDetailSkeleton />
        ) : error ? (
          // Preview failed → the wizard submits plan:null (legacy autonomous
          // generation), so reassure rather than dead-end.
          <View style={styles.center}>
            <View style={[styles.stateIcon, { backgroundColor: accentSoft }]}>
              <Ionicons name="construct-outline" size={26} color={linkColor} />
            </View>
            <Text style={[styles.fallbackText, { color: colors.textMuted }]}>
              {t('weeklyCheckIn.plan.errorFallback')}
            </Text>
          </View>
        ) : optOut ? (
          <View style={styles.center}>
            <View style={[styles.stateIcon, { backgroundColor: accentSoft }]}>
              <Ionicons name="hand-left-outline" size={26} color={linkColor} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('weeklyCheckIn.plan.optOutTitleOff')}
            </Text>
            <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
              {t('weeklyCheckIn.plan.optOutNote')}
            </Text>
            <Pressable onPress={() => handleOptOutLink(false)} hitSlop={8}>
              <Text style={[styles.optOutLink, { color: linkColor }]}>
                {t('weeklyCheckIn.plan.optOutActiveLink')}
              </Text>
            </Pressable>
          </View>
        ) : !hasProposals ? (
          <View style={styles.center}>
            <View style={[styles.stateIcon, { backgroundColor: accentSoft }]}>
              <Ionicons name="checkmark-done-outline" size={26} color={linkColor} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {t('weeklyCheckIn.plan.emptyTitle')}
            </Text>
            <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
              {committed === 1
                ? t('weeklyCheckIn.plan.emptyBodyOne')
                : t('weeklyCheckIn.plan.emptyBody', { count: committed })}
            </Text>
          </View>
        ) : allDecided && !settlingOnDeck ? (
          // Retry-after-failure fallback (the normal finish settles on the deck).
          <View style={styles.center}>
            {submitFailed ? (
              <>
                <View style={[styles.stateIcon, { backgroundColor: accentSoft }]}>
                  <Ionicons name="cloud-offline-outline" size={26} color={linkColor} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>
                  {t('weeklyCheckIn.plan.submitFailedTitle')}
                </Text>
                <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
                  {t('weeklyCheckIn.plan.submitFailedBody')}
                </Text>
              </>
            ) : (
              <>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
                  {createdCount > 0
                    ? t('weeklyCheckIn.plan.submitting')
                    : t('weeklyCheckIn.plan.submittingNone')}
                </Text>
              </>
            )}
          </View>
        ) : (
          <>
            {displayProposal && (
              <Animated.View
                // Freeze interactions while the last verdict settles — the
                // submit already carries the selections as they were.
                pointerEvents={finalizing ? 'none' : 'auto'}
                style={[
                  styles.deckBody,
                  { opacity: deckOpacity, transform: [{ translateX: slideAnim }] },
                ]}
              >
                <PlanProposalDetail
                  proposal={displayProposal}
                  dayLabel={dayLabelFor(displayProposal.matchDate)}
                  selectedInviteeIds={inviteSelections[displayProposal.key] ?? []}
                  onToggleInvitee={playerId => toggleInvitee(displayProposal.key, playerId)}
                />
                {/* Approve confirmation — pops in over the card, slides out with it. */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    styles.successOverlay,
                    { backgroundColor: `${colors.background}D9`, opacity: successAnim },
                  ]}
                >
                  <Animated.View
                    style={[
                      styles.successBadge,
                      { backgroundColor: linkColor, transform: [{ scale: successScale }] },
                    ]}
                  >
                    <Ionicons name="checkmark" size={40} color="#FFFFFF" />
                  </Animated.View>
                  <Text style={[styles.successLabel, { color: colors.text }]}>
                    {t('weeklyCheckIn.plan.createdOverlay')}
                  </Text>
                </Animated.View>
              </Animated.View>
            )}
          </>
        )}
      </ScrollView>

      {showDeck && (
        <View style={styles.footer}>
          <View style={styles.actionsRow}>
            <View style={styles.actionSlot}>
              <Button
                variant="outline"
                size="lg"
                fullWidth
                rounded
                isDark={isDark}
                loading={finalizing === 'skip'}
                disabled={animating || isSubmitting || !!finalizing}
                onPress={() => handleDecision('skip')}
              >
                {t('weeklyCheckIn.plan.skipCta')}
              </Button>
            </View>
            <View style={styles.actionSlotWide}>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                rounded
                isDark={isDark}
                loading={finalizing === 'create'}
                disabled={animating || isSubmitting || !!finalizing}
                onPress={() => handleDecision('create')}
              >
                {t('weeklyCheckIn.plan.createCta')}
              </Button>
            </View>
          </View>
          <Pressable
            onPress={() => handleOptOutLink(true)}
            hitSlop={8}
            disabled={animating || isSubmitting || !!finalizing}
            style={styles.optOutLinkWrap}
          >
            <Text style={[styles.optOutLinkSmall, { color: colors.textMuted }]}>
              {t('weeklyCheckIn.plan.optOutLink')}
            </Text>
          </Pressable>
        </View>
      )}

      {showFinishFooter && (
        <View style={styles.footer}>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            rounded
            isDark={isDark}
            loading={isSubmitting}
            disabled={isSubmitting}
            onPress={handleFinish}
          >
            {t('weeklyCheckIn.plan.ctaNone')}
          </Button>
        </View>
      )}

      {inSubmitPanel && submitFailed && (
        <View style={styles.footer}>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            rounded
            isDark={isDark}
            loading={isSubmitting}
            disabled={isSubmitting}
            onPress={handleRetry}
          >
            {t('weeklyCheckIn.plan.retryCta')}
          </Button>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scroll: {
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[3],
  },
  scrollFill: {
    flexGrow: 1,
  },
  deckBody: {
    flex: 1,
  },
  successOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[3],
  },
  successBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  successLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  bubbleWrap: {
    paddingHorizontal: spacingPixels[5],
    marginBottom: spacingPixels[3],
  },
  center: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[8],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
  },
  stateIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacingPixels[1],
  },
  fallbackText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  optOutLink: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacingPixels[2],
  },
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[6],
    paddingTop: spacingPixels[2],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacingPixels[3],
  },
  actionSlot: {
    flex: 1,
  },
  actionSlotWide: {
    flex: 1.6,
  },
  optOutLinkWrap: {
    alignSelf: 'center',
    marginTop: spacingPixels[3],
  },
  optOutLinkSmall: {
    fontSize: 12.5,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});
