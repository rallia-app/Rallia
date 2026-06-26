/**
 * League Invite Players Sheet
 *
 * Organizer-side intra-app invite: search community players who play the
 * league's sport, multi-select, and send league invitations (each becomes a
 * 'pending' membership the invitee accepts). Mirrors the tournament invite flow.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native';
import { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import {
  lightHaptic,
  successHaptic,
  warningHaptic,
  getHumanName,
  getProfilePictureUrl,
} from '@rallia/shared-utils';
import { usePlayerSearch, useInviteLeagueMembers } from '@rallia/shared-hooks';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { SearchBar } from '#/components/SearchBar';
import { useAuth, useThemeStyles, useTranslation } from '#/hooks';

const SHEET_ID = 'league-invite-players';

interface PickerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
}

export function LeagueInvitePlayersActionSheet({ payload }: SheetProps<'league-invite-players'>) {
  const leagueId = payload?.leagueId ?? '';
  const sportId = payload?.sportId ?? '';
  const excludeUserIds = useMemo(() => payload?.excludeUserIds ?? [], [payload?.excludeUserIds]);

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { session } = useAuth();
  const toast = useToast();
  const currentUserId = session?.user?.id;

  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<Map<string, PickerRow>>(new Map());

  const showingSearch = searchQuery.length >= 2;
  const { players, isLoading: isSearching } = usePlayerSearch({
    sportId,
    currentUserId,
    searchQuery,
    excludePlayerIds: excludeUserIds,
    pageSize: 20,
    enabled: !!sportId && !!currentUserId && showingSearch,
  });

  const invite = useInviteLeagueMembers(leagueId, {
    onSuccess: count => {
      void SheetManager.hide(SHEET_ID).then(() => {
        successHaptic();
        toast.success(
          count > 0
            ? t('leagueDetail.invitePlayers.sentToast').replace('{count}', String(count))
            : t('leagueDetail.invitePlayers.noneToast')
        );
      });
    },
    onError: e => {
      warningHaptic();
      Alert.alert(
        t('leagueDetail.invitePlayers.title'),
        e.message || t('leagueDetail.invitePlayers.failed')
      );
    },
  });

  const handleClose = useCallback(() => {
    void SheetManager.hide(SHEET_ID);
  }, []);

  const handleToggle = useCallback((row: PickerRow) => {
    void lightHaptic();
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });
  }, []);

  const handleSend = useCallback(() => {
    if (selected.size === 0 || invite.isPending) return;
    void lightHaptic();
    invite.mutate([...selected.keys()]);
  }, [selected, invite]);

  const renderRow = useCallback(
    ({ item }: { item: PickerRow }) => {
      const isSelected = selected.has(item.id);
      const url = getProfilePictureUrl(item.profile_picture_url);
      return (
        <TouchableOpacity
          onPress={() => handleToggle(item)}
          activeOpacity={0.7}
          accessibilityRole="button"
          testID={`league-invite-row-${item.id}`}
          style={[
            styles.playerRow,
            {
              backgroundColor: isSelected ? `${colors.primary}15` : colors.cardBackground,
              borderColor: isSelected ? colors.primary : colors.border,
            },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}>
            {url ? (
              <Image source={{ uri: url }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person-outline" size={22} color={colors.textMuted} />
            )}
          </View>
          <View style={styles.playerInfo}>
            <Text weight="medium" color={colors.text} numberOfLines={1}>
              {getHumanName(item, '')}
            </Text>
          </View>
          <Ionicons
            name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
            size={24}
            color={isSelected ? colors.primary : colors.textMuted}
          />
        </TouchableOpacity>
      );
    },
    [selected, handleToggle, colors, isDark]
  );

  return (
    <BaseActionSheet
      title={t('leagueDetail.invitePlayers.title')}
      onClose={handleClose}
      flex={false}
    >
      <View style={styles.body}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('leagueDetail.invitePlayers.searchPlaceholder')}
          colors={colors}
          style={styles.searchBar}
          testID="league-invite-search-input"
        />

        {!showingSearch ? (
          <View style={styles.stateContainer}>
            <Ionicons name="search-outline" size={36} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} style={styles.emptyText}>
              {t('leagueDetail.invitePlayers.searchHint')}
            </Text>
          </View>
        ) : isSearching ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : players.length === 0 ? (
          <View style={styles.stateContainer}>
            <Ionicons name="people-outline" size={36} color={colors.textMuted} />
            <Text size="sm" color={colors.textMuted} style={styles.emptyText}>
              {t('leagueDetail.invitePlayers.noResults')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={players as PickerRow[]}
            keyExtractor={r => r.id}
            renderItem={renderRow}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}

        <Button
          variant="primary"
          onPress={handleSend}
          disabled={selected.size === 0 || invite.isPending}
          testID="league-invite-send"
        >
          {invite.isPending
            ? t('leagueDetail.invitePlayers.sending')
            : selected.size > 0
              ? t('leagueDetail.invitePlayers.sendCta').replace('{count}', String(selected.size))
              : t('leagueDetail.invitePlayers.sendCtaEmpty')}
        </Button>
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
  searchBar: { marginBottom: spacingPixels[1] },
  list: { maxHeight: 340 },
  listContent: { gap: spacingPixels[2], paddingBottom: spacingPixels[2] },
  playerRow: {
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
  avatarImage: { width: 44, height: 44, borderRadius: 22 },
  playerInfo: { flex: 1, minWidth: 0 },
  stateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[8],
    gap: spacingPixels[2],
  },
  emptyText: { textAlign: 'center', paddingHorizontal: spacingPixels[6] },
});

export default LeagueInvitePlayersActionSheet;
