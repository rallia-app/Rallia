/**
 * The selectable option row wizards use for enums (visibility, join mode,
 * format). `compact` is the icon-over-label tile variant.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

import { Text } from '../foundation/Text';

import type { WizardColors } from './types';

export interface WizardOptionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  colors: WizardColors;
  compact?: boolean;
  /**
   * Decision facts listed under the description, one per line. For choices
   * where the trade-off is what the reader is actually comparing (which event
   * format to run), rather than a one-line enum.
   */
  facts?: string[];
  testID?: string;
}

export const WizardOptionCard: React.FC<WizardOptionCardProps> = ({
  icon,
  title,
  description,
  selected,
  onPress,
  colors,
  compact = false,
  facts,
  testID,
}) => (
  <TouchableOpacity
    testID={testID}
    style={[
      compact ? styles.optionCardCompact : styles.optionCard,
      {
        backgroundColor: selected ? `${colors.buttonActive}15` : colors.buttonInactive,
        borderColor: selected ? colors.buttonActive : colors.border,
      },
    ]}
    onPress={() => {
      void lightHaptic();
      onPress();
    }}
    activeOpacity={0.7}
  >
    {compact ? (
      <View style={styles.optionContentCompact}>
        <Ionicons name={icon} size={24} color={selected ? colors.buttonActive : colors.textMuted} />
        <Text
          size="sm"
          weight={selected ? 'semibold' : 'regular'}
          color={selected ? colors.buttonActive : colors.text}
          style={styles.compactTitle}
        >
          {title}
        </Text>
      </View>
    ) : (
      <>
        <View style={styles.optionContent}>
          <Ionicons
            name={icon}
            size={20}
            color={selected ? colors.buttonActive : colors.textMuted}
          />
          <View style={styles.optionTextContainer}>
            <Text
              size="base"
              weight={selected ? 'semibold' : 'regular'}
              color={selected ? colors.buttonActive : colors.text}
            >
              {title}
            </Text>
            {description && (
              <Text size="xs" color={colors.textMuted}>
                {description}
              </Text>
            )}
            {facts && facts.length > 0 && (
              <View style={styles.facts}>
                {facts.map(fact => (
                  <View key={fact} style={styles.factRow}>
                    <Ionicons
                      name="ellipse"
                      size={4}
                      color={selected ? colors.buttonActive : colors.textMuted}
                    />
                    <Text size="xs" color={colors.textMuted} style={styles.factText}>
                      {fact}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
        {selected && <Ionicons name="checkmark-circle" size={20} color={colors.buttonActive} />}
      </>
    )}
  </TouchableOpacity>
);

/** Field caption above an input. Shared by every wizard step. */
export const WizardFieldLabel: React.FC<{ children: string; colors: WizardColors }> = ({
  children,
  colors,
}) => (
  <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
    {children}
  </Text>
);

const styles = StyleSheet.create({
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  optionCardCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    flex: 1,
    minHeight: 70,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacingPixels[3],
  },
  optionContentCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1],
  },
  compactTitle: {
    textAlign: 'center',
  },
  optionTextContainer: {
    flex: 1,
  },
  facts: {
    marginTop: spacingPixels[2],
    gap: spacingPixels[1],
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  factText: {
    flex: 1,
  },
  label: {
    marginBottom: spacingPixels[2],
  },
});
