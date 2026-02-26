/**
 * CourtCard Component
 * Displays a court as a horizontal row card (matching sport card pattern in UserProfile).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  shadowsNative,
  primary,
  accent,
  neutral,
} from '@rallia/design-system';
import type { Court } from '@rallia/shared-types';
import type { TranslationKey, TranslationOptions } from '../../../hooks';

interface CourtCardProps {
  court: Court;
  colors: {
    card: string;
    text: string;
    textMuted: string;
    primary: string;
    border: string;
  };
  isDark: boolean;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
}

export default function CourtCard({ court, colors, isDark, t }: CourtCardProps) {
  const courtName = court.name || `Court ${court.court_number || ''}`;

  const surfaceKey = court.surface_type?.toLowerCase() || '';
  const surfaceLabel = surfaceKey
    ? t(`facilityDetail.surfaceType.${surfaceKey}` as Parameters<typeof t>[0])
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.card }, shadowsNative.sm]}>
      <View style={styles.left}>
        <Text style={[styles.courtName, { color: colors.text }]}>{courtName}</Text>

        {/* Attribute badges */}
        <View
          style={[
            styles.badge,
            {
              backgroundColor: isDark
                ? neutral[700]
                : court.indoor
                  ? primary[500] + '15'
                  : accent[500] + '15',
            },
          ]}
        >
          <Text style={[styles.badgeText, { color: court.indoor ? primary[500] : accent[500] }]}>
            {court.indoor ? t('facilityDetail.indoor') : t('facilityDetail.outdoor')}
          </Text>
        </View>

        {surfaceLabel && (
          <View
            style={[styles.badge, { backgroundColor: isDark ? neutral[700] : primary[500] + '15' }]}
          >
            <Text style={[styles.badgeText, { color: primary[600] }]}>{surfaceLabel}</Text>
          </View>
        )}

        {court.lighting && (
          <View
            style={[
              styles.lightBadge,
              { backgroundColor: isDark ? neutral[700] : accent[500] + '15' },
            ]}
          >
            <Ionicons name="bulb-outline" size={11} color={accent[600]} />
          </View>
        )}
      </View>

      {court.notes && (
        <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[4],
    ...shadowsNative.sm,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    flex: 1,
  },
  courtName: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.xl,
  },
  badgeText: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.semibold,
  },
  lightBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    borderRadius: radiusPixels.full,
  },
});
