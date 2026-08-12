/**
 * Chat Screen (Inbox)
 * Shows all conversations the user is part of in a single merged list.
 * A unified filter chip row replaces the former tab bar — single-select chips
 * cover chat types (direct, match, group chat, group, community) and status
 * (unread, pinned, favorites, muted, blocked). The "Archived" chip navigates
 * to the dedicated ArchivedChats screen.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, Text, SkeletonConversation } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { getConversationDisplayName } from '@rallia/shared-services';
import { spacingPixels, fontSizePixels, primary, secondary } from '@rallia/design-system';
import {
  useFilteredConversations,
  usePlayerConversations,
  useConversationsRealtime,
  useTogglePinConversation,
  useToggleMuteConversation,
  useToggleArchiveConversation,
  useBlockedUserIds,
  useFavoriteUserIds,
  useMarkMessagesAsDelivered,
  chatKeys,
  type ConversationPreview,
} from '@rallia/shared-hooks';
import type { ChatInboxFilter, ConversationFilter } from '@rallia/shared-types';
import { SheetManager } from 'react-native-actions-sheet';

import {
  useThemeStyles,
  useAuth,
  useTranslation,
  useRequireOnboarding,
  useTourSequence,
} from '#/hooks';
import { useActionsSheet, useSport } from '#/context';
import { CopilotStep, WalkthroughableView } from '#/context/TourContext';
import SignInPrompt from '#/components/SignInPrompt';
import { SearchBar } from '#/components/SearchBar';
import { ConversationItem, ConversationFilterChips } from '#/features/chat';
import { useAppNavigation, useChatNavigation } from '#/navigation/hooks';

const SERVER_FILTERS = new Set<ChatInboxFilter>([
  'all',
  'unread',
  'direct',
  'group_chat',
  'community',
  'match',
  'tournament',
]);

const STATUS_FILTERS = new Set<ChatInboxFilter>(['pinned', 'favorites', 'muted', 'blocked']);

const Chat = () => {
  const { colors, isDark } = useThemeStyles();

  const rootNavigation = useAppNavigation();
  const chatNavigation = useChatNavigation();
  const { session, isAuthenticated, loading: isLoadingAuth } = useAuth();
  const { t } = useTranslation();
  const { openSheet } = useActionsSheet();
  const { selectedSport } = useSport();
  const { guardAction, isReady: isOnboarded } = useRequireOnboarding();
  const playerId = session?.user?.id;
  const [searchQuery, setSearchQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<ChatInboxFilter>('all');
  const isManualRefresh = useRef(false);

  // Chat screen tour - triggers after main navigation tour is completed
  const { shouldShowTour: _shouldShowChatTour } = useTourSequence({
    screenId: 'chat',
    isReady: !!playerId,
    delay: 800,
    autoStart: true,
  });

  const serverFilter: ConversationFilter = SERVER_FILTERS.has(inboxFilter)
    ? (inboxFilter as ConversationFilter)
    : 'all';

  const {
    conversations,
    isLoading,
    refetch,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useFilteredConversations({
    playerId,
    sportId: selectedSport?.id,
    filter: serverFilter,
    limit: 50,
  });

  // Secondary query just to count archived conversations for the pressable row
  const { data: allConversations } = usePlayerConversations(playerId, selectedSport?.id);
  const archivedCount = useMemo(
    () => (allConversations ?? []).filter(c => c.is_archived).length,
    [allConversations]
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Subscribe to real-time updates. This screen stays mounted app-wide
  // (tab preload + freezeOnBlur), so while it's blurred realtime events only
  // mark the conversation list stale instead of refetching the heavy list RPC.
  const isFocused = useIsFocused();
  useConversationsRealtime(playerId, { isScreenVisible: isFocused });

  // Refetch anything the blurred-state events marked stale when the user
  // actually returns to the inbox.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!isFocused || !playerId) return;
    void queryClient.refetchQueries({
      queryKey: chatKeys.playerConversations(playerId),
      type: 'active',
      stale: true,
    });
  }, [isFocused, playerId, queryClient]);

  // Mutations for conversation actions
  const { mutate: togglePin } = useTogglePinConversation();
  const { mutate: toggleMute } = useToggleMuteConversation();
  const { mutate: toggleArchive } = useToggleArchiveConversation();

  // Fetch blocked / favorite user IDs to drive the client-side status filters
  const { data: blockedUserIds = new Set<string>() } = useBlockedUserIds(playerId);
  const { data: favoriteUserIds = new Set<string>() } = useFavoriteUserIds(playerId);

  // Mark messages as delivered when conversations are loaded
  const { mutate: markAsDelivered } = useMarkMessagesAsDelivered();

  // conv.id → last_message_at already marked delivered. Without this guard,
  // any refetch of the list re-fired one delivery mutation per unread
  // conversation, even for conversations with no new messages.
  const deliveredRef = useRef(new Map<string, string | null>());
  useEffect(() => {
    if (!playerId || !conversations || conversations.length === 0) return;
    conversations.forEach(conv => {
      if (conv.unread_count > 0 && deliveredRef.current.get(conv.id) !== conv.last_message_at) {
        deliveredRef.current.set(conv.id, conv.last_message_at);
        markAsDelivered({
          conversationId: conv.id,
          recipientId: playerId,
        });
      }
    });
  }, [conversations, playerId, markAsDelivered]);

  // Filter conversations: client-side status predicates + search + always-hide-archived
  const filteredConversations = useMemo(() => {
    if (!conversations) return [];

    let list: ConversationPreview[] = conversations.filter(c => !c.is_archived);

    if (STATUS_FILTERS.has(inboxFilter)) {
      list = list.filter(conversation => {
        switch (inboxFilter) {
          case 'pinned':
            return conversation.is_pinned === true;
          case 'muted':
            return conversation.is_muted === true;
          case 'favorites':
            return (
              conversation.conversation_type === 'direct' &&
              !!conversation.other_participant?.id &&
              favoriteUserIds.has(conversation.other_participant.id)
            );
          case 'blocked':
            return (
              conversation.conversation_type === 'direct' &&
              !!conversation.other_participant?.id &&
              blockedUserIds.has(conversation.other_participant.id)
            );
          default:
            return true;
        }
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      list = list.filter(conversation => {
        if (conversation.title?.toLowerCase().includes(query)) return true;
        if (conversation.other_participant) {
          const firstName = conversation.other_participant.first_name?.toLowerCase() || '';
          const lastName = conversation.other_participant.last_name?.toLowerCase() || '';
          const fullName = `${firstName} ${lastName}`.trim();
          if (firstName.includes(query) || lastName.includes(query) || fullName.includes(query)) {
            return true;
          }
        }
        if (conversation.match_info) {
          const sportName = conversation.match_info.sport_name?.toLowerCase() || '';
          if (sportName.includes(query)) return true;
        }
        return false;
      });
    }

    return list;
  }, [conversations, inboxFilter, searchQuery, blockedUserIds, favoriteUserIds]);

  // Navigate to archived chats (wired to the Archived chip and any other entry points)
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
          refetch();
          rootNavigation.navigate('ChatConversation', {
            conversationId,
            title: undefined,
          });
        },
      },
    });
  }, [guardAction, refetch, rootNavigation]);

  const handleConversationPress = useCallback(
    (conversation: ConversationPreview) => {
      lightHaptic();
      rootNavigation.navigate('ChatConversation', {
        conversationId: conversation.id,
        title: getConversationDisplayName(conversation, t as (key: string) => string),
      });
    },
    [rootNavigation, t]
  );

  const handleConversationLongPress = useCallback(
    (conversation: ConversationPreview) => {
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

    let icon: React.ComponentProps<typeof Ionicons>['name'] = 'chatbubbles-outline';
    let title: string;
    let description: string | undefined;

    if (searchQuery.trim()) {
      icon = 'search-outline';
      title = t('common.noResultsFound');
      description = t('common.tryDifferentSearch');
    } else {
      switch (inboxFilter) {
        case 'blocked':
          icon = 'ban-outline';
          title = t('chat.filters.emptyBlocked');
          break;
        case 'favorites':
          icon = 'heart-outline';
          title = t('chat.filters.emptyFavorites');
          break;
        case 'muted':
          icon = 'volume-mute-outline';
          title = t('chat.filters.emptyMuted');
          break;
        case 'pinned':
          icon = 'pin-outline';
          title = t('chat.filters.emptyPinned');
          break;
        case 'unread':
          icon = 'mail-open-outline';
          title = t('chat.filters.emptyUnread');
          break;
        case 'all':
          title = t('chat.noConversations');
          description = t('chat.noConversationsSubtitle');
          break;
        default:
          // Type filter (direct / match / group_chat / community)
          title = t('chat.emptyFiltered.title');
          description = t('chat.emptyFiltered.description');
      }
    }

    return (
      <View style={styles.emptyContainer}>
        <EmptyState
          icon={<Ionicons name={icon} size={64} color={colors.primary} />}
          title={title}
          description={description}
        />
      </View>
    );
  }, [isLoading, colors, searchQuery, inboxFilter, t]);

  const renderSeparator = useCallback(
    () => <View style={[styles.separator, { backgroundColor: colors.border }]} />,
    [colors]
  );

  const renderListHeader = useCallback(() => {
    return (
      <>
        <View style={styles.header}>
          <Text size="xl" weight="bold" color={colors.text}>
            {t('chat.inbox')}
          </Text>
        </View>

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

        <CopilotStep text={t('tour.chatScreen.filters.description')} order={31} name="chat_filters">
          <WalkthroughableView>
            <ConversationFilterChips filter={inboxFilter} onFilterChange={setInboxFilter} />
          </WalkthroughableView>
        </CopilotStep>

        {!searchQuery.trim() && archivedCount > 0 && (
          <TouchableOpacity
            style={styles.archivedRow}
            onPress={handleArchivedPress}
            activeOpacity={0.6}
          >
            <Ionicons name="archive-outline" size={16} color={colors.textMuted} />
            <Text style={[styles.archivedText, { color: colors.textMuted }]}>
              {t('chat.archived')}
            </Text>
            <View style={styles.archivedTrailing}>
              <Text style={[styles.archivedCount, { color: colors.textMuted }]}>
                {archivedCount}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
        )}
      </>
    );
  }, [searchQuery, colors, t, inboxFilter, archivedCount, handleArchivedPress]);

  if (isLoadingAuth) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <View style={styles.authLoadingContainer}>
          <ActivityIndicator size="large" color={primary[500]} />
        </View>
      </SafeAreaView>
    );
  }

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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <FlatList
        data={isLoading ? [] : filteredConversations}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={renderListHeader()}
        ItemSeparatorComponent={renderSeparator}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingContainer}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(i => (
                <SkeletonConversation
                  key={i}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  style={{ paddingHorizontal: spacingPixels[4] }}
                />
              ))}
            </View>
          ) : (
            renderEmpty()
          )
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={primary[500]} />
            </View>
          ) : null
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && isManualRefresh.current}
            onRefresh={() => {
              isManualRefresh.current = true;
              refetch().finally(() => {
                isManualRefresh.current = false;
              });
            }}
            colors={[primary[500]]}
            tintColor={primary[500]}
          />
        }
        contentContainerStyle={
          !isLoading && filteredConversations.length === 0 ? styles.emptyListContent : undefined
        }
        keyboardShouldPersistTaps="handled"
      />

      <View style={styles.fabContainer}>
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: secondary[500] }]}
          onPress={handleNewGroupPress}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
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
  searchContainer: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[2],
  },
  searchBar: {
    width: '100%',
  },
  fabContainer: {
    position: 'absolute',
    bottom: spacingPixels[6],
    right: spacingPixels[4],
    alignItems: 'center',
    gap: 12,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerLoader: {
    paddingVertical: spacingPixels[4],
    alignItems: 'center',
  },
  separator: {
    height: 1,
    marginLeft: 66 + spacingPixels[4],
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[2.5],
  },
  archivedText: {
    flex: 1,
    fontSize: fontSizePixels.sm,
    fontWeight: '500',
  },
  archivedTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  archivedCount: {
    fontSize: fontSizePixels.sm,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyListContent: {
    flexGrow: 1,
  },
});

export default Chat;
