/**
 * PlanProposalCard — one proposed game on the check-in's match-plan step.
 *
 * Shows exactly what would be created (sport, day, time, place, required
 * rating) and exactly who would be invited (named candidates, expandable).
 * Everything is included by default; the card exposes two levels of control:
 *   • remove/undo the whole game (dims the card, selection is reversible)
 *   • expand the invitee list and remove/undo individual people
 * Tapping an invitee row opens their profile over the wizard, same vetting
 * affordance as the "Games for you" step.
 */
import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { primary, radiusPixels, shadowsSemanticNative, spacingPixels } from '@rallia/design-system';

import type { PlanInvitee, PlanProposal } from '#/features/weekly-checkin/api';
import { useTranslation } from '#/hooks';

const AVATAR_STACK_MAX = 5;

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

  const accentColor = isDark ? primary[400] : primary[600];
  const sportLabel = proposal.sportName
    ? proposal.sportName.charAt(0).toUpperCase() + proposal.sportName.slice(1)
    : '';
  const timeLabel = `${proposal.startTime.slice(0, 5)}–${proposal.endTime.slice(0, 5)}`;
  const isTbd = proposal.locationType === 'tbd';

  const includedInvitees = useMemo(
    () => proposal.invitees.filter(i => !excludedInvitees.includes(i.playerId)),
    [proposal.invitees, excludedInvitees]
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.card }, excluded && styles.cardExcluded]}>
      {/* Header: sport + when, with the remove/undo affordance on the right. */}
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={[styles.sport, { color: colors.text }]}>{sportLabel}</Text>
          <Text style={[styles.when, { color: colors.textMuted }]}>
            {dayLabel} · {timeLabel}
          </Text>
        </View>
        {excluded ? (
          <TouchableOpacity
            style={[styles.undoPill, { borderColor: accentColor }]}
            onPress={onToggle}
            accessibilityRole="button"
            accessibilityLabel={t('weeklyCheckIn.plan.undo')}
          >
            <Ionicons name="arrow-undo-outline" size={13} color={accentColor} />
            <Text style={[styles.undoText, { color: accentColor }]}>
              {t('weeklyCheckIn.plan.undo')}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={onToggle}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('weeklyCheckIn.plan.removeGame')}
          >
            <Ionicons name="close-circle-outline" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Where + required level. */}
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="location-outline" size={13} color={colors.textMuted} />
          <Text style={[styles.metaText, { color: colors.textMuted }]} numberOfLines={1}>
            {isTbd ? t('weeklyCheckIn.plan.locationTbd') : proposal.facilityName}
          </Text>
        </View>
        {proposal.minRatingLabel ? (
          <View style={[styles.ratingChip, { backgroundColor: `${accentColor}1A` }]}>
            <Text style={[styles.ratingChipText, { color: accentColor }]}>
              {proposal.minRatingLabel}
            </Text>
          </View>
        ) : null}
      </View>

      {excluded ? (
        <Text style={[styles.removedNote, { color: colors.textMuted }]}>
          {t('weeklyCheckIn.plan.removedLabel')}
        </Text>
      ) : isTbd ? (
        // A TBD game has no facility to match invitees against — it stays
        // publicly joinable but nobody is proactively invited.
        <Text style={[styles.tbdNote, { color: colors.textMuted }]}>
          {t('weeklyCheckIn.plan.tbdNoInvites')}
        </Text>
      ) : (
        <>
          {/* Invitee strip: avatar stack + count, expandable to the full list. */}
          <TouchableOpacity
            style={styles.inviteeStrip}
            onPress={() => setExpanded(v => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t(
              expanded ? 'weeklyCheckIn.plan.hideInvitees' : 'weeklyCheckIn.plan.showInvitees'
            )}
          >
            <AvatarStack invitees={includedInvitees} colors={colors} />
            <Text style={[styles.inviteeCount, { color: colors.text }]}>
              {includedInvitees.length === 1
                ? t('weeklyCheckIn.plan.inviteesLabelOne')
                : t('weeklyCheckIn.plan.inviteesLabel', { count: includedInvitees.length })}
            </Text>
            {proposal.invitees.length > 0 && (
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            )}
          </TouchableOpacity>

          {expanded &&
            proposal.invitees.map(invitee => (
              <InviteeRow
                key={invitee.playerId}
                invitee={invitee}
                excluded={excludedInvitees.includes(invitee.playerId)}
                onToggle={() => onToggleInvitee(invitee.playerId)}
                onPress={() => onPlayerPress(invitee.playerId, proposal.sportId)}
                colors={colors}
                accentColor={accentColor}
                t={t}
              />
            ))}
        </>
      )}
    </View>
  );
}

function AvatarStack({
  invitees,
  colors,
}: {
  invitees: PlanInvitee[];
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
          size={28}
          style={idx > 0 ? styles.stackOverlap : undefined}
          colors={colors}
        />
      ))}
      {overflow > 0 && (
        <View
          style={[
            styles.stackAvatar,
            styles.stackOverlap,
            styles.stackOverflow,
            { backgroundColor: colors.divider },
          ]}
        >
          <Text style={[styles.stackOverflowText, { color: colors.text }]}>+{overflow}</Text>
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
  style?: object;
  colors: ReturnType<typeof useThemeStyles>['colors'];
}) {
  const url = getProfilePictureUrl(invitee.avatarUrl);
  const initial = (invitee.firstName || invitee.lastName || '?').charAt(0).toUpperCase();
  return (
    <View
      style={[
        styles.stackAvatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.divider },
        style,
      ]}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          style={{ width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 }}
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
  accentColor,
  t,
}: {
  invitee: PlanInvitee;
  excluded: boolean;
  onToggle: () => void;
  onPress: () => void;
  colors: ReturnType<typeof useThemeStyles>['colors'];
  accentColor: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const name = `${invitee.firstName} ${invitee.lastName}`.trim();
  return (
    <View style={[styles.inviteeRow, excluded && styles.inviteeRowExcluded]}>
      <TouchableOpacity
        style={styles.inviteeRowMain}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={name}
      >
        <InviteeAvatar invitee={invitee} size={32} colors={colors} />
        <View style={styles.inviteeRowText}>
          <Text style={[styles.inviteeName, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          {invitee.ratingLabel ? (
            <Text style={[styles.inviteeRating, { color: colors.textMuted }]}>
              {invitee.ratingLabel}
            </Text>
          ) : null}
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
    paddingVertical: spacingPixels[3.5],
    paddingHorizontal: spacingPixels[4],
    marginHorizontal: spacingPixels[1],
    marginBottom: spacingPixels[3],
    ...shadowsSemanticNative.card,
  },
  cardExcluded: {
    opacity: 0.55,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacingPixels[2],
  },
  headerText: {
    flex: 1,
  },
  sport: {
    fontSize: 15,
    fontWeight: '700',
  },
  when: {
    fontSize: 13,
    marginTop: 1,
  },
  undoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    borderWidth: 1.5,
    borderRadius: radiusPixels.lg,
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
  },
  undoText: {
    fontSize: 12,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    flexShrink: 1,
  },
  metaText: {
    fontSize: 12.5,
    flexShrink: 1,
  },
  ratingChip: {
    borderRadius: radiusPixels.md,
    paddingHorizontal: spacingPixels[2],
    paddingVertical: 2,
  },
  ratingChipText: {
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
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stackOverlap: {
    marginLeft: -8,
  },
  stackOverflow: {
    zIndex: -1,
  },
  stackOverflowText: {
    fontSize: 10,
    fontWeight: '700',
  },
  avatarInitial: {
    fontSize: 12,
    fontWeight: '700',
  },
  inviteeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[2.5],
    gap: spacingPixels[2],
  },
  inviteeRowExcluded: {
    opacity: 0.45,
  },
  inviteeRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2.5],
  },
  inviteeRowText: {
    flex: 1,
  },
  inviteeName: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  inviteeRating: {
    fontSize: 11.5,
    marginTop: 1,
  },
});
