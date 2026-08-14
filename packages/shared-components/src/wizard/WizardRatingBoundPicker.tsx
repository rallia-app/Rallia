/**
 * One bound of a rating band: the sport's tiers as a horizontal strip, plus a
 * "no bound" card in front. Every event format gates entry the same way (the
 * spec's shared eligibility rule), so the strip is one component, not one per
 * wizard.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { Text } from '../foundation/Text';

import { WizardFieldLabel } from './WizardOptionCard';
import type { WizardColors } from './types';

export interface WizardRatingOption {
  id: string;
  value: number;
  label: string;
  /** Already-translated tier abbreviation; omitted when the sport has none. */
  skillLabel?: string | null;
}

export interface WizardRatingBoundPickerProps {
  label: string;
  /** Caption on the leading "no bound" card. */
  noneLabel: string;
  /** Optional line under the strip explaining what the bound does. */
  hint?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  options: WizardRatingOption[];
  colors: WizardColors;
  testID?: string;
}

export const WizardRatingBoundPicker: React.FC<WizardRatingBoundPickerProps> = ({
  label,
  noneLabel,
  hint,
  value,
  onChange,
  options,
  colors,
  testID,
}) => (
  <View style={styles.fieldGroup}>
    <WizardFieldLabel colors={colors}>{label}</WizardFieldLabel>
    <GestureScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      nestedScrollEnabled
      testID={testID}
    >
      <TouchableOpacity
        onPress={() => {
          void lightHaptic();
          onChange(null);
        }}
        activeOpacity={0.7}
        style={[
          styles.card,
          {
            backgroundColor: value === null ? `${colors.buttonActive}15` : colors.buttonInactive,
            borderColor: value === null ? colors.buttonActive : colors.border,
          },
        ]}
      >
        <Text
          size="sm"
          weight={value === null ? 'bold' : 'regular'}
          color={value === null ? colors.buttonActive : colors.text}
        >
          {noneLabel}
        </Text>
      </TouchableOpacity>
      {options.map(opt => {
        const selected = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.id}
            onPress={() => {
              void lightHaptic();
              onChange(opt.value);
            }}
            activeOpacity={0.7}
            style={[
              styles.card,
              {
                backgroundColor: selected ? `${colors.buttonActive}15` : colors.buttonInactive,
                borderColor: selected ? colors.buttonActive : colors.border,
              },
            ]}
          >
            <Text
              size="base"
              weight={selected ? 'bold' : 'semibold'}
              color={selected ? colors.buttonActive : colors.text}
            >
              {opt.label}
            </Text>
            {opt.skillLabel && (
              <Text
                size="xs"
                color={selected ? colors.buttonActive : colors.textMuted}
                style={styles.skillLevel}
              >
                {opt.skillLabel}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </GestureScrollView>
    {hint != null && (
      <Text size="xs" color={colors.textMuted} style={styles.hint}>
        {hint}
      </Text>
    )}
  </View>
);

const styles = StyleSheet.create({
  fieldGroup: {
    marginBottom: spacingPixels[5],
  },
  scrollContent: {
    gap: spacingPixels[2],
    paddingRight: spacingPixels[2],
  },
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    minWidth: 60,
  },
  skillLevel: {
    marginTop: spacingPixels[0.5],
  },
  hint: {
    marginTop: spacingPixels[2],
  },
});
