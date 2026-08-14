/**
 * The quiet fact line on an event card: dot-separated decision facts, an
 * optional icon on the first fact, and an optional trailing chip (role, badge).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

import { Text } from '../foundation/Text';

import type { EventListColors } from './eventListColors';

export interface EventMetaChipProps {
  label: string;
  colors: EventListColors;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: 'primary' | 'secondary' | 'accent';
}

export const EventMetaChip: React.FC<EventMetaChipProps> = ({
  label,
  colors,
  icon,
  tone = 'primary',
}) => {
  const bg =
    tone === 'secondary'
      ? colors.chipSecondaryBg
      : tone === 'accent'
        ? colors.chipAccentBg
        : colors.chipPrimaryBg;
  const fg =
    tone === 'secondary'
      ? colors.chipSecondaryText
      : tone === 'accent'
        ? colors.chipAccentText
        : colors.chipPrimaryText;
  return (
    <View style={[styles.metaChip, { backgroundColor: bg }]}>
      {icon && <Ionicons name={icon} size={12} color={fg} />}
      <Text size="xs" weight="semibold" color={fg}>
        {label}
      </Text>
    </View>
  );
};

export interface EventMetaRowProps {
  facts: string[];
  colors: EventListColors;
  /** Rendered before the first fact (the rating band's analytics glyph). */
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  /** Chips after the facts (organizer role, and whatever a format adds). */
  trailing?: React.ReactNode;
}

export const EventMetaRow: React.FC<EventMetaRowProps> = ({
  facts,
  colors,
  leadingIcon,
  trailing,
}) => (
  <View style={styles.metaRow}>
    {facts.map((fact, i) => (
      <React.Fragment key={`${i}-${fact}`}>
        {i > 0 && (
          <Text size="xs" color={colors.textMuted}>
            ·
          </Text>
        )}
        <View style={styles.metaItem}>
          {i === 0 && leadingIcon && (
            <Ionicons name={leadingIcon} size={13} color={colors.primary} />
          )}
          <Text size="xs" weight="medium" color={colors.textMuted}>
            {fact}
          </Text>
        </View>
      </React.Fragment>
    ))}
    {trailing}
  </View>
);

const styles = StyleSheet.create({
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingPixels[1.5],
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
});
