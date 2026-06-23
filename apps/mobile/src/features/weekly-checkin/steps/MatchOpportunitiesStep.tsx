/**
 * Step 3 — "Games for you".
 *
 * Between availability and the auto-match pitch: real PUBLIC matches with open
 * spots that fit the availability the player just declared (same MatchCard used
 * across the app). The CTA is one-click — Join / Ask to join fires the join
 * directly, no MatchDetailSheet — and the card flips to a disabled
 * Joined/Requested state on success. The card body itself is inert here, but
 * tapping a participant avatar pushes that player's profile (PlayerProfile) over
 * the wizard so the player can vet who they'd be playing before joining.
 *
 * Optional step: joining is a bonus, the footer CTA always continues to the
 * auto-match step. When no matches fit, the wizard auto-skips this step, so the
 * empty state below is only a brief fallback while that resolves.
 */
import React, { useCallback } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, MatchCard, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { base, primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import type { MatchWithDetails } from '@rallia/shared-types';

import { MascotBubble } from '#/features/weekly-checkin/components/MascotBubble';
import type { JoinOutcome } from '#/features/weekly-checkin/useJoinOpportunity';
import { useTranslation, useNavigateToPlayerProfile } from '#/hooks';
import { useLocale } from '#/context';

interface MatchOpportunitiesStepProps {
  opportunities: MatchWithDetails[];
  isLoading: boolean;
  playerId: string | null;
  /** One-click join state, owned by the screen so the All-Set recap can read it. */
  join: (match: MatchWithDetails) => void;
  outcomes: Record<string, JoinOutcome>;
  pendingId: string | null;
  onContinue: () => void;
}

const NOOP = () => {};

export function MatchOpportunitiesStep({
  opportunities,
  isLoading,
  playerId,
  join,
  outcomes,
  pendingId,
  onContinue,
}: MatchOpportunitiesStepProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { colors, isDark } = useThemeStyles();
  const navigateToPlayerProfile = useNavigateToPlayerProfile();

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

  const isEmpty = !isLoading && opportunities.length === 0;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.bubbleWrap}>
          <MascotBubble text={t('weeklyCheckIn.opportunities.bubble')} textKey="opportunities" />
        </View>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isEmpty ? (
          <View style={styles.center}>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              {t('weeklyCheckIn.opportunities.empty')}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {opportunities.map(match => (
              <MatchCard
                key={match.id}
                match={match}
                isDark={isDark}
                t={t}
                locale={locale}
                currentPlayerId={playerId ?? undefined}
                onPress={NOOP}
                renderCta={renderCta}
                onPlayerPress={pid => navigateToPlayerProfile(pid, match.sport?.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button variant="primary" size="lg" fullWidth rounded onPress={onContinue}>
          {t('weeklyCheckIn.opportunities.cta')}
        </Button>
      </View>
    </View>
  );
}

interface OpportunityCtaProps {
  match: MatchWithDetails;
  outcome: JoinOutcome | undefined;
  isPending: boolean;
  isDark: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  onJoin: (match: MatchWithDetails) => void;
}

/** Replaces MatchCard's default footer with a one-click join button. */
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
  list: {
    // MatchCard supplies its own horizontal margin + bottom spacing.
  },
  center: {
    paddingHorizontal: spacingPixels[5],
    paddingVertical: spacingPixels[8],
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[6],
    paddingTop: spacingPixels[2],
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacingPixels[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'transparent',
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
});
