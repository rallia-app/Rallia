/**
 * Tournament Partner Picker Sheet
 *
 * Doubles registration: the captain picks their partner before the pair is
 * registered. Shows the caller's recent doubles teammates up front, with a
 * community player search behind a query. Selecting a player arms the footer
 * CTA; confirming hands {id, name} back to the caller, who runs the actual
 * registration mutation.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { SheetManager, SheetProps, FlatList } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button, EmptyState } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, getHumanName, getProfilePictureUrl } from '@rallia/shared-utils';
import { usePlayerSearch, useRecentDoublesPartners } from '@rallia/shared-hooks';

import { BaseActionSheet } from '#/components/BaseActionSheet';
import { SearchBar } from '#/components/SearchBar';
import { useAuth, useThemeStyles, useTranslation } from '#/hooks';

const SHEET_ID = 'tournament-partner-picker';

interface PickerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  profile_picture_url: string | null;
}

export function TournamentPartnerPickerActionSheet({
  payload,
}: SheetProps<'tournament-partner-picker'>) {
  const sportId = payload?.sportId ?? '';
  const onPick = payload?.onPick;
  const onDismiss = payload?.onDismiss;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const { session } = useAuth();
  const currentUserId = session?.user?.id;

  const didPickRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<PickerRow | null>(null);

  const { data: recentPartners = [], isLoading: isLoadingRecent } = useRecentDoublesPartners(
    currentUserId,
    sportId
  );

  // Runs with an empty query too, which returns the sport's players (the RPC
  // excludes the caller). That is what keeps the picker from opening empty:
  // "recent partners" only knows about doubles games whose score was submitted,
  // because team_number — the only way to tell a teammate from an opponent — is
  // assigned at score submission. A player with unscored doubles games, or none,
  // has no recents at all, which is the common case.
  const { players, isLoading: isSearching } = usePlayerSearch({
    sportId,
    currentUserId,
    searchQuery,
    pageSize: 20,
    enabled: !!sportId && !!currentUserId,
  });

  const isSearchQuery = searchQuery.length >= 2;
  // Recents lead when we have them; otherwise fall straight through to the
  // browsable list rather than showing an empty sheet.
  const showingRecents = !isSearchQuery && recentPartners.length > 0;
  const rows: PickerRow[] = useMemo(
    () => (showingRecents ? recentPartners : players),
    [showingRecents, players, recentPartners]
  );

  const handleClose = useCallback(() => {
    void SheetManager.hide(SHEET_ID);
  }, []);

  const handleSheetClose = useCallback(() => {
    if (!didPickRef.current) onDismiss?.();
    didPickRef.current = false;
  }, [onDismiss]);

  const handleSelect = useCallback((row: PickerRow) => {
    void lightHaptic();
    setSelected(prev => (prev?.id === row.id ? null : row));
  }, []);

  const handleConfirm = useCallback(() => {
    if (!selected) return;
    void lightHaptic();
    didPickRef.current = true;
    const name = getHumanName(selected, '');
    void SheetManager.hide(SHEET_ID).then(() => {
      onPick?.({ id: selected.id, name });
    });
  }, [selected, onPick]);

  const renderRow = useCallback(
    ({ item }: { item: PickerRow }) => {
      const isSelected = selected?.id === item.id;
      const url = getProfilePictureUrl(item.profile_picture_url);
      return (
        <TouchableOpacity
          onPress={() => handleSelect(item)}
          activeOpacity={0.7}
          accessibilityRole="button"
          testID={`partner-row-${item.id}`}
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
          {isSelected && <Ionicons name="checkmark-circle" size={24} color={colors.primary} />}
        </TouchableOpacity>
      );
    },
    [selected, handleSelect, colors, isDark]
  );

  // Only spin for the list actually being rendered: while recents are still
  // resolving we can't yet know which of the two lists that is.
  const isLoading = isLoadingRecent || (!showingRecents && isSearching);

  return (
    <BaseActionSheet
      title={t('tournamentDetail.partner.title')}
      onClose={handleClose}
      onSheetClose={handleSheetClose}
      flex={false}
    >
      <View style={styles.body}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('tournamentDetail.partner.searchPlaceholder')}
          colors={colors}
          style={styles.searchBar}
          testID="partner-search-input"
        />

        {!isSearchQuery && rows.length > 0 ? (
          <Text size="xs" weight="semibold" color={colors.textMuted} style={styles.sectionHeader}>
            {t(
              showingRecents
                ? 'tournamentDetail.partner.recentHeader'
                : 'tournamentDetail.partner.browseHeader'
            ).toUpperCase()}
          </Text>
        ) : null}

        {isLoading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : rows.length === 0 ? (
          <EmptyState
            variant="sheet"
            icon={<Ionicons name="search-outline" size={36} color={colors.primary} />}
            title={t(
              isSearchQuery
                ? 'tournamentDetail.partner.noResults'
                : 'tournamentDetail.partner.empty'
            )}
          />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={r => r.id}
            renderItem={renderRow}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}

        <Button
          variant="primary"
          onPress={handleConfirm}
          disabled={!selected}
          testID="partner-confirm"
        >
          {selected
            ? t('tournamentDetail.partner.confirmCta').replace('{name}', getHumanName(selected, ''))
            : t('tournamentDetail.partner.confirmCtaEmpty')}
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
  searchBar: {
    marginBottom: spacingPixels[1],
  },
  sectionHeader: {
    letterSpacing: 1,
  },
  list: {
    maxHeight: 360,
  },
  listContent: {
    gap: spacingPixels[2],
    paddingBottom: spacingPixels[2],
  },
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
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  playerInfo: {
    flex: 1,
    minWidth: 0,
  },
  stateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[8],
    gap: spacingPixels[2],
  },
});

export default TournamentPartnerPickerActionSheet;
