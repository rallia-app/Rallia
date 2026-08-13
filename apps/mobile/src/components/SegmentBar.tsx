import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels, primary } from '@rallia/design-system';

import { useThemeStyles } from '../hooks';

const SEGMENT_ICON_SIZE = 18;

export interface SegmentOption<K extends string> {
  key: K;
  /**
   * An Ionicon name for the common case, or a render function when the tab
   * needs its own artwork (a sport's racquet, say). Tinted by active state.
   */
  icon: keyof typeof Ionicons.glyphMap | ((color: string) => React.ReactNode);
  label: string;
}

/**
 * The hub tab bar: a pill track with one raised, tinted tab per segment.
 * Shared by the Compete hub and the public games feed so both read as the same
 * kind of surface rather than two screens that happen to have tabs.
 */
export function SegmentBar<K extends string>({
  segments,
  active,
  onChange,
  testIDPrefix,
}: {
  segments: Array<SegmentOption<K>>;
  active: K;
  onChange: (key: K) => void;
  testIDPrefix?: string;
}) {
  const { colors, isDark } = useThemeStyles();
  const activeColor = isDark ? primary[300] : primary[600];

  return (
    <View style={[styles.tabBar, { backgroundColor: colors.segmentTrack }]}>
      {segments.map(segment => {
        const isActive = active === segment.key;
        return (
          <TouchableOpacity
            key={segment.key}
            style={[
              styles.tab,
              isActive && [styles.activeTab, { backgroundColor: colors.segmentActive }],
            ]}
            onPress={() => {
              if (segment.key !== active) {
                void lightHaptic();
                onChange(segment.key);
              }
            }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            testID={testIDPrefix ? `${testIDPrefix}-${segment.key}` : undefined}
          >
            {typeof segment.icon === 'function' ? (
              segment.icon(isActive ? activeColor : colors.textMuted)
            ) : (
              <Ionicons
                name={segment.icon}
                size={SEGMENT_ICON_SIZE}
                color={isActive ? activeColor : colors.textMuted}
              />
            )}
            <Text
              size="sm"
              weight={isActive ? 'semibold' : 'medium'}
              style={[styles.tabLabel, { color: isActive ? activeColor : colors.textMuted }]}
              numberOfLines={1}
            >
              {segment.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[4],
    marginBottom: spacingPixels[1],
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[1],
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacingPixels[2.5],
    borderRadius: radiusPixels.lg,
  },
  activeTab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabLabel: {
    marginLeft: spacingPixels[1.5],
  },
});
