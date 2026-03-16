/**
 * SharedLists Screen
 *
 * Manages shared contact lists for inviting non-app users to matches.
 * Features:
 * - Create/Edit/Delete shared lists
 * - Add contacts from phone book or manually
 * - View and manage contacts in each list
 * - Share matches with contacts via SMS/Email/WhatsApp
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { SheetManager } from 'react-native-actions-sheet';
import { Text, Skeleton, SkeletonCard } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { primary } from '@rallia/design-system';
import {
  useSharedLists,
  useDeleteSharedList,
  useSharedListsRealtime,
  type SharedContactList,
} from '@rallia/shared-hooks';
import {
  useThemeStyles,
  useAuth,
  useTranslation,
  useRequireOnboarding,
  type TranslationKey,
} from '../hooks';
import type { CommunityStackParamList } from '../navigation/types';
import { SharedListCard } from '../features/shared-lists';
import { SearchBar } from '../components/SearchBar';

type NavigationProp = NativeStackNavigationProp<CommunityStackParamList>;

const SharedLists: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { t } = useTranslation();
  const { guardAction } = useRequireOnboarding();
  const playerId = session?.user?.id;

  // State
  const [searchQuery, setSearchQuery] = useState('');

  // Queries and mutations
  const { data: lists = [], isLoading, isRefetching, refetch } = useSharedLists();
  const deleteListMutation = useDeleteSharedList();

  // Subscribe to real-time updates for shared lists
  useSharedListsRealtime(playerId);

  // Filter lists based on search query
  const filteredLists = useMemo(() => {
    if (!searchQuery.trim()) return lists;
    const query = searchQuery.toLowerCase().trim();
    return lists.filter(
      list =>
        list.name.toLowerCase().includes(query) || list.description?.toLowerCase().includes(query)
    );
  }, [lists, searchQuery]);

  // Refresh handler
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Create list handler
  const handleCreateList = useCallback(() => {
    if (!guardAction()) return;
    lightHaptic();
    SheetManager.show('create-list', { payload: { editingList: null } });
  }, [guardAction]);

  // Edit list handler
  const handleEditList = useCallback((list: SharedContactList) => {
    lightHaptic();
    SheetManager.show('create-list', { payload: { editingList: list } });
  }, []);

  // Delete list handler
  const handleDeleteList = useCallback(
    (list: SharedContactList) => {
      Alert.alert(
        t('sharedLists.deleteList'),
        t('sharedLists.deleteListConfirm', { name: list.name }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteListMutation.mutateAsync(list.id);
              } catch (error) {
                console.error('Failed to delete list:', error);
                Alert.alert(t('common.error'), t('sharedLists.errors.failedToDelete'));
              }
            },
          },
        ]
      );
    },
    [deleteListMutation, t]
  );

  // View list details handler
  const handleViewList = useCallback(
    (list: SharedContactList) => {
      navigation.navigate('SharedListDetail', { listId: list.id, listName: list.name });
    },
    [navigation]
  );

  // Render list item
  const renderListItem = useCallback(
    ({ item }: { item: SharedContactList }) => (
      <SharedListCard
        list={item}
        colors={colors}
        isDark={isDark}
        onPress={() => handleViewList(item)}
        onEdit={() => handleEditList(item)}
        onDelete={() => handleDeleteList(item)}
      />
    ),
    [colors, isDark, handleViewList, handleEditList, handleDeleteList]
  );

  // Render empty state
  const renderEmpty = () => {
    if (isLoading) return null;

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="list-outline" size={64} color={colors.textMuted} />
        <Text size="lg" weight="semibold" color={colors.textMuted} style={styles.emptyTitle}>
          {t('sharedLists.noLists')}
        </Text>
        <Text size="sm" color={colors.textMuted} style={styles.emptyDescription}>
          {t('sharedLists.noListsDescription')}
        </Text>
        <TouchableOpacity
          style={[styles.emptyButton, { backgroundColor: primary[500] }]}
          onPress={handleCreateList}
          activeOpacity={0.8}
        >
          <Ionicons name="add-outline" size={20} color="#fff" />
          <Text size="sm" weight="semibold" color="#fff">
            {t('sharedLists.createFirstList')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.loadingContainer}>
          {/* Share Match CTA Skeleton */}
          <Skeleton
            width="100%"
            height={80}
            borderRadius={radiusPixels.lg}
            backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
            highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
            style={{ marginBottom: spacingPixels[4] }}
          />
          {/* Search Skeleton */}
          <Skeleton
            width="100%"
            height={44}
            borderRadius={radiusPixels.lg}
            backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
            highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
            style={{ marginBottom: spacingPixels[4] }}
          />
          {/* List Items Skeleton */}
          {[1, 2, 3, 4].map(i => (
            <SkeletonCard
              key={i}
              showAvatar={false}
              lines={2}
              backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
              highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
              style={{
                backgroundColor: colors.cardBackground,
                marginBottom: spacingPixels[3],
                borderRadius: radiusPixels.lg,
                padding: spacingPixels[4],
              }}
            />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {/* Share Match CTA - Always visible at top */}
      <TouchableOpacity
        style={[
          styles.shareMatchCta,
          {
            backgroundColor: isDark ? primary[800] : primary[50],
            borderColor: isDark ? primary[700] : primary[200],
          },
        ]}
        onPress={() => {
          if (!guardAction()) return;
          if (playerId) {
            SheetManager.show('share-match', { payload: { playerId } });
          }
        }}
        activeOpacity={0.8}
      >
        <View
          style={[styles.shareMatchIcon, { backgroundColor: isDark ? primary[700] : primary[100] }]}
        >
          <Ionicons name="share-social" size={24} color={isDark ? primary[300] : primary[600]} />
        </View>
        <View style={styles.shareMatchContent}>
          <Text weight="semibold" style={{ color: colors.text }}>
            {t('sharedLists.shareMatch.title')}
          </Text>
          <Text size="sm" style={{ color: colors.textSecondary }}>
            {t('sharedLists.shareMatch.subtitle')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <Text weight="semibold" style={{ color: colors.text }}>
          {t('sharedLists.yourLists')}
        </Text>
        {lists.length > 0 && (
          <TouchableOpacity
            style={[styles.createButton, { backgroundColor: primary[500] }]}
            onPress={handleCreateList}
            activeOpacity={0.8}
          >
            <Ionicons name="add-outline" size={18} color="#fff" />
            <Text size="sm" weight="semibold" color="#fff">
              {t('sharedLists.newList')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search Bar - only show when there are lists */}
      {lists.length > 0 && (
        <View style={styles.searchContainer}>
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('sharedLists.searchLists')}
          />
        </View>
      )}

      {/* Lists */}
      <FlatList
        data={filteredLists}
        keyExtractor={item => item.id}
        renderItem={renderListItem}
        contentContainerStyle={[styles.listContent, lists.length === 0 && styles.emptyListContent]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    padding: spacingPixels[4],
  },
  shareMatchCta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[3],
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  shareMatchIcon: {
    width: 48,
    height: 48,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  shareMatchContent: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[1],
  },
  searchContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  listContent: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[4],
  },
  emptyListContent: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[8],
  },
  emptyTitle: {
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  emptyDescription: {
    marginTop: spacingPixels[2],
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[6],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});

export default SharedLists;
