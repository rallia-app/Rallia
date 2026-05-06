import React, { useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import { Text, Skeleton } from '@rallia/shared-components';
import { supabase, Logger } from '@rallia/shared-services';
import { useCommunityFavoriteFacilities } from '@rallia/shared-hooks';
import { selectionHaptic } from '@rallia/shared-utils';
import { useThemeStyles, useTranslation } from '../hooks';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
} from '@rallia/design-system';
import type { TranslationKey } from '@rallia/shared-translations';
import TennisCourtIcon from '../../assets/icons/tennis-court.svg';

interface NetworkFavoriteFacilitiesProps {
  networkId: string;
  currentPlayerId: string | null;
  sportId: string;
  latitude: number | null;
  longitude: number | null;
  translationPrefix: 'groups' | 'community';
  onNavigateToFacility?: (facilityId: string) => void;
}

function formatDistance(meters: number | null): string {
  if (meters === null) return '';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export const NetworkFavoriteFacilities: React.FC<NetworkFavoriteFacilitiesProps> = ({
  networkId,
  currentPlayerId,
  sportId,
  latitude,
  longitude,
  translationPrefix,
  onNavigateToFacility,
}) => {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const { favorites, loading, canManage, refetch } = useCommunityFavoriteFacilities(
    networkId,
    currentPlayerId,
    latitude,
    longitude
  );

  const handleEdit = useCallback(() => {
    selectionHaptic();
    SheetManager.show('favorite-facilities', {
      payload: {
        sportId,
        latitude,
        longitude,
        initialFacilityIds: favorites.map(f => f.facilityId),
        minFavorites: 0,
        onSave: async (facilityIds: string[]) => {
          try {
            const currentIds = new Set(favorites.map(f => f.facilityId));
            const newIds = new Set(facilityIds);

            // Remove facilities no longer selected
            for (const fav of favorites) {
              if (!newIds.has(fav.facilityId)) {
                await supabase.from('network_favorite_facility').delete().eq('id', fav.id);
              }
            }

            // Add newly selected facilities and update display order
            let order = 1;
            for (const facilityId of facilityIds) {
              if (!currentIds.has(facilityId)) {
                await supabase.from('network_favorite_facility').insert({
                  network_id: networkId,
                  facility_id: facilityId,
                  display_order: order,
                });
              } else {
                const existing = favorites.find(f => f.facilityId === facilityId);
                if (existing && existing.displayOrder !== order) {
                  await supabase
                    .from('network_favorite_facility')
                    .update({ display_order: order })
                    .eq('id', existing.id);
                }
              }
              order++;
            }

            refetch();
          } catch (error) {
            Logger.error('Failed to save network favorite facilities', error as Error, {
              networkId,
            });
          }
        },
      },
    });
  }, [sportId, latitude, longitude, favorites, networkId, refetch]);

  const skeletonBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const skeletonHighlight = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.02)';

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <TennisCourtIcon width={20} height={20} stroke={colors.textSecondary} />
          </View>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t(`${translationPrefix}.favoriteFacilities` as TranslationKey)}
          </Text>
        </View>
        {canManage && (
          <TouchableOpacity style={styles.editButton} onPress={handleEdit}>
            <Ionicons name="create-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Loading State */}
      {loading && favorites.length === 0 ? (
        <View style={styles.facilitiesList}>
          {[1, 2, 3].map(i => (
            <Skeleton
              key={i}
              width="100%"
              height={70}
              borderRadius={radiusPixels.lg}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
            />
          ))}
        </View>
      ) : favorites.length > 0 ? (
        /* Facility Cards */
        <View style={styles.facilitiesList}>
          {favorites.map(fav => (
            <TouchableOpacity
              key={fav.id}
              style={[
                styles.facilityCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={
                onNavigateToFacility ? () => onNavigateToFacility(fav.facilityId) : undefined
              }
              activeOpacity={onNavigateToFacility ? 0.7 : 1}
            >
              <View style={styles.facilityCardContent}>
                <View style={styles.facilityNameRow}>
                  <Text style={[styles.facilityName, { color: colors.text }]} numberOfLines={1}>
                    {fav.facility.name}
                  </Text>
                </View>

                {(fav.facility.address || fav.facility.city) && (
                  <View style={styles.facilityInfoRow}>
                    <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                    <Text
                      style={[styles.facilityAddress, { color: colors.textMuted }]}
                      numberOfLines={1}
                    >
                      {[fav.facility.address, fav.facility.city].filter(Boolean).join(', ')}
                    </Text>
                  </View>
                )}

                <View style={styles.facilityDetailsRow}>
                  {fav.distanceMeters !== null && (
                    <View style={styles.facilityDetailItem}>
                      <Ionicons name="navigate-outline" size={14} color={colors.textMuted} />
                      <Text style={[styles.facilityDetailText, { color: colors.textMuted }]}>
                        {formatDistance(fav.distanceMeters)}
                      </Text>
                    </View>
                  )}
                  {fav.courtCount > 0 && (
                    <View style={styles.facilityDetailItem}>
                      <Ionicons name="grid-outline" size={14} color={colors.textMuted} />
                      <Text style={[styles.facilityDetailText, { color: colors.textMuted }]}>
                        {fav.courtCount} {fav.courtCount === 1 ? 'court' : 'courts'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        /* Empty State — moderators see the "Add facilities" call-to-action,
           non-moderators see only the headline */
        <View style={[styles.emptyState, { borderColor: colors.border }]}>
          <Ionicons name="location-outline" size={32} color={colors.textMuted} />
          <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
            {t(`${translationPrefix}.noFavoriteFacilities` as TranslationKey)}
          </Text>
          {canManage && (
            <Text style={[styles.emptyStateHint, { color: colors.textMuted }]}>
              {t(`${translationPrefix}.addFavoriteFacilitiesHint` as TranslationKey)}
            </Text>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingPixels[3],
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  countBadge: {
    fontSize: 12,
    fontWeight: '500',
  },
  editButton: {
    padding: spacingPixels[1],
  },
  facilitiesList: {
    gap: spacingPixels[3],
  },
  facilityCard: {
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  facilityCardContent: {
    flex: 1,
  },
  facilityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  facilityName: {
    fontSize: fontSizePixels.base,
    fontWeight: fontWeightNumeric.semibold as any,
    flex: 1,
  },
  facilityInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginBottom: spacingPixels[1],
  },
  facilityAddress: {
    fontSize: fontSizePixels.sm,
    flex: 1,
  },
  facilityDetailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[4],
    marginTop: spacingPixels[1],
  },
  facilityDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  facilityDetailText: {
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacingPixels[4],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radiusPixels.lg,
  },
  emptyStateText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: spacingPixels[2],
  },
  emptyStateHint: {
    fontSize: 12,
    marginTop: spacingPixels[1],
    textAlign: 'center',
  },
});

export default NetworkFavoriteFacilities;
