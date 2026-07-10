/**
 * PlanProposalCard — one proposed game on the check-in's match-plan step.
 *
 * Styled to sit in the same visual family as the app-wide MatchCard: a
 * primary-tinted surface with a tinted hairline border and soft shadow, a faint
 * sport watermark, a bold time row, a coral required-level badge, and attribute
 * chips. The player can include/exclude each proposed game before confirming.
 */
import React from 'react';
import {
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Skeleton, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { neutral, primary, radiusPixels, secondary, spacingPixels } from '@rallia/design-system';

import { RotatedCourtIcon } from '#/components/RotatedCourtIcon';
import { SportIcon } from '#/components/SportIcon';
import type { PlanProposal } from '#/features/weekly-checkin/api';
import { useTranslation } from '#/hooks';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const WATERMARK_SIZE = 108;

const animateNext = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

interface PlanProposalCardProps {
  proposal: PlanProposal;
  /** Localized relative day label ("Today", "Tomorrow", "Friday"). */
  dayLabel: string;
  excluded: boolean;
  /** Global opt-out — dims every card and disables per-game toggles. */
  proposalsPaused?: boolean;
  onToggle: () => void;
}

export function PlanProposalCard({
  proposal,
  dayLabel,
  excluded,
  proposalsPaused = false,
  onToggle,
}: PlanProposalCardProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();

  const cardBg = isDark ? primary[950] : primary[50];
  const cardBorder = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  const accentColor = isDark ? primary[400] : primary[500];
  const watermarkColor = isDark ? neutral[600] : neutral[400];
  const ratingColor = isDark ? secondary[400] : secondary[500];
  const ratingBg = `${ratingColor}${isDark ? '30' : '15'}`;
  const primaryBg = `${accentColor}${isDark ? '30' : '15'}`;

  const disabledBg = isDark ? neutral[900] : neutral[100];
  const disabledBorder = isDark ? `${neutral[500]}40` : `${neutral[400]}55`;
  const visuallyOff = proposalsPaused || excluded;
  const surfaceBg = visuallyOff ? disabledBg : cardBg;
  const surfaceBorder = visuallyOff ? disabledBorder : cardBorder;

  const sportLabel = proposal.sportName
    ? proposal.sportName.charAt(0).toUpperCase() + proposal.sportName.slice(1)
    : '';
  const timeLabel = `${proposal.startTime.slice(0, 5)}–${proposal.endTime.slice(0, 5)}`;
  const isTbd = proposal.locationType === 'tbd';

  const matchTypeChip: { icon: keyof typeof Ionicons.glyphMap; label: string } | null =
    proposal.matchType === 'competitive'
      ? { icon: 'trophy', label: t('match.type.competitive') }
      : proposal.matchType === 'casual'
        ? { icon: 'happy', label: t('match.type.casual') }
        : null;

  const showCourts = !isTbd && proposal.availableCourts > 0;

  const handleToggle = () => {
    if (proposalsPaused) return;
    animateNext();
    onToggle();
  };

  return (
    <View style={[styles.card, { backgroundColor: surfaceBg, borderColor: surfaceBorder }]}>
      <View style={styles.watermark} pointerEvents="none">
        <SportIcon
          sportName={proposal.sportName ?? 'tennis'}
          size={WATERMARK_SIZE}
          color={watermarkColor}
        />
      </View>

      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={[styles.headerText, visuallyOff && styles.dim]}>
            {!!sportLabel && (
              <Text style={[styles.eyebrow, { color: accentColor }]}>{sportLabel}</Text>
            )}
            <View style={styles.timeRow}>
              <Ionicons name="calendar-outline" size={15} color={accentColor} />
              <Text style={[styles.time, { color: colors.text }]} numberOfLines={1}>
                {dayLabel} · {timeLabel}
              </Text>
            </View>
          </View>
          <Switch
            value={proposalsPaused ? false : !excluded}
            onValueChange={handleToggle}
            disabled={proposalsPaused}
            trackColor={{ false: colors.border, true: accentColor }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={colors.border}
            style={styles.toggle}
            accessibilityLabel={t('weeklyCheckIn.plan.includeGame')}
          />
        </View>

        <View style={[styles.locationRow, visuallyOff && styles.dim]}>
          <Ionicons name="location" size={14} color={colors.textMuted} />
          <Text style={[styles.locationText, { color: colors.textMuted }]} numberOfLines={1}>
            {isTbd ? t('weeklyCheckIn.plan.locationTbd') : proposal.facilityName}
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          style={[styles.badgesScroll, visuallyOff && styles.dim]}
          contentContainerStyle={styles.badgesContent}
        >
          {proposal.minRatingLabel ? (
            <View style={[styles.badge, { backgroundColor: ratingBg }]}>
              <Ionicons name="analytics" size={10} color={ratingColor} style={styles.badgeIcon} />
              <Text style={[styles.badgeText, { color: ratingColor }]}>
                {proposal.minRatingLabel}
              </Text>
            </View>
          ) : null}
          {showCourts && (
            <View style={[styles.badge, { backgroundColor: primaryBg }]}>
              <RotatedCourtIcon size={12} color={accentColor} style={styles.badgeIcon} />
              <Text style={[styles.badgeText, { color: accentColor }]}>
                {t('match.courtStatus.courtsAvailable', { count: proposal.availableCourts })}
              </Text>
            </View>
          )}
          <View style={[styles.badge, { backgroundColor: primaryBg }]}>
            <Ionicons
              name="person-outline"
              size={10}
              color={accentColor}
              style={styles.badgeIcon}
            />
            <Text style={[styles.badgeText, { color: accentColor }]}>
              {t('match.format.singles')}
            </Text>
          </View>
          {matchTypeChip && (
            <View style={[styles.badge, { backgroundColor: primaryBg }]}>
              <Ionicons
                name={matchTypeChip.icon}
                size={10}
                color={accentColor}
                style={styles.badgeIcon}
              />
              <Text style={[styles.badgeText, { color: accentColor }]}>{matchTypeChip.label}</Text>
            </View>
          )}
        </ScrollView>

        {proposalsPaused ? (
          <Text style={[styles.removedNote, { color: colors.textMuted }]}>
            {t('weeklyCheckIn.plan.pausedLabel')}
          </Text>
        ) : excluded ? (
          <Text style={[styles.removedNote, { color: colors.textMuted }]}>
            {t('weeklyCheckIn.plan.removedLabel')}
          </Text>
        ) : (
          <>
            {!isTbd && (
              <View style={styles.compatibleRow}>
                <Ionicons name="people-outline" size={14} color={accentColor} />
                <Text style={[styles.compatibleText, { color: colors.text }]}>
                  {proposal.compatibleCount === 1
                    ? t('weeklyCheckIn.plan.compatibleCountOne')
                    : proposal.compatibleCount > 1
                      ? t('weeklyCheckIn.plan.compatibleCountMany', {
                          count: proposal.compatibleCount,
                        })
                      : t('weeklyCheckIn.plan.compatibleCountNone')}
                </Text>
              </View>
            )}
            {isTbd && (
              <Text style={[styles.tbdNote, { color: colors.textMuted }]}>
                {t('weeklyCheckIn.plan.tbdNote')}
              </Text>
            )}
          </>
        )}
      </View>
    </View>
  );
}

/** Loading placeholder — mirrors the card's real layout. */
export function PlanProposalCardSkeleton() {
  const { colors, isDark } = useThemeStyles();
  const cardBg = isDark ? primary[950] : primary[50];
  const cardBorder = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  const bg = colors.skeletonTintedBackground;
  const hl = colors.skeletonTintedHighlight;
  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Skeleton
              width={54}
              height={11}
              borderRadius={4}
              backgroundColor={bg}
              highlightColor={hl}
            />
            <View style={styles.skeletonTimeGap}>
              <Skeleton
                width={170}
                height={15}
                borderRadius={4}
                backgroundColor={bg}
                highlightColor={hl}
              />
            </View>
          </View>
          <Skeleton width={22} height={22} circle backgroundColor={bg} highlightColor={hl} />
        </View>
        <View style={styles.skeletonLocationGap}>
          <Skeleton
            width="60%"
            height={13}
            borderRadius={4}
            backgroundColor={bg}
            highlightColor={hl}
          />
        </View>
        <View style={styles.skeletonBadgeGap}>
          <Skeleton
            width={54}
            height={20}
            borderRadius={radiusPixels.full}
            backgroundColor={bg}
            highlightColor={hl}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radiusPixels.xl,
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 5,
  },
  dim: {
    opacity: 0.45,
  },
  watermark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.1,
    zIndex: 0,
  },
  content: {
    padding: spacingPixels[4],
    zIndex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[2],
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
  },
  time: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  toggle: {
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginTop: spacingPixels[2],
  },
  locationText: {
    fontSize: 13,
    flexShrink: 1,
  },
  badgesScroll: {
    marginTop: spacingPixels[2.5],
    flexGrow: 0,
  },
  badgesContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    paddingVertical: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  badgeIcon: {
    marginRight: spacingPixels[1],
  },
  badgeText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  removedNote: {
    fontSize: 12,
    marginTop: spacingPixels[2.5],
    fontStyle: 'italic',
  },
  tbdNote: {
    fontSize: 12,
    lineHeight: 16.5,
    marginTop: spacingPixels[2.5],
  },
  compatibleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    marginTop: spacingPixels[2.5],
  },
  compatibleText: {
    fontSize: 12.5,
    fontWeight: '600',
    flex: 1,
  },
  skeletonTimeGap: {
    marginTop: spacingPixels[1.5],
  },
  skeletonLocationGap: {
    marginTop: spacingPixels[2.5],
  },
  skeletonBadgeGap: {
    marginTop: spacingPixels[2.5],
  },
});
