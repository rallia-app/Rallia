import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';

import { useThemeStyles } from '#/hooks';

import { PLAYER_CARD_AVATAR_FRAME } from './PlayerCard';

// Text-box heights (fontSize × 1.5 lineHeight) so the swap-in doesn't shift.
const NAME_LINE_HEIGHT = 27;
const META_LINE_HEIGHT = 21;
const META_GLYPH_HEIGHT = 14;
const NUMERAL_HEIGHT = 28;
const CAPTION_HEIGHT = 12;
const NAME_ROW_MIN_HEIGHT = 32;

const PlayerCardSkeleton: React.FC = () => {
  const { colors } = useThemeStyles();
  const bg = colors.skeletonTintedBackground;
  const hl = colors.skeletonTintedHighlight;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Skeleton
        width={PLAYER_CARD_AVATAR_FRAME}
        height={PLAYER_CARD_AVATAR_FRAME}
        circle
        backgroundColor={bg}
        highlightColor={hl}
      />
      <View style={styles.infoContainer}>
        <View style={styles.nameRow}>
          <Skeleton
            width="45%"
            height={NAME_LINE_HEIGHT}
            borderRadius={4}
            backgroundColor={bg}
            highlightColor={hl}
          />
          <View style={styles.actionPlaceholder}>
            <Skeleton width={20} height={20} circle backgroundColor={bg} highlightColor={hl} />
          </View>
        </View>
        <View style={styles.metaRow}>
          <Skeleton
            width={110}
            height={META_GLYPH_HEIGHT}
            borderRadius={4}
            backgroundColor={bg}
            highlightColor={hl}
          />
        </View>
      </View>
      <View style={styles.ratingColumn}>
        <Skeleton
          width={40}
          height={NUMERAL_HEIGHT}
          borderRadius={4}
          backgroundColor={bg}
          highlightColor={hl}
        />
        <Skeleton
          width={64}
          height={CAPTION_HEIGHT}
          borderRadius={4}
          backgroundColor={bg}
          highlightColor={hl}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Mirrors PlayerCard styles.card.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
    padding: spacingPixels[3],
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[2],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
  },
  infoContainer: {
    flex: 1,
    minWidth: 0,
    gap: spacingPixels[0.5],
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    minHeight: NAME_ROW_MIN_HEIGHT,
  },
  ratingColumn: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacingPixels[1],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: META_LINE_HEIGHT,
  },
  // Matches IconButton size="sm" (32pt).
  actionPlaceholder: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default PlayerCardSkeleton;
