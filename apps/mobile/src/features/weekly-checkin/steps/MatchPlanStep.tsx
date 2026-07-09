/**
 * Step 4 — Match plan (transparent preview → confirm).
 *
 * Replaces the old blind auto-create / auto-invite toggles. The player sees the
 * exact games the check-in would create from the availability they just
 * declared — sport, day, time, place, required level — and the named opponents
 * that would be invited to each. Everything is included by default; they can
 * remove whole games or individual invitees, then confirm. The CTA submits the
 * check-in, creating exactly the games they kept.
 *
 * Persuasion is structural: defaults maximize confirmation, removal is always
 * reversible, and a goal-progress header (count + segmented bar) reminds the
 * player how many games they still need. A quiet "don't propose games for me"
 * opt-out persists auto_create_matches = false for future check-ins.
 */
import React, { useMemo } from 'react';
import { LayoutAnimation, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Skeleton, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { primary, radiusPixels, spacingPixels } from '@rallia/design-system';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import {
  PlanProposalCard,
  PlanProposalCardSkeleton,
} from '#/features/weekly-checkin/components/PlanProposalCard';
import type { CheckInMatchPlan } from '#/features/weekly-checkin/api';
import { formatWeekdayName } from '#/features/weekly-checkin/window';
import { useTranslation } from '#/hooks';
import { useLocale } from '#/context';

const animateNext = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

interface MatchPlanStepProps {
  plan: CheckInMatchPlan | null;
  isLoading: boolean;
  error: boolean;
  excludedProposalKeys: string[];
  toggleProposal: (key: string) => void;
  excludedInviteesByProposal: Record<string, string[]>;
  toggleInvitee: (proposalKey: string, playerId: string) => void;
  optOut: boolean;
  setOptOut: (b: boolean) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
  onPlayerPress: (playerId: string, sportId: string) => void;
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
  excludedInviteesByProposal,
  toggleInvitee,
  optOut,
  setOptOut,
  isSubmitting,
  onSubmit,
  onPlayerPress,
  todayDate,
  tomorrowDate,
}: MatchPlanStepProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { colors, isDark } = useThemeStyles();
  const linkColor = isDark ? primary[400] : primary[600];
  const accentSoft = isDark ? `${primary[400]}1F` : `${primary[600]}14`;

  const proposals = useMemo(() => plan?.proposals ?? [], [plan]);
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

            {proposals.map(proposal => (
              <PlanProposalCard
                key={proposal.key}
                proposal={proposal}
                dayLabel={dayLabelFor(proposal.matchDate)}
                excluded={optOut || excludedProposalKeys.includes(proposal.key)}
                onToggle={() => toggleProposal(proposal.key)}
                excludedInvitees={excludedInviteesByProposal[proposal.key] ?? []}
                onToggleInvitee={pid => toggleInvitee(proposal.key, pid)}
                onPlayerPress={onPlayerPress}
              />
            ))}

            <TouchableOpacity
              style={styles.optOut}
              onPress={() => {
                animateNext();
                setOptOut(!optOut);
              }}
              accessibilityRole="button"
            >
              <Text style={[styles.optOutText, { color: colors.textMuted }]}>
                {optOut
                  ? t('weeklyCheckIn.plan.optOutActiveLink')
                  : t('weeklyCheckIn.plan.optOutLink')}
              </Text>
            </TouchableOpacity>
            {optOut && (
              <Text style={[styles.optOutNote, { color: colors.textMuted }]}>
                {t('weeklyCheckIn.plan.optOutNote')}
              </Text>
            )}
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
  optOut: {
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
    marginTop: spacingPixels[4],
    paddingVertical: spacingPixels[1],
  },
  optOutText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  optOutNote: {
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
    paddingHorizontal: spacingPixels[6],
    marginTop: spacingPixels[1],
  },
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[6],
    paddingTop: spacingPixels[2],
  },
});
