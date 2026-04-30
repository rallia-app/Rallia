/**
 * ReferencesListSheet
 *
 * ActionSheet showing the list of players who gave valid references for a
 * given player_rating_score. Tap a row to navigate to that referee's
 * PlayerProfile.
 */

import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { getProfilePictureUrl } from '@rallia/shared-utils';
import { useRatingScoreReferees, type RatingScoreReferee } from '@rallia/shared-hooks';
import { spacingPixels, radiusPixels, fontSizePixels } from '@rallia/design-system';

import { BaseActionSheet } from '../../../components/BaseActionSheet';
import { useThemeStyles, useTranslation, useNavigateToPlayerProfile } from '../../../hooks';
import RatingBadge from '../../../components/RatingBadge';

function getRefereeFullName(r: RatingScoreReferee): string {
  const name = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();
  return name || 'Player';
}

export function ReferencesListActionSheet({ payload }: SheetProps<'references-list'>) {
  const playerRatingScoreId = payload?.playerRatingScoreId;
  const sportId = payload?.sportId;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const navigateToPlayerProfile = useNavigateToPlayerProfile();

  const { referees, isLoading, error } = useRatingScoreReferees(playerRatingScoreId);

  const handleClose = useCallback(() => {
    void SheetManager.hide('references-list');
  }, []);

  const handleRefereePress = useCallback(
    (refereeId: string) => {
      void SheetManager.hide('references-list').then(() => {
        navigateToPlayerProfile(refereeId, sportId);
      });
    },
    [navigateToPlayerProfile, sportId]
  );

  const renderItem = useCallback(
    ({ item }: { item: RatingScoreReferee }) => {
      const name = getRefereeFullName(item);
      const badgeStatus = item.referee_is_certified ? 'certified' : 'self_declared';

      return (
        <TouchableOpacity
          style={[styles.row, { borderBottomColor: colors.border }]}
          onPress={() => handleRefereePress(item.referee_id)}
          activeOpacity={0.7}
        >
          {item.profile_picture_url ? (
            <Image
              source={{ uri: getProfilePictureUrl(item.profile_picture_url) ?? '' }}
              style={styles.avatar}
            />
          ) : (
            <View
              style={[
                styles.avatar,
                styles.avatarPlaceholder,
                { backgroundColor: colors.inputBackground },
              ]}
            >
              <Ionicons name="person-outline" size={20} color={colors.textMuted} />
            </View>
          )}

          <View style={styles.rowContent}>
            <Text weight="semibold" style={[styles.name, { color: colors.text }]} numberOfLines={1}>
              {name}
            </Text>
            {item.referee_rating_label ? (
              <View style={styles.ratingRow}>
                <RatingBadge
                  ratingValue={item.referee_rating_value}
                  ratingLabel={item.referee_rating_label}
                  certificationStatus={badgeStatus}
                  isDark={isDark}
                  size="sm"
                />
              </View>
            ) : null}
          </View>

          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      );
    },
    [colors, isDark, handleRefereePress]
  );

  return (
    <BaseActionSheet
      title={t('profile.rating.referencesList.title')}
      onClose={handleClose}
      flex={false}
    >
      {isLoading ? (
        <View style={styles.stateContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.stateContainer}>
          <Text style={{ color: colors.textMuted }}>
            {t('profile.rating.referencesList.error')}
          </Text>
        </View>
      ) : referees.length === 0 ? (
        <View style={styles.stateContainer}>
          <Ionicons name="people-outline" size={40} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            {t('profile.rating.referencesList.empty')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={referees}
          keyExtractor={item => item.referee_id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </BaseActionSheet>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacingPixels[3],
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.full,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: {
    flex: 1,
  },
  name: {
    fontSize: fontSizePixels.base,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  stateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[8],
    gap: spacingPixels[3],
  },
  emptyText: {
    fontSize: fontSizePixels.sm,
  },
});

export default ReferencesListActionSheet;
