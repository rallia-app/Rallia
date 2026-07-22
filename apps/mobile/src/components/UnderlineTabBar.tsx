/**
 * UnderlineTabBar
 *
 * Scrollable underline tabs — same pattern as the detail screens' sticky tab
 * bar: label-sized items, 2px primary underline under the active tab, hairline
 * bottom border on the track. Optional count chip per tab, tinted by tone.
 */

import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Text } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels, neutral, status } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';

/** Chip tone — pick by what the count means, not by tab position. */
export type TabCountTone = 'positive' | 'warning' | 'info' | 'danger' | 'neutral';

export type UnderlineTabItem<K extends string = string> = {
  key: K;
  label: string;
  /** Rendered as a tinted chip beside the label; hidden when 0 or unset. */
  count?: number;
  /** Defaults to neutral. */
  tone?: TabCountTone;
};

interface UnderlineTabBarProps<K extends string> {
  tabs: UnderlineTabItem<K>[];
  activeKey: K;
  onChange: (key: K) => void;
  style?: StyleProp<ViewStyle>;
}

/** Chip background is a low-alpha wash of the tone; text takes the tone's
 *  light/dark variant so it stays legible on that wash in either theme. */
function chipColors(tone: TabCountTone, isDark: boolean): { bg: string; fg: string } {
  if (tone === 'neutral') {
    return {
      bg: isDark ? neutral[800] : neutral[200],
      fg: isDark ? neutral[300] : neutral[600],
    };
  }
  const token =
    tone === 'positive'
      ? status.success
      : tone === 'warning'
        ? status.warning
        : tone === 'danger'
          ? status.error
          : status.info;
  return {
    bg: `${token.DEFAULT}${isDark ? '33' : '1f'}`,
    fg: isDark ? token.light : token.dark,
  };
}

function UnderlineTabBar<K extends string>({
  tabs,
  activeKey,
  onChange,
  style,
}: UnderlineTabBarProps<K>) {
  const { colors, isDark } = useThemeStyles();

  return (
    <View style={[styles.bar, { borderBottomColor: colors.border }, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {tabs.map(tab => {
          const selected = tab.key === activeKey;
          const showChip = tab.count !== undefined && tab.count > 0;
          const chip = chipColors(tab.tone ?? 'neutral', isDark);
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => {
                if (selected) return;
                void lightHaptic();
                onChange(tab.key);
              }}
              activeOpacity={0.7}
              style={styles.item}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
            >
              <View style={styles.labelRow}>
                <Text
                  size="sm"
                  weight={selected ? 'semibold' : 'medium'}
                  color={selected ? colors.primary : colors.textMuted}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
                {showChip && (
                  <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                    <Text size="xs" weight="semibold" color={chip.fg} style={styles.chipText}>
                      {tab.count}
                    </Text>
                  </View>
                )}
              </View>
              <View
                style={[
                  styles.underline,
                  { backgroundColor: selected ? colors.primary : 'transparent' },
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacingPixels[5],
  },
  item: {
    alignItems: 'center',
    paddingTop: spacingPixels[2],
    gap: spacingPixels[2],
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
  },
  chip: {
    minWidth: 20,
    height: 20,
    borderRadius: radiusPixels.full,
    paddingHorizontal: spacingPixels[1.5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontVariant: ['tabular-nums'],
  },
  underline: {
    alignSelf: 'stretch',
    height: 2,
    borderRadius: 1,
  },
});

export default UnderlineTabBar;
