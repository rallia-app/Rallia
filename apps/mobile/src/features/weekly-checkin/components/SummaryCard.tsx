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
}

export function SummaryCard({
  frequencyGoal,
  hoursConfirmed,
  autoCreate,
  autoInvite,
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

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <SummaryRow
        icon="trophy"
        text={freqText}
        colors={colors}
        iconBubbleBg={iconBubbleBg}
        iconColor={iconColor}
      />
      <SummaryRow
        icon="calendar"
        text={slotsText}
        colors={colors}
        iconBubbleBg={iconBubbleBg}
        iconColor={iconColor}
        isLast={
          !(WEEKLY_CHECKIN_AUTO_CREATE_TOGGLE_ENABLED && autoCreate) &&
          !(WEEKLY_CHECKIN_AUTO_INVITE_TOGGLE_ENABLED && autoInvite)
        }
      />
      {WEEKLY_CHECKIN_AUTO_CREATE_TOGGLE_ENABLED && autoCreate && (
        <SummaryRow
          icon="add-circle"
          text={t('weeklyCheckIn.step4.summaryAutoCreate')}
          colors={colors}
          iconBubbleBg={iconBubbleBg}
          iconColor={iconColor}
          isLast={!(WEEKLY_CHECKIN_AUTO_INVITE_TOGGLE_ENABLED && autoInvite)}
        />
      )}
      {WEEKLY_CHECKIN_AUTO_INVITE_TOGGLE_ENABLED && autoInvite && (
        <SummaryRow
          icon="people"
          text={t('weeklyCheckIn.step4.summaryAutoInvite')}
          colors={colors}
          iconBubbleBg={iconBubbleBg}
          iconColor={iconColor}
          isLast
        />
      )}
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
