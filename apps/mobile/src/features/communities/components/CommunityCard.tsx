/**
 * CommunityCard Component
 * Reusable card for displaying a community summary (name, image, member count).
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { OptimizedImage } from '../../../components/OptimizedImage';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  primary,
  neutral,
} from '@rallia/design-system';
import type { TranslationKey, TranslationOptions } from '../../../hooks';

export interface CommunityCardData {
  id: string;
  name: string;
  coverImageUrl: string | null;
  memberCount: number;
  description: string | null;
  isCertified?: boolean;
}

interface CommunityCardProps {
  community: CommunityCardData;
  onPress: () => void;
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

export function CommunityCard({ community, onPress, colors, isDark, t }: CommunityCardProps) {
  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {community.coverImageUrl ? (
        <OptimizedImage
          source={{ uri: community.coverImageUrl }}
          style={styles.image}
          contentFit="cover"
        />
      ) : (
        <View
          style={[
            styles.imagePlaceholder,
            { backgroundColor: isDark ? neutral[700] : primary[50] },
          ]}
        >
          <Ionicons name="people" size={20} color={isDark ? neutral[400] : primary[400]} />
        </View>
      )}

      <View style={styles.content}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {community.name}
          </Text>
          {community.isCertified && (
            <MaterialCommunityIcons name="check-decagram" size={14} color="#22c55e" />
          )}
        </View>
        <View style={styles.meta}>
          <Ionicons name="people-outline" size={12} color={colors.textMuted} />
          <Text style={[styles.memberCount, { color: colors.textMuted }]}>
            {community.memberCount === 1
              ? t('facilityDetail.communities.memberCountOne' as Parameters<typeof t>[0])
              : t('facilityDetail.communities.memberCount' as Parameters<typeof t>[0], {
                  count: community.memberCount,
                })}
          </Text>
        </View>
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radiusPixels.xl,
    padding: spacingPixels[3],
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  image: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.lg,
  },
  imagePlaceholder: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    gap: spacingPixels[1],
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  name: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  memberCount: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.medium,
  },
});
