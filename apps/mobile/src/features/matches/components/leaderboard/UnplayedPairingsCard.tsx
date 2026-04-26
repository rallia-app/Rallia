/**
 * UnplayedPairingsCard
 *
 * Find-your-match card. Shows up to 3 same-skill members the caller has
 * never played, each tappable with a "Challenge" CTA.
 */

import React from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { neutral, primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import { getHumanName } from '@rallia/shared-utils';
import type { NetworkPulseUnplayedPairing } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../../hooks';
import RatingBadge from '../../../../components/RatingBadge';

interface UnplayedPairingsCardProps {
  pairings: NetworkPulseUnplayedPairing[];
  onChallenge?: (peerId: string) => void;
  onPlayerPress?: (peerId: string) => void;
}

export function UnplayedPairingsCard({
  pairings,
  onChallenge,
  onPlayerPress,
}: UnplayedPairingsCardProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  if (!pairings.length) return null;

  return (
    <View style={styles.section}>
      <Text size="sm" weight="bold" style={[styles.title, { color: colors.text }]}>
        {t('groups.leaderboard.discover.unplayedTitle')}
      </Text>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.cardBackground, borderColor: colors.border },
        ]}
      >
        {pairings.map((p, i) => (
          <View
            key={p.peer_player_id}
            style={[
              styles.row,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            ]}
          >
            <TouchableOpacity
              style={styles.identity}
              activeOpacity={0.75}
              onPress={() => onPlayerPress?.(p.peer_player_id)}
            >
              <View
                style={[styles.avatar, { backgroundColor: isDark ? neutral[800] : neutral[200] }]}
              >
                {p.profile_picture_url ? (
                  <Image source={{ uri: p.profile_picture_url }} style={styles.avatarImage} />
                ) : (
                  <Ionicons name="person-outline" size={16} color={colors.textMuted} />
                )}
              </View>
              <View style={{ marginLeft: spacingPixels[2], flex: 1 }}>
                <Text size="sm" weight="semibold" style={{ color: colors.text }}>
                  {getHumanName(p, t('groups.recentGames.player'))}
                </Text>
                <View style={styles.subline}>
                  <Text size="xs" style={{ color: colors.textMuted }}>
                    {t('groups.leaderboard.discover.unplayedCopy', {
                      count: p.games_played,
                    })}
                  </Text>
                  {p.rating_value != null && (
                    <View style={{ marginLeft: spacingPixels[2] }}>
                      <RatingBadge ratingValue={p.rating_value} isDark={isDark} size="sm" />
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => onChallenge?.(p.peer_player_id)}
              style={[styles.cta, { backgroundColor: primary[500] }]}
            >
              <Text size="xs" weight="semibold" style={{ color: '#ffffff' }}>
                {t('groups.leaderboard.discover.challenge')}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacingPixels[4],
  },
  title: {
    marginBottom: spacingPixels[2],
  },
  card: {
    borderRadius: radiusPixels.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  subline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  cta: {
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    marginLeft: spacingPixels[2],
  },
});

export default UnplayedPairingsCard;
