/**
 * Step 4 — Match plan (transparent preview → confirm).
 *
 * The player sees the exact games the check-in would create from the
 * availability they just declared — sport, day, time, place, required level.
 * Everything is included by default; they can remove whole games, then confirm.
 * The CTA submits the check-in, creating exactly the games they kept.
 *
 * A prominent opt-out switch above the proposal cards persists
 * auto_create_matches = false for future check-ins.
 */
import React, { useMemo } from 'react';
import { LayoutAnimation, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Skeleton, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { neutral, primary, radiusPixels, spacingPixels } from '@rallia/design-system';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import {
  PlanProposalCard,
  PlanProposalCardSkeleton,
} from '#/features/weekly-checkin/components/PlanProposalCard';
import type { CheckInMatchPlan } from '#/features/weekly-checkin/api';
import { formatWeekdayName } from '#/features/weekly-checkin/window';
import { useTranslation } from '#/hooks';
import { useLocale, useSport } from '#/context';
import { selectionHaptic } from '#/utils/haptics';
import { SportIcon } from '#/components/SportIcon';

const animateNext = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

interface MatchPlanStepProps {
  plan: CheckInMatchPlan | null;
  isLoading: boolean;
  error: boolean;
  excludedProposalKeys: string[];
  toggleProposal: (key: string) => void;
  optOut: boolean;
  setOptOut: (b: boolean) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
  /** ISO date of the window's first day — anchors "Today"/"Tomorrow" labels. */
  todayDate: string | null;
  tomorrowDate: string | null;
}

export function MatchPlanStep({
  plan,
  isLoading,
  error,
  excludedProposalKeys,
  toggleProposal,
  optOut,
  setOptOut,
  isSubmitting,
  onSubmit,
  todayDate,
  tomorrowDate,
}: MatchPlanStepProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { selectedSport } = useSport();
  const { colors, isDark } = useThemeStyles();
  const linkColor = isDark ? primary[400] : primary[600];
  const accentSoft = isDark ? `${primary[400]}1F` : `${primary[600]}14`;

  const proposals = useMemo(() => plan?.proposals ?? [], [plan]);
  const optOutSportName = useMemo(
    () => proposals[0]?.sportName ?? selectedSport?.name ?? 'tennis',
    [proposals, selectedSport?.name]
  );
  const includedCount = useMemo(
    () => (optOut ? 0 : proposals.filter(p => !excludedProposalKeys.includes(p.key)).length),
    [proposals, excludedProposalKeys, optOut]
  );

  const goal = plan?.goal ?? 0;
  const committed = plan?.committedCount ?? 0;
  const projected = committed + includedCount;
  const goalMet = goal > 0 && projected >= goal;

  // Headline names exactly what's on screen: the NEW games this check-in will
  // create. "New" separates them from games already on the player's calendar,
  // which the progress bar + caption below fold in.
  const readyCountLabel =
    includedCount === 0
      ? t('weeklyCheckIn.plan.readyCountNone')
      : includedCount === 1
        ? t('weeklyCheckIn.plan.readyCountOne')
        : t('weeklyCheckIn.plan.readyCountMany', { count: includedCount });

  // Progress caption ties the bar to the weekly goal, counting new + already-
  // scheduled games together so "X of Y" matches the filled segments.
  const goalCaption = goalMet
    ? t('weeklyCheckIn.plan.weeklyGoalMet')
    : t('weeklyCheckIn.plan.goalProgress', { projected, goal });

  // Shown only when the player already has games this week — reconciles the bar
  // (which counts them) with the new-game headline (which doesn't).
  const committedNote =
    committed > 0
      ? committed === 1
        ? t('weeklyCheckIn.plan.committedNoteOne')
        : t('weeklyCheckIn.plan.committedNoteMany', { count: committed })
      : null;

  // Relative day label: "Today"/"Tomorrow" for the first two window dates,
  // otherwise the localized weekday name.
  const dayLabelFor = (matchDate: string): string => {
    if (todayDate && matchDate === todayDate) return t('common.time.today');
    if (tomorrowDate && matchDate === tomorrowDate) return t('common.time.tomorrow');
    return formatWeekdayName(matchDate, locale);
  };

  const hasProposals = proposals.length > 0;
  const ctaLabel =
    includedCount === 0 ? t('weeklyCheckIn.plan.ctaNone') : t('weeklyCheckIn.plan.cta');

  const handleOptOutChange = (enabled: boolean) => {
    void selectionHaptic();
    animateNext();
    setOptOut(!enabled);
  };

  const planContentReady = !isLoading && !error && plan != null;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.bubbleWrap}>
          <MascotBubble text={t('weeklyCheckIn.plan.bubble')} textKey="match-plan" />
        </View>

        {isLoading ? (
          <>
            <View style={styles.progressHeader}>
              <Skeleton
                width={180}
                height={13}
                borderRadius={4}
                backgroundColor={colors.skeletonBackground}
                highlightColor={colors.skeletonHighlight}
              />
            </View>
            <PlanProposalCardSkeleton />
            <PlanProposalCardSkeleton />
          </>
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
        ) : !hasProposals ? (
          <>
            {planContentReady && (
              <PlanOptOutToggle
                enabled={!optOut}
                onChange={handleOptOutChange}
                accentColor={linkColor}
                sportName={optOutSportName}
              />
            )}
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
          </>
        ) : (
          <>
            <View style={styles.progressHeader}>
              <Text style={[styles.readyCount, { color: colors.text }]}>{readyCountLabel}</Text>
              {goal > 0 && (
                <>
                  <GoalSegments
                    filled={Math.min(projected, goal)}
                    total={goal}
                    accent={linkColor}
                    track={colors.divider}
                  />
                  <Text
                    style={[styles.goalCaption, { color: goalMet ? linkColor : colors.textMuted }]}
                  >
                    {goalCaption}
                  </Text>
                  {committedNote && (
                    <Text style={[styles.committedNote, { color: colors.textMuted }]}>
                      {committedNote}
                    </Text>
                  )}
                </>
              )}
            </View>

            <PlanOptOutToggle
              enabled={!optOut}
              onChange={handleOptOutChange}
              accentColor={linkColor}
              sportName={optOutSportName}
            />

            {proposals.map(proposal => (
              <PlanProposalCard
                key={proposal.key}
                proposal={proposal}
                dayLabel={dayLabelFor(proposal.matchDate)}
                excluded={excludedProposalKeys.includes(proposal.key)}
                proposalsPaused={optOut}
                onToggle={() => toggleProposal(proposal.key)}
              />
            ))}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          rounded
          loading={isSubmitting}
          disabled={isSubmitting}
          onPress={onSubmit}
        >
          {ctaLabel}
        </Button>
      </View>
    </View>
  );
}

/**
 * Segmented goal bar — one segment per goal game, the first `filled` in accent.
 * Reads as simple progress toward the weekly goal.
 */
function GoalSegments({
  filled,
  total,
  accent,
  track,
}: {
  filled: number;
  total: number;
  accent: string;
  track: string;
}) {
  return (
    <View style={styles.segmentsRow}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.segment, { backgroundColor: i < filled ? accent : track }]} />
      ))}
    </View>
  );
}

/**
 * Master toggle for auto-creating games — sits above the proposal cards so
 * players see why per-game switches are disabled when auto-create is off.
 */
function PlanOptOutToggle({
  enabled,
  onChange,
  accentColor,
  sportName,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  accentColor: string;
  sportName: string;
}) {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();

  const cardBg = enabled
    ? isDark
      ? `${primary[400]}14`
      : `${primary[600]}0D`
    : isDark
      ? neutral[900]
      : neutral[100];
  const cardBorder = enabled
    ? isDark
      ? `${primary[400]}55`
      : `${primary[600]}33`
    : isDark
      ? `${neutral[500]}55`
      : `${neutral[400]}66`;
  const iconBg = enabled ? `${accentColor}22` : `${colors.textMuted}22`;

  return (
    <View
      style={[styles.optOutCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
      accessibilityRole="summary"
    >
      <View style={styles.optOutHeader}>
        <View style={[styles.optOutIconWrap, { backgroundColor: iconBg }]}>
          {enabled ? (
            <SportIcon sportName={sportName} size={18} color={accentColor} />
          ) : (
            <Ionicons name="hand-left-outline" size={18} color={colors.textMuted} />
          )}
        </View>
        <View style={styles.optOutCopy}>
          <Text style={[styles.optOutTitle, { color: colors.text }]}>
            {enabled ? t('weeklyCheckIn.plan.optOutTitle') : t('weeklyCheckIn.plan.optOutTitleOff')}
          </Text>
          <Text style={[styles.optOutDescription, { color: colors.textMuted }]}>
            {enabled
              ? t('weeklyCheckIn.plan.optOutDescription')
              : t('weeklyCheckIn.plan.optOutDescriptionOff')}
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onChange}
          trackColor={{ false: colors.border, true: accentColor }}
          thumbColor="#FFFFFF"
          ios_backgroundColor={colors.border}
          accessibilityLabel={
            enabled ? t('weeklyCheckIn.plan.optOutTitle') : t('weeklyCheckIn.plan.optOutTitleOff')
          }
        />
      </View>
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
  progressHeader: {
    paddingHorizontal: spacingPixels[5],
    marginBottom: spacingPixels[3],
    gap: spacingPixels[2],
  },
  readyCount: {
    fontSize: 16,
    fontWeight: '700',
  },
  segmentsRow: {
    flexDirection: 'row',
    gap: spacingPixels[1],
  },
  segment: {
    flex: 1,
    height: 5,
    borderRadius: radiusPixels.full,
    maxWidth: 48,
  },
  goalCaption: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  committedNote: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  optOutCard: {
    marginHorizontal: spacingPixels[5],
    marginBottom: spacingPixels[3],
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  optOutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  optOutIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optOutCopy: {
    flex: 1,
    gap: spacingPixels[1],
  },
  optOutTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  optOutDescription: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[6],
    paddingTop: spacingPixels[2],
  },
});
