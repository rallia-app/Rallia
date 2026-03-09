import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';
import type { MapFacility } from '@rallia/shared-hooks';

interface FacilityTooltipProps {
  facility: MapFacility;
  colors: {
    card: string;
    text: string;
    textMuted: string;
    border: string;
    primary: string;
  };
  t: (key: string, options?: Record<string, unknown>) => string;
  onPress: (facilityId: string) => void;
}

function formatDistance(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined) return null;
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function FacilityTooltip({ facility, colors, t, onPress }: FacilityTooltipProps) {
  const distance = formatDistance(facility.distance_meters);
  const courtCount = facility.court_count ?? 0;
  const courtLabel =
    courtCount === 1
      ? t('map.tooltip.courtsSingular')
      : t('map.tooltip.courts', { count: courtCount });

  const handlePress = () => {
    lightHaptic();
    onPress(facility.id);
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(250)}
      exiting={FadeOutDown.duration(150)}
      style={styles.wrapper}
    >
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.7}
        onPress={handlePress}
        accessible
        accessibilityLabel={facility.name}
        accessibilityRole="button"
      >
        <View style={styles.content}>
          <View style={styles.info}>
            <Text size="base" weight="semibold" color={colors.text} numberOfLines={1}>
              {facility.name}
            </Text>
            {(facility.address || facility.city) && (
              <Text size="sm" color={colors.textMuted} numberOfLines={1}>
                {facility.address || facility.city}
              </Text>
            )}
            <View style={styles.meta}>
              {courtCount > 0 && (
                <View style={styles.badge}>
                  <Ionicons name="grid-outline" size={12} color={colors.textMuted} />
                  <Text size="xs" color={colors.textMuted}>
                    {courtLabel}
                  </Text>
                </View>
              )}
              {distance && (
                <View style={styles.badge}>
                  <Ionicons name="navigate-outline" size={12} color={colors.textMuted} />
                  <Text size="xs" color={colors.textMuted}>
                    {distance}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.chevron}>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 100,
    left: spacingPixels[4],
    right: spacingPixels[4],
    zIndex: 20,
  },
  card: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    padding: spacingPixels[3],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    gap: 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    marginTop: spacingPixels[1],
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chevron: {
    marginLeft: spacingPixels[2],
  },
});
