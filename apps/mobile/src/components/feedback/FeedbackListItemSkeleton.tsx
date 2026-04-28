/**
 * FeedbackListItemSkeleton
 *
 * Mirrors FeedbackListItem's layout while initial data is loading.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Skeleton } from '@rallia/shared-components';
import { neutral, radiusPixels, spacingPixels } from '@rallia/design-system';

interface FeedbackListItemSkeletonProps {
  isDark: boolean;
  borderColor: string;
  cardColor: string;
}

export const FeedbackListItemSkeleton: React.FC<FeedbackListItemSkeletonProps> = ({
  isDark,
  borderColor,
  cardColor,
}) => {
  const baseColor = isDark ? '#2C2C2E' : '#E1E9EE';
  const highlightColor = isDark ? '#3C3C3E' : '#F2F8FC';
  const iconBg = isDark ? neutral[800] : neutral[100];

  return (
    <View style={[styles.row, { borderColor, backgroundColor: cardColor }]}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]} />
      <View style={styles.content}>
        <Skeleton
          width="80%"
          height={14}
          backgroundColor={baseColor}
          highlightColor={highlightColor}
        />
        <View style={styles.metaRow}>
          <Skeleton
            width={60}
            height={16}
            borderRadius={radiusPixels.full}
            backgroundColor={baseColor}
            highlightColor={highlightColor}
          />
          <Skeleton
            width={40}
            height={10}
            backgroundColor={baseColor}
            highlightColor={highlightColor}
          />
        </View>
      </View>
      <Skeleton
        width={52}
        height={28}
        borderRadius={radiusPixels.lg}
        backgroundColor={baseColor}
        highlightColor={highlightColor}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.full,
  },
  content: {
    flex: 1,
    gap: spacingPixels[2],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
});

export default FeedbackListItemSkeleton;
