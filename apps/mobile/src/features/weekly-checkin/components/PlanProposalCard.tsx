/**
 * PlanProposalCard — one proposed game on the check-in's match-plan step.
 *
 * Styled to sit in the same visual family as the app-wide MatchCard: a
 * primary-tinted surface with a tinted hairline border and soft shadow, a faint
 * sport watermark, a bold time row, a coral required-level badge, and bordered
 * overlapping avatar "slots" for the invitees. On top of that shared language it
 * keeps the plan-only controls:
 *   • remove/undo the whole game (dims the content, keeps the control vivid)
 *   • expand the invitee list and remove/undo individual people
 * Tapping an invitee opens their profile over the wizard, same vetting
 * affordance as the "Games for you" step.
 */
import React, { useMemo, useState } from 'react';
import {
  Image,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Skeleton, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { TIER_CONFIGS } from '@rallia/shared-services';
import type { ReputationDisplay } from '@rallia/shared-services';
import { neutral, primary, radiusPixels, secondary, spacingPixels } from '@rallia/design-system';

import RatingBadge from '#/components/RatingBadge';
import ReputationBadge from '#/components/ReputationBadge';
import { RotatedCourtIcon } from '#/components/RotatedCourtIcon';
import { SportIcon } from '#/components/SportIcon';
import type { PlanInvitee, PlanProposal } from '#/features/weekly-checkin/api';
import { useTranslation } from '#/hooks';

// Enable LayoutAnimation on Android (same guard as TimeOfDaySection).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const AVATAR_STACK_MAX = 5;
const SLOT_SIZE = 32; // matches MatchCard's player-slot avatars
const WATERMARK_SIZE = 108;

const animateNext = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

// Rating labels are prefixed with the rating system's abbreviation ("NTRP 3.5",
// "DUPR 4.0", "UTR 8.0"). The invitee badge shows only the value — drop a
// leading known-system token; descriptive labels ("Advanced") pass through.
function ratingValueLabel(label: string | null): string | null {
  if (!label) return label;
  return label.replace(/^(?:NTRP|DUPR|UTR)\s+/i, '');
}

// Reputation is withheld unless the invitee's is public with enough events, so
// this returns undefined for unknown/hidden tiers and ReputationBadge renders
// nothing.
function buildReputationDisplay(invitee: PlanInvitee): ReputationDisplay | undefined {
  const tier = invitee.reputationTier as keyof typeof TIER_CONFIGS;
  if (!tier || tier === 'unknown') return undefined;
  const config = TIER_CONFIGS[tier];
  if (!config) return undefined;
  return {
    tier,
    score: invitee.reputationScore ?? 0,
    isVisible: true,
    tierLabel: config.label,
    tierColor: config.color,
    tierIcon: config.icon,
  };
}

interface PlanProposalCardProps {
  proposal: PlanProposal;
  /** Localized relative day label ("Today", "Tomorrow", "Friday"). */
  dayLabel: string;
  excluded: boolean;
  onToggle: () => void;
  excludedInvitees: string[];
  onToggleInvitee: (playerId: string) => void;
  onPlayerPress: (playerId: string, sportId: string) => void;
}

export function PlanProposalCard({
  proposal,
  dayLabel,
  excluded,
  onToggle,
  excludedInvitees,
  onToggleInvitee,
  onPlayerPress,
}: PlanProposalCardProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const [expanded, setExpanded] = useState(false);

  // MatchCard's "regular" tier palette, applied directly from design tokens so
  // the two cards read as siblings.
  const cardBg = isDark ? primary[950] : primary[50];
  const cardBorder = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  const accentColor = isDark ? primary[400] : primary[500];
  const avatarBorder = accentColor;
  const watermarkColor = isDark ? neutral[600] : neutral[400];
  const ratingColor = isDark ? secondary[400] : secondary[500];
  const ratingBg = `${ratingColor}${isDark ? '30' : '15'}`;
  const primaryBg = `${accentColor}${isDark ? '30' : '15'}`;

  // Toggled off reads as a disabled card: muted neutral surface + dimmed
  // content, while the toggle itself stays vivid so it's clearly re-enableable.
  const disabledBg = isDark ? neutral[900] : neutral[100];
  const disabledBorder = isDark ? `${neutral[500]}40` : `${neutral[400]}55`;
  const surfaceBg = excluded ? disabledBg : cardBg;
  const surfaceBorder = excluded ? disabledBorder : cardBorder;

  const sportLabel = proposal.sportName
    ? proposal.sportName.charAt(0).toUpperCase() + proposal.sportName.slice(1)
    : '';
  const timeLabel = `${proposal.startTime.slice(0, 5)}–${proposal.endTime.slice(0, 5)}`;
  const isTbd = proposal.locationType === 'tbd';

  // Match type the game will be created with. Mirrors the suggestion card: only
  // the decisive values get a chip ('both' is the neutral default → no chip).
  const matchTypeChip: { icon: keyof typeof Ionicons.glyphMap; label: string } | null =
    proposal.matchType === 'competitive'
      ? { icon: 'trophy', label: t('match.type.competitive') }
      : proposal.matchType === 'casual'
        ? { icon: 'happy', label: t('match.type.casual') }
        : null;

  const includedInvitees = useMemo(
    () => proposal.invitees.filter(i => !excludedInvitees.includes(i.playerId)),
    [proposal.invitees, excludedInvitees]
  );

  const showCourts = !isTbd && proposal.availableCourts > 0;

  const handleToggle = () => {
    animateNext();
    onToggle();
  };
  const handleExpand = () => {
    animateNext();
    setExpanded(v => !v);
  };

  return (
    <View style={[styles.card, { backgroundColor: surfaceBg, borderColor: surfaceBorder }]}>
      {/* Faint sport watermark — MatchCard's signature background texture,
          centered and clipped to the card (overflow: hidden) so it reads as a
          background wash behind the content rather than a corner cutout. */}
      <View style={styles.watermark} pointerEvents="none">
        <SportIcon
          sportName={proposal.sportName ?? 'tennis'}
          size={WATERMARK_SIZE}
          color={watermarkColor}
        />
      </View>

      <View style={styles.content}>
        {/* Header: sport kicker + bold time (MatchCard's time row). The toggle
            in the corner includes/excludes the game; ON by default. */}
        <View style={styles.headerRow}>
          <View style={[styles.headerText, excluded && styles.dim]}>
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
            value={!excluded}
            onValueChange={handleToggle}
            trackColor={{ false: colors.border, true: accentColor }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={colors.border}
            style={styles.toggle}
            accessibilityLabel={t('weeklyCheckIn.plan.includeGame')}
          />
        </View>

        {/* Location row (MatchCard's pin + name). */}
        <View style={[styles.locationRow, excluded && styles.dim]}>
          <Ionicons name="location" size={14} color={colors.textMuted} />
          <Text style={[styles.locationText, { color: colors.textMuted }]} numberOfLines={1}>
            {isTbd ? t('weeklyCheckIn.plan.locationTbd') : proposal.facilityName}
          </Text>
        </View>

        {/* Attribute chips mirroring MatchCard/the suggestion card: what the
            game becomes once created — required level and open courts (when
            known) lead, then singles + the caller's match type.
            Scrolls horizontally rather than wrapping to a second row. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          style={[styles.badgesScroll, excluded && styles.dim]}
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

        {excluded ? (
          <Text style={[styles.removedNote, { color: colors.textMuted }]}>
            {t('weeklyCheckIn.plan.removedLabel')}
          </Text>
        ) : isTbd ? (
          // A TBD game has no facility to match invitees against — it stays
          // publicly joinable but nobody is proactively invited.
          <>
            <View style={[styles.divider, { backgroundColor: cardBorder }]} />
            <Text style={[styles.tbdNote, { color: colors.textMuted }]}>
              {t('weeklyCheckIn.plan.tbdNoInvites')}
            </Text>
          </>
        ) : (
          <>
            <View style={[styles.divider, { backgroundColor: cardBorder }]} />

            {/* Invitee strip: MatchCard-style overlapping avatar slots + count,
                expandable to the full list. */}
            <TouchableOpacity
              style={styles.inviteeStrip}
              onPress={handleExpand}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t(
                expanded ? 'weeklyCheckIn.plan.hideInvitees' : 'weeklyCheckIn.plan.showInvitees'
              )}
            >
              <AvatarStack
                invitees={includedInvitees}
                cardBg={cardBg}
                avatarBorder={avatarBorder}
                colors={colors}
              />
              <Text style={[styles.inviteeCount, { color: colors.text }]}>
                {includedInvitees.length === 1
                  ? t('weeklyCheckIn.plan.inviteesLabelOne')
                  : t('weeklyCheckIn.plan.inviteesLabel', { count: includedInvitees.length })}
              </Text>
              {proposal.invitees.length > 0 && (
                <View style={[styles.chevronWrap, { backgroundColor: `${accentColor}1A` }]}>
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={accentColor}
                  />
                </View>
              )}
            </TouchableOpacity>

            {expanded && (
              <View style={styles.inviteeList}>
                {proposal.invitees.map(invitee => (
                  <InviteeRow
                    key={invitee.playerId}
                    invitee={invitee}
                    excluded={excludedInvitees.includes(invitee.playerId)}
                    onToggle={() => {
                      animateNext();
                      onToggleInvitee(invitee.playerId);
                    }}
                    onPress={() => onPlayerPress(invitee.playerId, proposal.sportId)}
                    colors={colors}
                    isDark={isDark}
                    accentColor={accentColor}
                    avatarBorder={avatarBorder}
                    cardBg={cardBg}
                    t={t}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

/** Loading placeholder — mirrors the card's real layout 1:1. */
export function PlanProposalCardSkeleton() {
  const { colors, isDark } = useThemeStyles();
  const cardBg = isDark ? primary[950] : primary[50];
  const cardBorder = isDark ? `${primary[400]}40` : `${primary[500]}20`;
  // Tinted skeleton shades for the primary-tinted card surface.
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
        <View style={[styles.divider, { backgroundColor: cardBorder }]} />
        <View style={styles.inviteeStrip}>
          <View style={styles.stack}>
            {[0, 1, 2].map(idx => (
              <View key={idx} style={idx > 0 ? styles.stackOverlap : undefined}>
                <Skeleton
                  width={SLOT_SIZE}
                  height={SLOT_SIZE}
                  circle
                  backgroundColor={bg}
                  highlightColor={hl}
                />
              </View>
            ))}
          </View>
          <Skeleton
            width={110}
            height={13}
            borderRadius={4}
            backgroundColor={bg}
            highlightColor={hl}
          />
        </View>
      </View>
    </View>
  );
}

function AvatarStack({
  invitees,
  cardBg,
  avatarBorder,
  colors,
}: {
  invitees: PlanInvitee[];
  cardBg: string;
  avatarBorder: string;
  colors: ReturnType<typeof useThemeStyles>['colors'];
}) {
  const shown = invitees.slice(0, AVATAR_STACK_MAX);
  const overflow = invitees.length - shown.length;
  if (invitees.length === 0) return null;
  return (
    <View style={styles.stack}>
      {shown.map((i, idx) => (
        <InviteeAvatar
          key={i.playerId}
          invitee={i}
          size={SLOT_SIZE}
          colors={colors}
          style={[
            styles.slotBorder,
            { borderColor: avatarBorder, shadowColor: avatarBorder },
            idx > 0 && styles.stackOverlap,
            { zIndex: shown.length - idx },
          ]}
        />
      ))}
      {overflow > 0 && (
        <View
          style={[
            styles.slot,
            styles.slotBorder,
            styles.stackOverlap,
            {
              backgroundColor: cardBg,
              borderColor: avatarBorder,
              shadowColor: avatarBorder,
              zIndex: 0,
            },
          ]}
        >
          <Text style={[styles.overflowText, { color: colors.text }]}>+{overflow}</Text>
        </View>
      )}
    </View>
  );
}

function InviteeAvatar({
  invitee,
  size,
  style,
  colors,
}: {
  invitee: PlanInvitee;
  size: number;
  style?: object | object[];
  colors: ReturnType<typeof useThemeStyles>['colors'];
}) {
  const url = getProfilePictureUrl(invitee.avatarUrl);
  const initial = (invitee.firstName || invitee.lastName || '?').charAt(0).toUpperCase();
  return (
    <View
      style={[
        styles.slot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.divider },
        style,
      ]}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <Text style={[styles.avatarInitial, { color: colors.textMuted }]}>{initial}</Text>
      )}
    </View>
  );
}

function InviteeRow({
  invitee,
  excluded,
  onToggle,
  onPress,
  colors,
  isDark,
  accentColor,
  avatarBorder,
  cardBg,
  t,
}: {
  invitee: PlanInvitee;
  excluded: boolean;
  onToggle: () => void;
  onPress: () => void;
  colors: ReturnType<typeof useThemeStyles>['colors'];
  isDark: boolean;
  accentColor: string;
  avatarBorder: string;
  cardBg: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const firstName = (invitee.firstName || invitee.lastName || '').trim();
  const reputationDisplay = buildReputationDisplay(invitee);
  return (
    <View style={styles.inviteeRow}>
      <TouchableOpacity
        style={[styles.inviteeRowMain, excluded && styles.dim]}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={firstName}
      >
        <InviteeAvatar
          invitee={invitee}
          size={SLOT_SIZE}
          colors={colors}
          style={[
            styles.slotBorder,
            { borderColor: avatarBorder, shadowColor: avatarBorder, backgroundColor: cardBg },
          ]}
        />
        <View style={styles.inviteeRowText}>
          <Text style={[styles.inviteeName, { color: colors.text }]} numberOfLines={1}>
            {firstName}
          </Text>
          <RatingBadge ratingLabel={ratingValueLabel(invitee.ratingLabel)} isDark={isDark} />
          <ReputationBadge reputationDisplay={reputationDisplay} isDark={isDark} />
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onToggle}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={t(
          excluded ? 'weeklyCheckIn.plan.undo' : 'weeklyCheckIn.plan.removeInvitee'
        )}
      >
        <Ionicons
          name={excluded ? 'arrow-undo-outline' : 'close-circle-outline'}
          size={20}
          color={excluded ? accentColor : colors.textMuted}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radiusPixels.xl,
    // Match MatchCard: 16px side margins so the plan step and the "Games for
    // you" step (which renders real MatchCards) line up.
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
  // Removed state dims the information, never the controls.
  dim: {
    opacity: 0.45,
  },
  // Centered background wash, filling the card and clipped by its rounded
  // corners (card overflow: hidden) — MatchCard's watermark treatment.
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
  // Trim the stock RN switch a touch so it sits neatly in the compact card.
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
  // Horizontal scroll instead of wrapping. flexGrow:0 keeps it hugging its
  // content height inside the card's column; the 2px vertical padding gives the
  // chips' soft shadow room so it isn't clipped by the scroll viewport.
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
  divider: {
    height: StyleSheet.hairlineWidth,
    marginTop: spacingPixels[3],
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
  inviteeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[3],
    gap: spacingPixels[2],
  },
  inviteeCount: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
  },
  chevronWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slot: {
    width: SLOT_SIZE,
    height: SLOT_SIZE,
    borderRadius: SLOT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // MatchCard's filled-slot treatment: 2px accent ring + soft matching shadow.
  slotBorder: {
    borderWidth: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  stackOverlap: {
    marginLeft: -8,
  },
  overflowText: {
    fontSize: 11,
    fontWeight: '700',
  },
  avatarInitial: {
    fontSize: 13,
    fontWeight: '700',
  },
  inviteeList: {
    marginTop: spacingPixels[1],
  },
  inviteeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[2.5],
    gap: spacingPixels[2],
  },
  inviteeRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2.5],
  },
  inviteeRowText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingPixels[1.5],
  },
  inviteeName: {
    fontSize: 13.5,
    fontWeight: '600',
    flexShrink: 1,
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
