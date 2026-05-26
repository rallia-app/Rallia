/**
 * FormStrip
 *
 * Horizontal scroll of the top 5 most-active members showing each player's
 * last-5 form line. Tap an avatar → player profile.
 */

import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { neutral, radiusPixels, spacingPixels } from '@rallia/design-system';
import type { NetworkPulseFormStripEntry } from '@rallia/shared-hooks';

import { useThemeStyles } from '#/hooks';

import { FormLine } from './FormLine';

interface FormStripProps {
  entries: NetworkPulseFormStripEntry[];
  onPlayerPress?: (playerId: string) => void;
}

export function FormStrip({ entries, onPlayerPress }: FormStripProps) {
  const { colors, isDark } = useThemeStyles();
  if (!entries || entries.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {entries.map(entry => (
        <TouchableOpacity
          key={entry.player_id}
          activeOpacity={0.75}
          onPress={() => onPlayerPress?.(entry.player_id)}
          style={[
            styles.tile,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: isDark ? neutral[700] : neutral[200] }]}>
            <Ionicons name="person-outline" size={18} color={colors.textMuted} />
          </View>
          <Text size="xs" weight="semibold" style={{ color: colors.text, marginTop: 6 }}>
            {entry.first_name}
          </Text>
          <View style={{ marginTop: 4 }}>
            <FormLine outcomes={entry.last5} size="sm" isDark={isDark} />
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacingPixels[1],
    gap: spacingPixels[2],
  },
  tile: {
    width: 96,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default FormStrip;
