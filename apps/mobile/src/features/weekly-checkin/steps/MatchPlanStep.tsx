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
 * reversible, and a goal-progress line reminds the player how many games they
 * still need. A quiet "don't propose games for me" opt-out persists
 * auto_create_matches = false for future check-ins.
 */
import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { primary, spacingPixels } from '@rallia/design-system';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import { PlanProposalCard } from '#/features/weekly-checkin/components/PlanProposalCard';
import type { CheckInMatchPlan } from '#/features/weekly-checkin/api';
import { formatWeekdayName } from '#/features/weekly-checkin/window';
import { useTranslation } from '#/hooks';
import { useLocale } from '#/context';

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

  const proposals = plan?.proposals ?? [];
  const includedCount = useMemo(
    () => (optOut ? 0 : proposals.filter(p => !excludedProposalKeys.includes(p.key)).length),
    [proposals, excludedProposalKeys, optOut]
  );

  const goal = plan?.goal ?? 0;
  const committed = plan?.committedCount ?? 0;
  const projected = committed + includedCount;
  const belowGoal = projected < goal;

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
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          // Preview failed → the wizard submits plan:null (legacy autonomous
          // generation), so reassure rather than dead-end.
          <View style={styles.center}>
            <Text style={[styles.fallbackText, { color: colors.textMuted }]}>
              {t('weeklyCheckIn.plan.errorFallback')}
            </Text>
          </View>
        ) : !hasProposals ? (
          <View style={styles.center}>
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
            <Text style={[styles.progress, { color: colors.textMuted }]}>
              {t('weeklyCheckIn.plan.goalProgress', { count: includedCount, goal })}
            </Text>

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

            {belowGoal && !optOut && (
              <Text style={[styles.warning, { color: colors.textMuted }]}>
                {t('weeklyCheckIn.plan.goalWarning', { count: projected, goal })}
              </Text>
            )}

            <TouchableOpacity
              style={styles.optOut}
              onPress={() => setOptOut(!optOut)}
              accessibilityRole="button"
            >
              <Text style={[styles.optOutText, { color: linkColor }]}>
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
  progress: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: spacingPixels[5],
    marginBottom: spacingPixels[3],
  },
  warning: {
    fontSize: 12.5,
    lineHeight: 17,
    paddingHorizontal: spacingPixels[5],
    marginTop: spacingPixels[1],
  },
  optOut: {
    alignItems: 'center',
    paddingHorizontal: spacingPixels[5],
    marginTop: spacingPixels[4],
    paddingVertical: spacingPixels[1],
  },
  optOutText: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
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
