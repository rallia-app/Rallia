/**
 * Status pill for event cards and headers. The caller maps its own status enum
 * to a tone and a label, so tournaments, leagues and later formats share one
 * pill instead of one each.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';

import { Text } from '../foundation/Text';

import type { EventListColors, EventTone } from './eventListColors';

/** On the banner image the pill background is near-white in both themes, so
 *  its text needs fixed light-mode tones rather than theme colours. */
const ON_IMAGE_TONE_TEXT: Record<EventTone, string> = {
  positive: '#15803d',
  active: primary[700],
  neutral: neutral[700],
  muted: neutral[500],
};

export interface EventStatusPillProps {
  tone: EventTone;
  label: string;
  colors: EventListColors;
  /** Sitting over a banner image rather than on the card surface. */
  onImage?: boolean;
}

export const EventStatusPill: React.FC<EventStatusPillProps> = ({
  tone,
  label,
  colors,
  onImage,
}) => {
  const bg = onImage
    ? 'rgba(255,255,255,0.94)'
    : tone === 'positive'
      ? colors.positiveBg
      : tone === 'active'
        ? colors.activeBg
        : tone === 'muted'
          ? colors.mutedBg
          : colors.neutralBg;
  const fg = onImage
    ? ON_IMAGE_TONE_TEXT[tone]
    : tone === 'positive'
      ? colors.positiveText
      : tone === 'active'
        ? colors.activeText
        : tone === 'muted'
          ? colors.mutedText
          : colors.neutralText;
  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Text size="xs" weight="semibold" color={fg}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  statusPill: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
});
