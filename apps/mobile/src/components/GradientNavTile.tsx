import React from 'react';
import { StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

export const NAV_TILE_WATERMARK_COLOR = 'rgba(255,255,255,0.12)';

/**
 * Gradient dispatch tile shared by the Home play grid and the Community hub —
 * same visual language as the home ClassementsTile (gradient surface, frosted
 * icon chip, low-opacity watermark, chevron).
 */
export const GradientNavTile: React.FC<{
  icon: (color: string) => React.ReactNode;
  watermark: React.ReactNode;
  gradient: [string, string];
  borderColor: string;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}> = ({ icon, watermark, gradient, borderColor, label, onPress, style }) => {
  const handlePress = () => {
    void lightHaptic();
    onPress();
  };
  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.85}
      style={[styles.item, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.inner, { borderColor }]}
      >
        <View style={styles.watermark}>{watermark}</View>
        <View style={styles.topRow}>
          <View style={styles.iconCircle}>{icon('#ffffff')}</View>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
        </View>
        <Text size="sm" weight="semibold" color="#ffffff" numberOfLines={2} style={styles.label}>
          {label}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  item: {
    borderRadius: radiusPixels.xl,
  },
  inner: {
    flex: 1,
    borderRadius: radiusPixels.xl,
    borderWidth: 1.5,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    gap: spacingPixels[3],
    // If a same-row sibling's label wraps, row-stretch grows this tile too —
    // space-between keeps the label pinned to the bottom instead of floating.
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  watermark: {
    position: 'absolute',
    right: -spacingPixels[2],
    bottom: -spacingPixels[3],
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  label: {
    lineHeight: 18,
  },
});
