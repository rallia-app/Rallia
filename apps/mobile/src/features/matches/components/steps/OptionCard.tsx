/**
 * Option Card
 *
 * Selectable card used across the match creation wizard steps.
 * Full layout (icon + title + description) or compact (icon over title).
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

export interface OptionCardColors {
  text: string;
  textMuted: string;
  border: string;
  buttonActive: string;
  buttonInactive: string;
}

interface OptionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  colors: OptionCardColors;
  compact?: boolean;
  /** Compact layout only: lines the title may wrap to before it shrinks. */
  titleLines?: number;
}

export const OptionCard: React.FC<OptionCardProps> = ({
  icon,
  title,
  description,
  selected,
  onPress,
  colors,
  compact = false,
  titleLines = 1,
}) => (
  <TouchableOpacity
    style={[
      compact ? styles.optionCardCompact : styles.optionCard,
      {
        backgroundColor: selected ? `${colors.buttonActive}15` : colors.buttonInactive,
        borderColor: selected ? colors.buttonActive : colors.border,
      },
    ]}
    onPress={() => {
      lightHaptic();
      onPress();
    }}
    activeOpacity={0.7}
  >
    {compact ? (
      // Compact layout: icon on top, title below
      <View style={styles.optionContentCompact}>
        <Ionicons name={icon} size={24} color={selected ? colors.buttonActive : colors.textMuted} />
        {/* Shrinks rather than breaking mid-word: four tiles across leaves
            "Homme"/"Femme" barely enough room. Rows of two can afford a
            second line for longer labels. */}
        <Text
          size="sm"
          weight={selected ? 'semibold' : 'regular'}
          color={selected ? colors.buttonActive : colors.text}
          style={styles.compactTitle}
          numberOfLines={titleLines}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {title}
        </Text>
      </View>
    ) : (
      // Full layout: icon + text side by side
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
          </View>
        </View>
        {selected && <Ionicons name="checkmark-circle" size={20} color={colors.buttonActive} />}
      </>
    )}
  </TouchableOpacity>
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
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacingPixels[3],
  },
  optionTextContainer: {
    flex: 1,
  },
  optionCardCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    minHeight: 70,
  },
  optionContentCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: spacingPixels[1],
  },
  compactTitle: {
    textAlign: 'center',
    alignSelf: 'stretch',
  },
});

export default OptionCard;
