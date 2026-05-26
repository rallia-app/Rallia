/**
 * StatCard — shared frame for the My-Stats cards.
 */

import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { Text } from '@rallia/shared-components';
import { radiusPixels, spacingPixels } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';

export interface StatCardProps {
  title: string;
  width?: number;
  children: React.ReactNode;
  style?: ViewStyle;
}

export function StatCard({ title, width = 220, children, style }: StatCardProps) {
  const { colors } = useThemeStyles();
  return (
    <View
      style={[
        styles.card,
        {
          width,
          backgroundColor: colors.cardBackground,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <Text size="xs" weight="semibold" style={{ color: colors.textMuted }}>
        {title.toUpperCase()}
      </Text>
      <View style={{ marginTop: spacingPixels[2], flex: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 130,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});

export default StatCard;
