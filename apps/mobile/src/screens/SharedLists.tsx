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
import { Text, Skeleton, Button } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
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
        <Button
          variant="primary"
          size="md"
          rounded
          onPress={handleCreateList}
          leftIcon={<Ionicons name="add-outline" size={20} color="#fff" />}
          isDark={isDark}
          style={styles.emptyButton}
        >
          {t('sharedLists.createFirstList')}
        </Button>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {/* Search Bar - always visible */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('sharedLists.searchLists')}
        />
      </View>

      {/* Loading state */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          {[1, 2, 3].map(i => (
            <View
              key={i}
              style={[
                styles.skeletonCard,
                {
                  backgroundColor: colors.cardBackground,
                  borderColor: colors.border,
                  shadowColor: isDark ? 'transparent' : '#000',
                },
              ]}
            >
              {/* Top row: icon + title + chevron */}
              <View style={styles.topRow}>
                <Skeleton
                  width={36}
                  height={36}
                  borderRadius={radiusPixels.md}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                />
                <Skeleton
                  width="60%"
                  height={18}
                  borderRadius={4}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  style={{ flex: 1 }}
                />
                <Skeleton
                  width={18}
                  height={18}
                  borderRadius={4}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                />
              </View>
              {/* Info rows */}
              <View style={styles.infoRow}>
                <Skeleton
                  width={14}
                  height={14}
                  borderRadius={2}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                />
                <Skeleton
                  width="70%"
                  height={14}
                  borderRadius={4}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  style={{ marginLeft: spacingPixels[2] }}
                />
              </View>
              <View style={styles.infoRow}>
                <Skeleton
                  width={14}
                  height={14}
                  borderRadius={2}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                />
                <Skeleton
                  width="30%"
                  height={14}
                  borderRadius={4}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  style={{ marginLeft: spacingPixels[2] }}
                />
              </View>
              {/* Action row */}
              <View style={[styles.skeletonActionRow, { borderTopColor: colors.border }]}>
                <Skeleton
                  width="30%"
                  height={14}
                  borderRadius={4}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  style={{ flex: 1 }}
                />
                <Skeleton
                  width="30%"
                  height={14}
                  borderRadius={4}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ))}
        </View>
      ) : (
        /* Lists */
        <FlatList
          data={filteredLists}
          keyExtractor={item => item.id}
          renderItem={renderListItem}
          contentContainerStyle={[
            styles.listContent,
            lists.length === 0 && styles.emptyListContent,
          ]}
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
      )}

      {/* FAB buttons */}
      {lists.length > 0 && (
        <View style={styles.fabContainer}>
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: colors.primary }]}
            onPress={() => {
              if (!guardAction()) return;
              if (playerId) {
                SheetManager.show('share-match', { payload: { playerId } });
              }
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="paper-plane-outline" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: colors.primary }]}
            onPress={handleCreateList}
            activeOpacity={0.8}
          >
            <Ionicons name="add-outline" size={28} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    paddingTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
  },
  skeletonCard: {
    borderRadius: radiusPixels.lg,
    padding: spacingPixels[4],
    marginBottom: spacingPixels[3],
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginBottom: spacingPixels[2],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacingPixels[1],
  },
  skeletonActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacingPixels[2],
    paddingTop: spacingPixels[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacingPixels[2],
  },
  searchContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  listContent: {
    paddingTop: spacingPixels[2],
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
    marginTop: spacingPixels[6],
  },
  fabContainer: {
    position: 'absolute',
    bottom: spacingPixels[6],
    right: spacingPixels[4],
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});

export default SharedLists;
