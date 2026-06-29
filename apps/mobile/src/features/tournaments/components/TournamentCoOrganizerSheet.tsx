/**
 * Tournament Co-organizer Sheet
 *
 * Primary-organizer-only roster management: shows the current co-organizers
 * (with remove), and a player search to add new ones. Co-organizers gain full
 * organizer rights and are pulled into the tournament chat automatically (DB
 * trigger). Adding/removing is immediate — no accept step.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  getHumanName,
  getProfilePictureUrl,
} from '@rallia/shared-utils';
import {
  usePlayerSearch,
  useProfilesByIds,
  useTournamentCoOrganizers,
  useAddTournamentCoOrganizer,
  useRemoveTournamentCoOrganizer,
} from '@rallia/shared-hooks';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { SearchBar } from '#/components/SearchBar';
import { useAuth, useThemeStyles, useTranslation } from '#/hooks';

const SHEET_ID = 'tournament-co-organizers';

interface PickerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
}

export function TournamentCoOrganizerActionSheet({
  payload,
}: SheetProps<'tournament-co-organizers'>) {
  const tournamentId = payload?.tournamentId ?? '';
  const sportId = payload?.sportId ?? '';
  const organizerId = payload?.organizerId ?? '';

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { session } = useAuth();
  const toast = useToast();
  const currentUserId = session?.user?.id;

  const [searchQuery, setSearchQuery] = useState('');

  const { data: coOrganizers = [] } = useTournamentCoOrganizers(tournamentId);
  const coOrgUserIds = useMemo(() => coOrganizers.map(c => c.user_id), [coOrganizers]);
  const { data: profiles } = useProfilesByIds(coOrgUserIds);

  const excludeIds = useMemo(
    () => [organizerId, ...coOrgUserIds].filter(Boolean),
    [organizerId, coOrgUserIds]
  );

  const showingSearch = searchQuery.length >= 2;
  const { players, isLoading: isSearching } = usePlayerSearch({
    sportId,
    currentUserId,
    searchQuery,
    excludePlayerIds: excludeIds,
    pageSize: 20,
    enabled: !!sportId && !!currentUserId && showingSearch,
  });

  const addCoOrg = useAddTournamentCoOrganizer({
    onSuccess: () => {
      successHaptic();
      setSearchQuery('');
    },
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('tournamentDetail.coOrganizers.addFailed'));
    },
  });
  const removeCoOrg = useRemoveTournamentCoOrganizer({
    onError: e => {
      warningHaptic();
      toast.error(e.message || t('tournamentDetail.coOrganizers.removeFailed'));
    },
  });

  const handleClose = useCallback(() => {
    void SheetManager.hide(SHEET_ID);
  }, []);

  const handleAdd = useCallback(
    (row: PickerRow) => {
      if (addCoOrg.isPending) return;
      void lightHaptic();
      addCoOrg.mutate({ tournamentId, userId: row.id });
    },
    [addCoOrg, tournamentId]
  );

  const handleRemove = useCallback(
    (userId: string) => {
      if (removeCoOrg.isPending) return;
      void lightHaptic();
      removeCoOrg.mutate({ tournamentId, userId });
    },
    [removeCoOrg, tournamentId]
  );

  const renderResult = useCallback(
    ({ item }: { item: PickerRow }) => {
      const url = getProfilePictureUrl(item.profile_picture_url);
      return (
        <TouchableOpacity
          onPress={() => handleAdd(item)}
          activeOpacity={0.7}
          accessibilityRole="button"
          style={[styles.row, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
        >
          <View style={[styles.avatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
            {url ? (
              <Image source={{ uri: url }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person-outline" size={22} color={colors.textMuted} />
            )}
          </View>
          <Text weight="medium" color={colors.text} numberOfLines={1} style={styles.name}>
            {getHumanName(item, '')}
          </Text>
          <Ionicons name="add-circle" size={24} color={colors.primary} />
        </TouchableOpacity>
      );
    },
    [handleAdd, colors, isDark]
  );

  return (
    <BaseActionSheet title={t('tournamentDetail.coOrganizers.title')} onClose={handleClose} flex={false}>
      <View style={styles.body}>
        <Text size="sm" color={colors.textMuted}>
          {t('tournamentDetail.coOrganizers.hint')}
        </Text>

        {/* Current roster */}
        {coOrganizers.length > 0 && (
          <View style={styles.rosterList}>
            {coOrganizers.map(c => {
              const p = profiles?.[c.user_id];
              const url = getProfilePictureUrl(p?.profile_picture_url ?? null);
              return (
                <View
                  key={c.user_id}
                  style={[styles.row, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
                >
                  <View style={[styles.avatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
                    {url ? (
                      <Image source={{ uri: url }} style={styles.avatarImage} />
                    ) : (
                      <Ionicons name="person-outline" size={22} color={colors.textMuted} />
                    )}
                  </View>
                  <Text weight="medium" color={colors.text} numberOfLines={1} style={styles.name}>
                    {p ? getHumanName(p, '') : '—'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleRemove(c.user_id)}
                    hitSlop={8}
                    accessibilityLabel={t('tournamentDetail.coOrganizers.remove')}
                  >
                    <Ionicons name="close-circle" size={24} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* Add */}
        <Text size="xs" weight="semibold" color={colors.textSecondary} style={styles.addLabel}>
          {t('tournamentDetail.coOrganizers.addLabel')}
        </Text>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('tournamentDetail.coOrganizers.searchPlaceholder')}
          colors={colors}
        />

        {!showingSearch ? (
          <View style={styles.stateContainer}>
            <Ionicons name="search-outline" size={32} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} style={styles.emptyText}>
              {t('tournamentDetail.coOrganizers.searchHint')}
            </Text>
          </View>
        ) : isSearching ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : players.length === 0 ? (
          <View style={styles.stateContainer}>
            <Ionicons name="people-outline" size={32} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} style={styles.emptyText}>
              {t('tournamentDetail.coOrganizers.noResults')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={players as PickerRow[]}
            keyExtractor={r => r.id}
            renderItem={renderResult}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </View>
    </BaseActionSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[6],
    gap: spacingPixels[3],
  },
  rosterList: { gap: spacingPixels[2] },
  addLabel: { textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacingPixels[1] },
  list: { maxHeight: 280 },
  listContent: { gap: spacingPixels[2], paddingBottom: spacingPixels[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: 44, height: 44 },
  name: { flex: 1 },
  stateContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacingPixels[6], gap: spacingPixels[2] },
  emptyText: { textAlign: 'center' },
});
