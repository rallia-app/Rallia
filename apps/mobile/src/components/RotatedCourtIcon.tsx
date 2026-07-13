import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import TennisCourtIcon from '../../assets/icons/tennis-court.svg';

// The bottom "Courts" tab glyph, rotated 90° — the sport-neutral icon for
// "courts available" chips (no tennis ball). Slightly larger default than sibling
// Ionicons since the court sits inside padded viewBox whitespace.
export function RotatedCourtIcon({
  size = 12,
  color,
  style,
}: {
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ transform: [{ rotate: '90deg' }] }, style]}>
      <TennisCourtIcon width={size} height={size} stroke={color} />
    </View>
  );
}
