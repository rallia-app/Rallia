/**
 * AutoToggleRow — Compact opt-in card used in the bottom section of Step 3.
 *
 * Two of these render under the "Make this easier" label, both checked by
 * default. Tapping anywhere on the card toggles the checked state.
 *
 * The corresponding match-creation logic that ACTS on these toggles is a
 * follow-up; for now the values are simply persisted into
 * player_check_in_preferences by record_weekly_checkin.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { useThemeStyles } from '@rallia/shared-hooks';
import {
  base,
  primary,
  radiusPixels,
  spacingPixels,
  shadowsSemanticNative,
} from '@rallia/design-system';

interface AutoToggleRowProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (b: boolean) => void;
}

export function AutoToggleRow({ title, description, checked, onChange }: AutoToggleRowProps) {
  const { colors, isDark } = useThemeStyles();
  // Use a brighter primary tint in dark mode so the selected-card border
  // doesn't disappear into the dark surface. The checkbox fill follows suit.
  const accentColor = isDark ? primary[400] : primary[600];
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card },
        checked && { borderColor: accentColor },
        pressed && styles.cardPressed,
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={title}
    >
      <View
        style={[
          styles.check,
          { borderColor: checked ? accentColor : colors.inputBorder },
          checked && { backgroundColor: accentColor },
        ]}
      >
        {checked && <Ionicons name="checkmark" size={14} color={base.white} />}
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.desc, { color: colors.textMuted }]}>{description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radiusPixels.lg,
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[3],
    marginHorizontal: spacingPixels[1],
    marginBottom: 6,
    flexDirection: 'row',
    gap: spacingPixels[2.5],
    borderWidth: 2,
    borderColor: 'transparent',
    ...shadowsSemanticNative.card,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: radiusPixels.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  text: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 1,
    lineHeight: 17,
  },
  desc: {
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '400',
  },
});
