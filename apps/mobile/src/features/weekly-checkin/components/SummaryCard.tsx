/**
 * SummaryCard — Step 4 success recap.
 *
 * A clean recap of what the check-in just locked in: weekly goal, hours
 * confirmed, and the auto-create / auto-invite toggles. No streak hero — the
 * streak is driven by hitting your weekly GAME goal (evaluated at week-end),
 * not by completing the check-in, so the success screen no longer claims to
 * have moved it. The current streak lives on step 1's StreakCard.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { primary, radiusPixels, spacingPixels, shadowsSemanticNative } from '@rallia/design-system';

import { useTranslation } from '#/hooks';
import {
  WEEKLY_CHECKIN_AUTO_CREATE_TOGGLE_ENABLED,
  WEEKLY_CHECKIN_AUTO_INVITE_TOGGLE_ENABLED,
} from '#/features/weekly-checkin/featureFlag';

interface SummaryCardProps {
  frequencyGoal: number;
  hoursConfirmed: number;
  autoCreate: boolean;
  autoInvite: boolean;
  /** Games joined directly on the "Games for you" step. */
  joinedCount: number;
  /** Games the player asked to join (request-mode) on that step. */
  requestedCount: number;
}

export function SummaryCard({
  frequencyGoal,
  hoursConfirmed,
  autoCreate,
  autoInvite,
  joinedCount,
  requestedCount,
}: SummaryCardProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const iconBubbleBg = isDark ? `${primary[700]}33` : primary[100];
  // Bright primary tint in dark mode so the icon doesn't blend into the
  // translucent primary[700] bubble underneath.
  const iconColor = isDark ? primary[300] : primary[700];

  const freqText = t('weeklyCheckIn.step4.summaryGoal', {
    freq: `${frequencyGoal}${frequencyGoal === 5 ? '+' : ''}× sessions`,
  });
  const slotsText =
    hoursConfirmed === 1
      ? t('weeklyCheckIn.step4.summarySlotsOne')
      : t('weeklyCheckIn.step4.summarySlots', { count: hoursConfirmed });

  // Build the recap rows in order, then flag the last so only it drops its
  // divider. The "games joined / asked to join" rows recap what happened on the
  // "Games for you" step and only show when the player acted there.
  const rows: Array<{ key: string; icon: keyof typeof Ionicons.glyphMap; text: string }> = [
    { key: 'goal', icon: 'trophy', text: freqText },
    { key: 'slots', icon: 'calendar', text: slotsText },
  ];
  if (joinedCount > 0) {
    rows.push({
      key: 'joined',
      icon: 'checkmark-circle',
      text:
        joinedCount === 1
          ? t('weeklyCheckIn.step4.summaryJoinedOne')
          : t('weeklyCheckIn.step4.summaryJoined', { count: joinedCount }),
    });
  }
  if (requestedCount > 0) {
    rows.push({
      key: 'requested',
      icon: 'hand-left',
      text:
        requestedCount === 1
          ? t('weeklyCheckIn.step4.summaryRequestedOne')
          : t('weeklyCheckIn.step4.summaryRequested', { count: requestedCount }),
    });
  }
  if (WEEKLY_CHECKIN_AUTO_CREATE_TOGGLE_ENABLED && autoCreate) {
    rows.push({
      key: 'autoCreate',
      icon: 'add-circle',
      text: t('weeklyCheckIn.step4.summaryAutoCreate'),
    });
  }
  if (WEEKLY_CHECKIN_AUTO_INVITE_TOGGLE_ENABLED && autoInvite) {
    rows.push({
      key: 'autoInvite',
      icon: 'people',
      text: t('weeklyCheckIn.step4.summaryAutoInvite'),
    });
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      {rows.map((row, i) => (
        <SummaryRow
          key={row.key}
          icon={row.icon}
          text={row.text}
          colors={colors}
          iconBubbleBg={iconBubbleBg}
          iconColor={iconColor}
          isLast={i === rows.length - 1}
        />
      ))}
    </View>
  );
}

function SummaryRow({
  icon,
  text,
  colors,
  iconBubbleBg,
  iconColor,
  isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  colors: ReturnType<typeof useThemeStyles>['colors'];
  iconBubbleBg: string;
  iconColor: string;
  isLast?: boolean;
}) {
  return (
    <View
      style={[styles.row, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.divider }]}
    >
      <View style={[styles.iconBubble, { backgroundColor: iconBubbleBg }]}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <Text style={[styles.rowText, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radiusPixels.xl,
    paddingVertical: spacingPixels[4],
    paddingHorizontal: spacingPixels[5],
    marginHorizontal: spacingPixels[1],
    marginBottom: spacingPixels[3],
    ...shadowsSemanticNative.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    paddingVertical: spacingPixels[2.5],
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
});
