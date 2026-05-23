/**
 * SummaryCard — Step 4 success card.
 *
 * The streak hero animates from null → newStreak via a one-shot spring bump
 * on mount (scale 0.6 → 1.25 → 1.0). The hero microcopy flexes between the
 * regular "+1" extension and the milestone "+1 freeze earned ❄️" message.
 *
 * Below the hero, a thin divider + 4 summary rows recap the wizard's inputs.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import {
  accent,
  primary,
  radiusPixels,
  spacingPixels,
  shadowsSemanticNative,
} from '@rallia/design-system';
import { useTranslation } from '../../../hooks';

interface SummaryCardProps {
  newStreak: number;
  milestoneReached: boolean;
  frequencyGoal: number;
  hoursConfirmed: number;
  autoCreate: boolean;
  autoInvite: boolean;
}

export function SummaryCard({
  newStreak,
  milestoneReached,
  frequencyGoal,
  hoursConfirmed,
  autoCreate,
  autoInvite,
}: SummaryCardProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();
  const scaleAnim = useRef(new Animated.Value(0.6)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const heroColor = isDark ? accent[300] : accent[700];
  const heroSubColor = isDark ? accent[400] : accent[500];
  const iconBubbleBg = isDark ? `${primary[700]}33` : primary[100];
  // Bright primary tint in dark mode so the icon doesn't blend into the
  // translucent primary[700] bubble underneath.
  const iconColor = isDark ? primary[300] : primary[700];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.25,
          duration: 400,
          easing: Easing.out(Easing.back(2)),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [scaleAnim, opacityAnim]);

  const heroTitle =
    newStreak === 1
      ? t('weeklyCheckIn.step4.streakHeroCountOne')
      : t('weeklyCheckIn.step4.streakHeroCount', { count: newStreak });

  const heroSub = milestoneReached
    ? t('weeklyCheckIn.step4.streakHeroSubMilestone')
    : t('weeklyCheckIn.step4.streakHeroSub');

  const freqText = t('weeklyCheckIn.step4.summaryGoal', {
    freq: `${frequencyGoal}${frequencyGoal === 5 ? '+' : ''}× sessions`,
  });
  const slotsText =
    hoursConfirmed === 1
      ? t('weeklyCheckIn.step4.summarySlotsOne')
      : t('weeklyCheckIn.step4.summarySlots', { count: hoursConfirmed });

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={[styles.hero, { borderBottomColor: colors.divider }]}>
        <Animated.Text style={[styles.heroFire, { opacity: opacityAnim }]}>🔥</Animated.Text>
        <View>
          <Animated.Text
            style={[
              styles.heroNum,
              { color: heroColor, transform: [{ scale: scaleAnim }], opacity: opacityAnim },
            ]}
          >
            {heroTitle}
          </Animated.Text>
          <Text style={[styles.heroSub, { color: heroSubColor }]}>{heroSub}</Text>
        </View>
      </View>

      <SummaryRow
        icon="trophy"
        text={freqText}
        colors={colors}
        iconBubbleBg={iconBubbleBg}
        iconColor={iconColor}
        isLast={!autoCreate && !autoInvite && false}
      />
      <SummaryRow
        icon="calendar"
        text={slotsText}
        colors={colors}
        iconBubbleBg={iconBubbleBg}
        iconColor={iconColor}
        isLast={!autoCreate && !autoInvite}
      />
      {autoCreate && (
        <SummaryRow
          icon="add-circle"
          text={t('weeklyCheckIn.step4.summaryAutoCreate')}
          colors={colors}
          iconBubbleBg={iconBubbleBg}
          iconColor={iconColor}
          isLast={!autoInvite}
        />
      )}
      {autoInvite && (
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
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[3],
    paddingBottom: spacingPixels[3],
    borderBottomWidth: 1,
    marginBottom: spacingPixels[2],
  },
  heroFire: {
    fontSize: 36,
    lineHeight: 40,
  },
  heroNum: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 24,
  },
  heroSub: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 2,
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
