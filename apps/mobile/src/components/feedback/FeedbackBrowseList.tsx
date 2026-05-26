/**
 * FeedbackBrowseList
 *
 * Browse-first entry point for the feedback sheet. Shows a category
 * segmented control (Bugs / Features), a debounced search input, an
 * upvotable list of public reports, and a sticky CTA to start a new
 * report.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import {
  base,
  darkTheme,
  lightTheme,
  neutral,
  radiusPixels,
  secondary,
  spacingPixels,
} from '@rallia/design-system';
import {
  useDebounce,
  useFeedbackBrowse,
  useTheme,
  useToggleFeedbackVote,
} from '@rallia/shared-hooks';
import type { PublicFeedback, PublicFeedbackCategory } from '@rallia/shared-services';
import { selectionHaptic } from '@rallia/shared-utils';

import { useActionsSheet } from '#/context';
import { useTranslation, type TranslationKey } from '#/hooks';

import { FeedbackListItem } from './FeedbackListItem';
import { FeedbackListItemSkeleton } from './FeedbackListItemSkeleton';

interface FeedbackBrowseListProps {
  category: PublicFeedbackCategory;
  onCategoryChange: (cat: PublicFeedbackCategory) => void;
  onSelectItem: (item: PublicFeedback) => void;
  onCreate: () => void;
  playerId: string | null | undefined;
}

const SKELETON_ROWS = 4;

const CATEGORY_TABS: Array<{
  value: PublicFeedbackCategory;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
}> = [
  { value: 'bug', icon: 'bug-outline', labelKey: 'feedback.browse.tabs.bugs' },
  { value: 'feature', icon: 'bulb-outline', labelKey: 'feedback.browse.tabs.features' },
];

export const FeedbackBrowseList: React.FC<FeedbackBrowseListProps> = ({
  category,
  onCategoryChange,
  onSelectItem,
  onCreate,
  playerId,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { openSheet: openAuthSheet } = useActionsSheet();
  const isDark = theme === 'dark';
  const themeColors = isDark ? darkTheme : lightTheme;

  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebounce(searchText, 300);

  const {
    items,
    isLoading,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refresh,
  } = useFeedbackBrowse({ category, playerId, search: debouncedSearch });

  const toggleVote = useToggleFeedbackVote();

  const handleTabPress = useCallback(
    (next: PublicFeedbackCategory) => {
      if (next === category) return;
      void selectionHaptic();
      onCategoryChange(next);
    },
    [category, onCategoryChange]
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleToggleVote = useCallback(
    (item: PublicFeedback) => {
      if (!playerId) {
        openAuthSheet();
        return;
      }
      toggleVote.mutate({
        feedbackId: item.id,
        wasVoted: item.has_voted,
        playerId,
      });
    },
    [playerId, openAuthSheet, toggleVote]
  );

  const colors = {
    text: themeColors.foreground,
    muted: themeColors.mutedForeground,
    border: themeColors.border,
    card: themeColors.card,
    inputBg: isDark ? neutral[800] : neutral[50],
    tabInactive: isDark ? neutral[800] : neutral[100],
  };

  const renderItem = useCallback(
    ({ item }: { item: PublicFeedback }) => (
      <FeedbackListItem
        item={item}
        onPress={() => onSelectItem(item)}
        onToggleVote={() => handleToggleVote(item)}
        isDark={isDark}
        textColor={colors.text}
        mutedColor={colors.muted}
        borderColor={colors.border}
        cardColor={colors.card}
      />
    ),
    [onSelectItem, handleToggleVote, isDark, colors.text, colors.muted, colors.border, colors.card]
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.centered}>
        <Ionicons
          name={category === 'bug' ? 'bug-outline' : 'bulb-outline'}
          size={42}
          color={colors.muted}
        />
        <Text size="sm" color={colors.muted} style={styles.emptyText}>
          {t(
            (category === 'bug'
              ? 'feedback.browse.empty.bug'
              : 'feedback.browse.empty.feature') as TranslationKey
          )}
        </Text>
      </View>
    ),
    [category, colors.muted, t]
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <ActivityIndicator color={secondary[500]} style={{ marginVertical: spacingPixels[3] }} />
    );
  }, [isFetchingNextPage]);

  return (
    <View style={styles.root}>
      {/* Tabs */}
      <View style={styles.tabsRow}>
        {CATEGORY_TABS.map(tab => {
          const isActive = category === tab.value;
          return (
            <TouchableOpacity
              key={tab.value}
              activeOpacity={0.7}
              onPress={() => handleTabPress(tab.value)}
              style={[
                styles.tab,
                {
                  backgroundColor: isActive ? secondary[500] : colors.tabInactive,
                  borderColor: isActive ? secondary[500] : colors.border,
                },
              ]}
            >
              <Ionicons name={tab.icon} size={16} color={isActive ? base.white : colors.muted} />
              <Text
                size="sm"
                weight={isActive ? 'semibold' : 'regular'}
                color={isActive ? base.white : colors.text}
              >
                {t(tab.labelKey as TranslationKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Search */}
      <View
        style={[styles.searchWrap, { backgroundColor: colors.inputBg, borderColor: colors.border }]}
      >
        <Ionicons name="search-outline" size={18} color={colors.muted} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder={t('feedback.browse.searchPlaceholder')}
          placeholderTextColor={colors.muted}
          style={[styles.searchInput, { color: colors.text }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {isLoading && items.length === 0 ? (
        <View style={styles.skeletonList}>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <FeedbackListItemSkeleton
              key={i}
              isDark={isDark}
              borderColor={colors.border}
              cardColor={colors.card}
            />
          ))}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          contentContainerStyle={[
            styles.scrollContent,
            items.length === 0 && styles.emptyListContent,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor={colors.muted}
            />
          }
        />
      )}

      {/* Sticky CTA */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Text size="xs" color={colors.muted} style={styles.footerHint}>
          {t('feedback.browse.dontSeeYours')}
        </Text>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onCreate}
          style={[styles.createBtn, { backgroundColor: secondary[500] }]}
        >
          <Ionicons name="add" size={18} color={base.white} />
          <Text size="base" weight="semibold" color={base.white}>
            {t('feedback.browse.submitNew')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[3],
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1.5],
    paddingVertical: spacingPixels[2.5],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  scrollContent: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[6],
  },
  emptyListContent: {
    flexGrow: 1,
  },
  skeletonList: {
    flex: 1,
    padding: spacingPixels[4],
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[10],
    gap: spacingPixels[3],
  },
  emptyText: {
    textAlign: 'center',
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    gap: spacingPixels[2],
  },
  footerHint: {
    textAlign: 'center',
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3.5],
    borderRadius: radiusPixels.lg,
  },
});

export default FeedbackBrowseList;
