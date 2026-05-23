/**
 * FrequencyPills — Step 3 frequency goal picker (1× / 2× / 3× / 4× / 5+×).
 *
 * Renders a 5-pill row + an inline context line that flexes against the
 * player's previous goal ("Stepping it up", "Same as last week", "Dialing
 * back").
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import { base, primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import { useTranslation } from '../../../hooks';

const FREQ_OPTIONS = [1, 2, 3, 4, 5] as const;

interface FrequencyPillsProps {
  value: number; // 1..5
  onChange: (n: number) => void;
  /** Last week's goal — drives the context line. Pass null if no prior goal. */
  previousGoal: number | null;
}

export function FrequencyPills({ value, onChange, previousGoal }: FrequencyPillsProps) {
  const { t } = useTranslation();
  const { colors, isDark } = useThemeStyles();

  const contextText = (() => {
    if (previousGoal == null) return null;
    if (value === previousGoal) return t('weeklyCheckIn.step3.frequencyContextSame');
    if (value > previousGoal)
      return t('weeklyCheckIn.step3.frequencyContextUp', {
        last: previousGoal,
        current: value,
      });
    return t('weeklyCheckIn.step3.frequencyContextDown', { current: value });
  })();

  return (
    <View>
      <View style={styles.row}>
        {FREQ_OPTIONS.map(n => {
          const active = n === value;
          const labelKey =
            n === 5
              ? 'weeklyCheckIn.step3.frequencyOption.5plus'
              : `weeklyCheckIn.step3.frequencyOption.${n}`;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              style={({ pressed }) => [
                styles.pill,
                { backgroundColor: colors.card, borderColor: colors.border },
                active && styles.pillActive,
                pressed && styles.pillPressed,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${n}${n === 5 ? '+' : ''}`}
            >
              <Text
                style={
                  active
                    ? [styles.pillText, { color: base.white }]
                    : [styles.pillText, { color: colors.text }]
                }
              >
                {/* dynamic key (n is variable) — needs the `as any` escape hatch */}
                {t(labelKey as never)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {contextText && (
        <View
          style={[
            styles.contextBox,
            { backgroundColor: isDark ? `${primary[700]}33` : primary[50] },
          ]}
        >
          <Text style={[styles.contextText, { color: isDark ? primary[300] : primary[700] }]}>
            {contextText}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    marginHorizontal: spacingPixels[1],
    marginBottom: spacingPixels[3],
  },
  pill: {
    flex: 1,
    aspectRatio: 1 / 1.25,
    borderRadius: radiusPixels.xl,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: primary[600],
    borderColor: primary[600],
  },
  pillPressed: {
    transform: [{ scale: 0.96 }],
  },
  pillText: {
    fontSize: 22,
    fontWeight: '700',
  },
  contextBox: {
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    marginHorizontal: spacingPixels[1],
    marginBottom: spacingPixels[2],
  },
  contextText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
  },
});
