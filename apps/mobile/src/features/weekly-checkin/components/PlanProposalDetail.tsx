/**
 * PlanProposalDetail — one proposed game on the check-in's match-plan deck.
 *
 * Deliberately NOT a card: the proposal renders as an open, full-height
 * spotlight directly on the wizard's gradient — big day/time typography, the
 * place, a light row of attribute chips, then the invite picker breathing in
 * the remaining space. One suggestion owns the whole screen, so the deck reads
 * as "consider THIS game" rather than an entry in a list. The deck's Skip /
 * Create actions live in the step's footer, not here.
 *
 * Invite picker: the top candidates for the slot, each toggleable — only the
 * players left selected get invited when the game is confirmed.
 */
import React, { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Skeleton, Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { getTierConfig } from '@rallia/shared-services';
import type { ReputationDisplay, ReputationTier } from '@rallia/shared-services';
import { neutral, primary, radiusPixels, secondary, spacingPixels } from '@rallia/design-system';

import RatingBadge from '#/components/RatingBadge';
import ReputationBadge from '#/components/ReputationBadge';
import { RotatedCourtIcon } from '#/components/RotatedCourtIcon';
import { SportIcon } from '#/components/SportIcon';
import {
  MAX_PLAN_INVITEES_SHOWN,
  type PlanInvitee,
  type PlanProposal,
} from '#/features/weekly-checkin/api';
import { useTranslation, useNavigateToPlayerProfile } from '#/hooks';
import { getAvatarColor, getContactInitials } from '#/utils/contactDisplay';

const WATERMARK_SIZE = 180;
const AVATAR_SIZE = 40;

interface PlanProposalDetailProps {
  proposal: PlanProposal;
  /** Localized relative day label ("Today", "Tomorrow", "Friday"). */
  dayLabel: string;
  /** Invitee ids currently kept for this proposal. */
  selectedInviteeIds: string[];
  onToggleInvitee: (playerId: string) => void;
}

export function PlanProposalDetail({
  proposal,
  dayLabel,
  selectedInviteeIds,
  onToggleInvitee,
}: PlanProposalDetailProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const navigateToPlayerProfile = useNavigateToPlayerProfile();

  const accentColor = isDark ? primary[400] : primary[600];
  const watermarkColor = isDark ? neutral[600] : neutral[400];
  const ratingColor = isDark ? secondary[400] : secondary[500];
  const ratingBg = `${ratingColor}${isDark ? '30' : '15'}`;
  const chipBg = `${accentColor}${isDark ? '26' : '12'}`;

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
  const shownInvitees = proposal.invitees.slice(0, MAX_PLAN_INVITEES_SHOWN);
  const selectedCount = shownInvitees.filter(i => selectedInviteeIds.includes(i.playerId)).length;

  return (
    <View style={styles.root}>
      {/* Faint sport glyph anchored behind the headline, top-right. */}
      <View style={styles.watermark} pointerEvents="none">
        <SportIcon
          sportName={proposal.sportName ?? 'tennis'}
          size={WATERMARK_SIZE}
          color={watermarkColor}
        />
      </View>

      {!!sportLabel && (
        <View style={styles.sportRow}>
          <SportIcon sportName={proposal.sportName ?? 'tennis'} size={15} color={accentColor} />
          <Text style={[styles.eyebrow, { color: accentColor }]}>{sportLabel}</Text>
        </View>
      )}

      <Text style={[styles.day, { color: colors.text }]}>{dayLabel}</Text>
      <Text style={[styles.time, { color: accentColor }]}>{timeLabel}</Text>

      <View style={styles.locationRow}>
        <Ionicons name="location" size={15} color={colors.textMuted} />
        <Text style={[styles.locationText, { color: colors.textMuted }]} numberOfLines={1}>
          {isTbd ? t('weeklyCheckIn.plan.locationTbd') : proposal.facilityName}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        style={styles.badgesScroll}
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
          <View style={[styles.badge, { backgroundColor: chipBg }]}>
            <RotatedCourtIcon size={12} color={accentColor} style={styles.badgeIcon} />
            <Text style={[styles.badgeText, { color: accentColor }]}>
              {t('match.courtStatus.courtsAvailable', { count: proposal.availableCourts })}
            </Text>
          </View>
        )}
        <View style={[styles.badge, { backgroundColor: chipBg }]}>
          <Ionicons name="person-outline" size={10} color={accentColor} style={styles.badgeIcon} />
          <Text style={[styles.badgeText, { color: accentColor }]}>
            {t('match.format.singles')}
          </Text>
        </View>
        {matchTypeChip && (
          <View style={[styles.badge, { backgroundColor: chipBg }]}>
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

      {isTbd ? (
        <Text style={[styles.tbdNote, { color: colors.textMuted }]}>
          {t('weeklyCheckIn.plan.tbdNote')}
        </Text>
      ) : shownInvitees.length === 0 ? (
        <Text style={[styles.tbdNote, { color: colors.textMuted }]}>
          {t('weeklyCheckIn.plan.compatibleCountNone')}
        </Text>
      ) : (
        <View style={styles.inviteSection}>
          <View style={styles.inviteHeaderRow}>
            <Text style={[styles.inviteHeader, { color: colors.text }]}>
              {t('weeklyCheckIn.plan.inviteHeader')}
            </Text>
            <Text style={[styles.inviteCount, { color: accentColor }]}>
              {t('weeklyCheckIn.plan.inviteSelectedCount', { count: selectedCount })}
            </Text>
          </View>
          {shownInvitees.map(invitee => (
            <InviteeRow
              key={invitee.playerId}
              invitee={invitee}
              selected={selectedInviteeIds.includes(invitee.playerId)}
              accentColor={accentColor}
              onToggle={() => onToggleInvitee(invitee.playerId)}
              onOpenProfile={() => navigateToPlayerProfile(invitee.playerId, proposal.sportId)}
            />
          ))}
          <Text style={[styles.inviteNote, { color: colors.textMuted }]}>
            {t('weeklyCheckIn.plan.inviteNote')}
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * One toggleable invite candidate: avatar (tap → profile), name, rating,
 * reputation badge when public, selection check. The row toggles selection;
 * the avatar is its own press target so the player can vet who they're
 * inviting before deciding.
 */
function InviteeRow({
  invitee,
  selected,
  accentColor,
  onToggle,
  onOpenProfile,
}: {
  invitee: PlanInvitee;
  selected: boolean;
  accentColor: string;
  onToggle: () => void;
  onOpenProfile: () => void;
}) {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();

  const fullName = `${invitee.firstName} ${invitee.lastName}`.trim();
  const displayName = invitee.lastName
    ? `${invitee.firstName} ${invitee.lastName.charAt(0).toUpperCase()}.`
    : invitee.firstName;
  const avatarUri = getProfilePictureUrl(invitee.avatarUrl);

  // Selected rows read as lit-up mini cards: accent tint + border + avatar
  // ring; unselected rows stay quiet behind a hairline outline, slightly dimmed.
  const selectedBg = `${accentColor}${isDark ? '24' : '12'}`;
  const selectedBorder = `${accentColor}${isDark ? '66' : '4D'}`;
  const idleBorder = isDark ? `${neutral[500]}40` : `${neutral[400]}4D`;

  // The RPC withholds reputation (tier 'unknown', score null) unless the
  // candidate's reputation is public with enough events — badge only when real.
  const reputationDisplay = useMemo<ReputationDisplay | undefined>(() => {
    const tier = invitee.reputationTier as ReputationTier | null;
    if (!tier || tier === 'unknown') return undefined;
    const cfg = getTierConfig(tier);
    return {
      tier,
      score: invitee.reputationScore ?? 100,
      isVisible: true,
      tierLabel: cfg.label,
      tierColor: cfg.color,
      tierIcon: cfg.icon,
    };
  }, [invitee.reputationTier, invitee.reputationScore]);

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.inviteeRow,
        {
          backgroundColor: selected ? selectedBg : 'transparent',
          borderColor: selected ? selectedBorder : idleBorder,
          shadowColor: accentColor,
          shadowOpacity: selected && !isDark ? 0.16 : 0,
        },
        pressed && styles.inviteePressed,
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={fullName || t('weeklyCheckIn.plan.inviteHeader')}
    >
      <View style={[styles.inviteeMain, !selected && styles.inviteeDim]}>
        <Pressable
          onPress={onOpenProfile}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={fullName}
          style={[styles.avatarRing, { borderColor: selected ? accentColor : 'transparent' }]}
        >
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: getAvatarColor(fullName) }]}>
              <Text style={styles.avatarInitials}>{getContactInitials(fullName)}</Text>
            </View>
          )}
        </Pressable>
        <View style={styles.inviteeText}>
          <Text style={[styles.inviteeName, { color: colors.text }]} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={styles.inviteeMetaRow}>
            {invitee.ratingLabel ? (
              <RatingBadge ratingLabel={invitee.ratingLabel} isDark={isDark} size="sm" />
            ) : null}
            {reputationDisplay && (
              <ReputationBadge reputationDisplay={reputationDisplay} isDark={isDark} size="sm" />
            )}
          </View>
        </View>
      </View>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={24}
        color={selected ? accentColor : colors.textMuted}
      />
    </Pressable>
  );
}

/** Loading placeholder — mirrors the spotlight's real layout. */
export function PlanProposalDetailSkeleton() {
  const { colors } = useThemeStyles();
  const bg = colors.skeletonBackground;
  const hl = colors.skeletonHighlight;
  return (
    <View style={styles.root}>
      <Skeleton width={80} height={12} borderRadius={4} backgroundColor={bg} highlightColor={hl} />
      <View style={styles.skeletonDayGap}>
        <Skeleton
          width={180}
          height={30}
          borderRadius={6}
          backgroundColor={bg}
          highlightColor={hl}
        />
      </View>
      <View style={styles.skeletonTimeGap}>
        <Skeleton
          width={130}
          height={20}
          borderRadius={5}
          backgroundColor={bg}
          highlightColor={hl}
        />
      </View>
      <View style={styles.skeletonLocationGap}>
        <Skeleton
          width="55%"
          height={14}
          borderRadius={4}
          backgroundColor={bg}
          highlightColor={hl}
        />
      </View>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={styles.skeletonInviteeGap}>
          <Skeleton
            width={AVATAR_SIZE}
            height={AVATAR_SIZE}
            circle
            backgroundColor={bg}
            highlightColor={hl}
          />
          <Skeleton
            width={140}
            height={14}
            borderRadius={4}
            backgroundColor={bg}
            highlightColor={hl}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: spacingPixels[5],
  },
  watermark: {
    position: 'absolute',
    top: -spacingPixels[4],
    right: -spacingPixels[6],
    opacity: 0.07,
  },
  sportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    marginBottom: spacingPixels[1.5],
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  day: {
    fontSize: 32,
    // The shared Text component derives lineHeight from its default body size
    // (24) even when fontSize comes in via style — set it explicitly or the
    // 32pt ascenders get clipped at the top.
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  time: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    marginTop: spacingPixels[0.5],
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginTop: spacingPixels[2],
  },
  locationText: {
    fontSize: 14,
    flexShrink: 1,
  },
  badgesScroll: {
    marginTop: spacingPixels[3],
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
  },
  badgeIcon: {
    marginRight: spacingPixels[1],
  },
  badgeText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  tbdNote: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacingPixels[4],
  },
  inviteSection: {
    marginTop: spacingPixels[4],
    flex: 1,
  },
  inviteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[2],
  },
  inviteHeader: {
    fontSize: 14,
    fontWeight: '700',
  },
  inviteCount: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  inviteeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    borderWidth: 1.2,
    marginBottom: spacingPixels[1.5],
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  inviteePressed: {
    opacity: 0.7,
  },
  inviteeMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2.5],
    flex: 1,
    marginRight: spacingPixels[2],
  },
  inviteeDim: {
    opacity: 0.55,
  },
  avatarRing: {
    width: AVATAR_SIZE + 8,
    height: AVATAR_SIZE + 8,
    borderRadius: (AVATAR_SIZE + 8) / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  inviteeText: {
    flexShrink: 1,
  },
  inviteeName: {
    fontSize: 15,
    fontWeight: '600',
  },
  inviteeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    marginTop: spacingPixels[1],
  },
  inviteNote: {
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: spacingPixels[2],
  },
  skeletonDayGap: {
    marginTop: spacingPixels[2],
  },
  skeletonTimeGap: {
    marginTop: spacingPixels[1.5],
  },
  skeletonLocationGap: {
    marginTop: spacingPixels[2.5],
  },
  skeletonInviteeGap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    marginTop: spacingPixels[3],
  },
});
