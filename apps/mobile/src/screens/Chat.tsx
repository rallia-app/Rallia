/**
 * Chat Screen (Inbox)
 * Shows all conversations with WhatsApp-style filter chips for:
 * All, Unread, Direct, Group Chats, Player Groups, Communities, Clubs, Matches.
 * Uses server-side filtering and infinite scroll pagination.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Text, SkeletonConversation } from '@rallia/shared-components';
import { lightHaptic, selectionHaptic } from '@rallia/shared-utils';
import { getSafeAreaEdges } from '../utils';
import {
  useThemeStyles,
  useAuth,
  useTranslation,
  useRequireOnboarding,
  useTourSequence,
  type TranslationKey,
} from '../hooks';
import { useActionsSheet } from '../context';
import { CopilotStep, WalkthroughableView } from '../context/TourContext';
import SignInPrompt from '../components/SignInPrompt';
import { SearchBar } from '../components/SearchBar';
import { spacingPixels, fontSizePixels, fontWeightNumeric, primary } from '@rallia/design-system';
import {
  usePlayerConversations,
  useFilteredConversations,
  useConversationFilter,
  useUnreadConversationsCount,
  useConversationsRealtime,
  useTogglePinConversation,
  useToggleMuteConversation,
  useToggleArchiveConversation,
  useUpdateLastSeen,
  useBlockedUserIds,
  useDebounce,
  type ConversationPreview,
} from '@rallia/shared-hooks';
import { ConversationItem, ConversationFilterChips } from '../features/chat';
import { SheetManager } from 'react-native-actions-sheet';
import { useAppNavigation, useChatNavigation } from '../navigation/hooks';

const Chat = () => {
  const { colors, isDark } = useThemeStyles();
  const insets = useSafeAreaInsets();
  const rootNavigation = useAppNavigation();
  const chatNavigation = useChatNavigation();
  const { session, isAuthenticated, loading: isLoadingAuth } = useAuth();
  const { t } = useTranslation();
  const { openSheet } = useActionsSheet();
  const { guardAction, isReady: isOnboarded } = useRequireOnboarding();
  const playerId = session?.user?.id;
  const [searchQuery, setSearchQuery] = useState('');
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Filter state
  const { filter, toggleFilter } = useConversationFilter();

  // Chat screen tour
  const { shouldShowTour: _shouldShowChatTour } = useTourSequence({
    screenId: 'chat',
    isReady: !!playerId,
    delay: 800,
    autoStart: true,
  });

  // Filtered + paginated conversations
  const { conversations, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useFilteredConversations({
      playerId,
      filter,
      search: debouncedSearch,
      limit: 20,
      enabled: !!playerId,
    });

  // Unread conversations count for badge
  const { data: unreadConversationsCount } = useUnreadConversationsCount(playerId);

  // Keep usePlayerConversations for archived count (data is cached, no extra fetch)
  const { data: allConversations } = usePlayerConversations(playerId);
  const archivedCount = useMemo(
    () => (allConversations ?? []).filter(c => c.is_archived).length,
    [allConversations]
  );

  // Subscribe to real-time updates
  useConversationsRealtime(playerId);

  // Update last seen for online status tracking
  useUpdateLastSeen(playerId);

  // Mutations for conversation actions
  const { mutate: togglePin } = useTogglePinConversation();
  const { mutate: toggleMute } = useToggleMuteConversation();
  const { mutate: toggleArchive } = useToggleArchiveConversation();

  // Fetch blocked user IDs to show "You blocked this user" in conversation preview
  const { data: blockedUserIds = new Set<string>() } = useBlockedUserIds(playerId);

  // Pull-to-refresh handler (only this sets the spinner, not background refetches)
  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [refetch]);

  // Handle load more for infinite scroll
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Navigate to archived chats
  const handleArchivedPress = useCallback(() => {
    lightHaptic();
    chatNavigation.navigate('ArchivedChats');
  }, [chatNavigation]);

  // Handle new group button press
  const handleNewGroupPress = useCallback(() => {
    if (!guardAction()) return;
    lightHaptic();
    SheetManager.show('create-group-chat', {
      payload: {
        onSuccess: (conversationId: string) => {
          rootNavigation.navigate('ChatConversation', {
            conversationId,
            title: undefined,
          });
        },
      },
    });
  }, [guardAction, rootNavigation]);

  const handleConversationPress = useCallback(
    (conversation: ConversationPreview) => {
      lightHaptic();
      rootNavigation.navigate('ChatConversation', {
        conversationId: conversation.id,
        title: conversation.title || undefined,
      });
    },
    [rootNavigation]
  );

  const handleConversationLongPress = useCallback(
    (conversation: ConversationPreview) => {
      selectionHaptic();

      SheetManager.show('conversation-actions', {
        payload: {
          conversation,
          onTogglePin: () => {
            if (!playerId) return;
            togglePin({
              conversationId: conversation.id,
              playerId,
              isPinned: !conversation.is_pinned,
            });
          },
          onToggleMute: () => {
            if (!playerId) return;
            toggleMute({
              conversationId: conversation.id,
              playerId,
              isMuted: !conversation.is_muted,
            });
          },
          onToggleArchive: () => {
            if (!playerId) return;
            toggleArchive({
              conversationId: conversation.id,
              playerId,
              isArchived: !conversation.is_archived,
            });
          },
        },
      });
    },
    [playerId, togglePin, toggleMute, toggleArchive]
  );

  const renderItem = useCallback(
    ({ item }: { item: ConversationPreview }) => {
      const isOtherUserBlocked = Boolean(
        item.conversation_type === 'direct' &&
        item.other_participant?.id &&
        blockedUserIds.has(item.other_participant.id)
      );

      return (
        <ConversationItem
          conversation={item}
          onPress={() => handleConversationPress(item)}
          onLongPress={() => handleConversationLongPress(item)}
          isBlocked={isOtherUserBlocked}
        />
      );
    },
    [handleConversationPress, handleConversationLongPress, blockedUserIds]
  );

  const keyExtractor = useCallback((item: ConversationPreview) => item.id, []);

  const renderEmpty = useCallback(() => {
    if (isLoading) return null;

    // Show different message when searching vs no conversations
    if (searchQuery.trim()) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('common.noResultsFound')}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            {t('common.tryDifferentSearch')}
          </Text>
        </View>
      );
    }

    // Filter-specific empty state
    if (filter !== 'all') {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="filter-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('chat.emptyFiltered.title')}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            {t('chat.emptyFiltered.description')}
          </Text>
        </View>
      );
    }

    // Default empty state
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="chatbubbles-outline" size={64} color={colors.textMuted} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          {t('chat.empty.direct.title')}
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
          {t('chat.empty.direct.subtitle')}
        </Text>
      </View>
    );
  }, [isLoading, colors, searchQuery, filter, t]);

  const renderSeparator = useCallback(
    () => <View style={[styles.separator, { backgroundColor: colors.border }]} />,
    [colors]
  );

  // Render archived chats row at the top of the list
  const renderListHeader = useCallback(() => {
    if (searchQuery.trim() || archivedCount === 0) return null;

    return (
      <>
        <TouchableOpacity
          style={styles.archivedRow}
          onPress={handleArchivedPress}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.archivedIconContainer,
              { backgroundColor: isDark ? colors.card : '#F0F0F0' },
            ]}
          >
            <Ionicons name="archive-outline" size={20} color={colors.textMuted} />
          </View>
          <View style={styles.archivedContent}>
            <Text style={[styles.archivedText, { color: colors.text }]}>{t('chat.archived')}</Text>
          </View>
          <View style={styles.archivedBadge}>
            <Text style={[styles.archivedCount, { color: colors.textMuted }]}>{archivedCount}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </View>
        </TouchableOpacity>
        <View style={[styles.separator, { backgroundColor: colors.border }]} />
      </>
    );
  }, [searchQuery, archivedCount, colors, isDark, handleArchivedPress, t]);

  // Render footer loading indicator for pagination
  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={primary[500]} />
      </View>
    );
  }, [isFetchingNextPage]);

  // Show loading spinner while auth state is being determined
  if (isLoadingAuth) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.authLoadingContainer}>
          <ActivityIndicator size="large" color={primary[500]} />
        </View>
      </SafeAreaView>
    );
  }

  // Show sign-in prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <SignInPrompt
        variant="chat"
        title={t('chat.signInRequired')}
        description={t('chat.signInPrompt')}
        buttonText={t('auth.signIn')}
        onSignIn={openSheet}
      />
    );
  }

  // Show onboarding prompt if authenticated but not onboarded
  if (!isOnboarded) {
    return (
      <SignInPrompt
        variant="chat"
        title={t('chat.onboardingRequired')}
        description={t('chat.onboardingPrompt')}
        buttonText={t('chat.completeOnboarding')}
        onSignIn={openSheet}
        icon="person-add"
      />
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={getSafeAreaEdges(['top'])}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.headerForeground }]}>
          {t('chat.inbox')}
        </Text>
      </View>

      {/* Search bar */}
      <CopilotStep text={t('tour.chatScreen.search.description')} order={30} name="chat_search">
        <WalkthroughableView style={styles.searchContainer}>
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('chat.searchConversations')}
            style={styles.searchBar}
          />
        </WalkthroughableView>
      </CopilotStep>

      {/* Filter Chips */}
      <CopilotStep text={t('tour.chatScreen.tabs.description')} order={31} name="chat_filters">
        <WalkthroughableView>
          <ConversationFilterChips
            filter={filter}
            onFilterToggle={toggleFilter}
            unreadCount={unreadConversationsCount ?? 0}
          />
        </WalkthroughableView>
      </CopilotStep>

      {/* Content - Conversations List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          {[1, 2, 3, 4, 5, 6].map(i => (
            <SkeletonConversation
              key={i}
              backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
              highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
              style={{ paddingHorizontal: spacingPixels[4] }}
            />
          ))}
        </View>
      ) : (
        <FlatList
          data={conversations}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={renderListHeader}
          ItemSeparatorComponent={renderSeparator}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={handleManualRefresh}
              colors={[primary[500]]}
              tintColor={primary[500]}
            />
          }
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* New group FAB */}
      <TouchableOpacity
        style={[
          styles.fab,
          {
            backgroundColor: primary[500],
            bottom: Platform.OS === 'android' ? insets.bottom + 16 : 16,
            right: spacingPixels[5],
          },
        ]}
        onPress={handleNewGroupPress}
        activeOpacity={0.8}
      >
        <Ionicons name="add-outline" size={28} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  authLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  headerTitle: {
    fontSize: fontSizePixels.lg,
    fontWeight: String(fontWeightNumeric.semibold) as '600',
  },
  searchContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[2],
  },
  searchBar: {
    width: '100%',
  },
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: {
    height: 1,
    marginLeft: 66 + spacingPixels[4],
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
  },
  archivedIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archivedContent: {
    flex: 1,
    marginLeft: spacingPixels[3],
  },
  archivedText: {
    fontSize: fontSizePixels.base,
    fontWeight: '500',
  },
  archivedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  archivedCount: {
    fontSize: fontSizePixels.sm,
    marginRight: spacingPixels[1],
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[8],
  },
  listContent: {
    flexGrow: 1,
  },
  emptyTitle: {
    fontSize: fontSizePixels.lg,
    fontWeight: '600',
    marginTop: spacingPixels[4],
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: fontSizePixels.base,
    marginTop: spacingPixels[2],
    textAlign: 'center',
  },
  footerLoader: {
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
  },
});

export default Chat;
