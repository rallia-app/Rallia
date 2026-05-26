/**
 * NewFacesCard
 *
 * Settling-in members surfaced as horizontally scrolling intro cards with
 * "Invite" CTAs.
 */

import React from 'react';
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { neutral, primary, radiusPixels, spacingPixels } from '@rallia/design-system';
import { getHumanName, getProfilePictureUrl } from '@rallia/shared-utils';
import type { NetworkPulseSettlingInEntry } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '#/hooks';
import RatingBadge from '#/components/RatingBadge';

interface NewFacesCardProps {
  members: NetworkPulseSettlingInEntry[];
  onInvite?: (memberId: string) => void;
  onPlayerPress?: (memberId: string) => void;
}

export const NewFacesCard = React.forwardRef<View, NewFacesCardProps>(
  ({ members, onInvite, onPlayerPress }, ref) => {
    const { colors, isDark } = useThemeStyles();
    const { t } = useTranslation();

    if (!members.length) return null;

    return (
      <View ref={ref} style={styles.section}>
        <Text size="sm" weight="bold" style={[styles.title, { color: colors.text }]}>
          {t('groups.leaderboard.discover.newFacesTitle')}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {members.map(m => (
            <TouchableOpacity
              key={m.player_id}
              activeOpacity={0.85}
              onPress={() => onPlayerPress?.(m.player_id)}
              style={[
                styles.tile,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <View
                style={[styles.avatar, { backgroundColor: isDark ? neutral[800] : neutral[200] }]}
              >
                {m.profile_picture_url ? (
                  <Image
                    source={{ uri: getProfilePictureUrl(m.profile_picture_url) ?? '' }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Ionicons name="person-outline" size={22} color={colors.textMuted} />
                )}
              </View>
              <Text
                size="sm"
                weight="semibold"
                numberOfLines={1}
                style={{ color: colors.text, marginTop: 6 }}
              >
                {getHumanName(m, t('groups.recentGames.player'))}
              </Text>
              <Text
                size="xs"
                style={{ color: colors.textMuted, textAlign: 'center' }}
                numberOfLines={2}
              >
                {t('groups.leaderboard.discover.newFacesCopy')}
              </Text>
              {m.skill_rating && (
                <View style={{ marginTop: 4 }}>
                  <RatingBadge
                    ratingValue={m.skill_rating.value}
                    certificationStatus={m.skill_rating.certification_status}
                    isDark={isDark}
                    size="sm"
                  />
                </View>
              )}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => onInvite?.(m.player_id)}
                style={[styles.cta, { backgroundColor: primary[500] }]}
              >
                <Text size="xs" weight="semibold" style={{ color: '#ffffff' }}>
                  {t('groups.leaderboard.discover.invite')}
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }
);

NewFacesCard.displayName = 'NewFacesCard';

const styles = StyleSheet.create({
  section: {
    marginBottom: spacingPixels[4],
  },
  title: {
    marginBottom: spacingPixels[2],
  },
  row: {
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[1],
  },
  tile: {
    width: 140,
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  cta: {
    marginTop: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
});

export default NewFacesCard;
