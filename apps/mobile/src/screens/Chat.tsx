/**
 * Chat Screen (Inbox)
 * Shows all conversations the user is part of with tabbed sections:
 * - Direct Messages: User-to-user chats (not linked to matches) + manually created group chats
 * - Groups & Communities: Chats linked to networks (groups/communities)
 * - Match Chats: Chats linked to matches (both singles and doubles)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  useThemeStyles,
  useAuth,
  useTranslation,
  useRequireOnboarding,
  useTourSequence,
  type TranslationKey,
} from '../hooks';
import { useActionsSheet, useSport } from '../context';
import { SportIcon } from '../components/SportIcon';
import { CopilotStep, WalkthroughableView } from '../context/TourContext';
import SignInPrompt from '../components/SignInPrompt';
import { FeedbackFAB } from '../components/BugReportFAB';
import { SearchBar } from '../components/SearchBar';
import {
  spacingPixels,
  fontSizePixels,
  primary,
  neutral,
  radiusPixels,
} from '@rallia/design-system';
import {
  usePlayerConversations,
  useConversationsRealtime,
  useTogglePinConversation,
  useToggleMuteConversation,
  useToggleArchiveConversation,
  useUpdateLastSeen,
  useBlockedUserIds,
  useFavoriteUserIds,
  useMarkMessagesAsDelivered,
  type ConversationPreview,
} from '@rallia/shared-hooks';
import {
  ConversationItem,
  ChatFiltersBar,
  DEFAULT_CHAT_FILTERS,
  type ChatFilters,
} from '../features/chat';
import { SheetManager } from 'react-native-actions-sheet';
import { useAppNavigation, useChatNavigation } from '../navigation/hooks';

type TabKey = 'direct' | 'groups' | 'matches';

const TAB_CONFIGS: { key: TabKey; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'direct', icon: 'chatbubble-outline' },
  { key: 'groups', icon: 'people-outline' },
  { key: 'matches', icon: 'tennisball-outline' }, // Rendered as SportIcon when key === 'matches'
];

const Chat = () => {
  const { colors, isDark } = useThemeStyles();
  const insets = useSafeAreaInsets();
  const rootNavigation = useAppNavigation();
  const chatNavigation = useChatNavigation();
  const { session, isAuthenticated, loading: isLoadingAuth } = useAuth();
  const { t } = useTranslation();
  const { openSheet } = useActionsSheet();
  const { selectedSport } = useSport();
  const { guardAction, isReady: isOnboarded } = useRequireOnboarding();
  const playerId = session?.user?.id;
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('direct');
  const [chatFilters, setChatFilters] = useState<ChatFilters>(DEFAULT_CHAT_FILTERS);

  // Chat screen tour - triggers after main navigation tour is completed
  const { shouldShowTour: _shouldShowChatTour } = useTourSequence({
    screenId: 'chat',
    isReady: !!playerId,
    delay: 800,
    autoStart: true,
  });

  // Track selected conversation for action handlers
  const [selectedConversation, setSelectedConversation] = useState<ConversationPreview | null>(
    null
  );
  const [showActionsSheet, setShowActionsSheet] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);

  const {
    data: conversations,
    isLoading,
    refetch,
    isRefetching,
  } = usePlayerConversations(playerId);

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

  // Fetch favorite user IDs for filtering by favorites
  const { data: favoriteUserIds = new Set<string>() } = useFavoriteUserIds(playerId);

  // Mark messages as delivered when conversations are loaded
  const { mutate: markAsDelivered } = useMarkMessagesAsDelivered();

  // Mark messages as delivered for all conversations with unread messages
  // This runs whenever conversations change (including realtime updates)
  useEffect(() => {
    if (!playerId || !conversations || conversations.length === 0) return;

    // Mark messages as delivered for conversations with unread messages
    // The RPC function is idempotent - only updates messages with status 'sent'
    conversations.forEach(conv => {
      if (conv.unread_count > 0) {
        markAsDelivered({
          conversationId: conv.id,
          recipientId: playerId,
        });
      }
    });
  }, [conversations, playerId, markAsDelivered]);

  // Check if any chat filter is active (used for empty state messages)
  const _hasActiveChatFilters = chatFilters.blocked || chatFilters.unread || chatFilters.favorites;

  // Reset chat filters handler
  const handleResetFilters = useCallback(() => {
    setChatFilters(DEFAULT_CHAT_FILTERS);
  }, []);

  // Categorize conversations into tabs
  const categorizedConversations = useMemo(() => {
    if (!conversations) return { direct: [], groups: [], matches: [] };

    const direct: ConversationPreview[] = [];
    const groups: ConversationPreview[] = [];
    const matches: ConversationPreview[] = [];

    conversations.forEach(conv => {
      // Match chats: has match_id (both direct and group types)
      if (conv.match_id) {
        matches.push(conv);
      }
      // Groups & Communities: networks with type 'player_group', 'club', or 'community'
      else if (
        conv.network_type &&
        ['player_group', 'club', 'community'].includes(conv.network_type)
      ) {
        groups.push(conv);
      }
      // Direct chats: direct messages not linked to matches + manually created groups (network_type = 'friends')
      else {
        direct.push(conv);
      }
    });

    return { direct, groups, matches };
  }, [conversations]);

  // Get unread message counts for each tab (excluding archived)
  const tabCounts = useMemo(() => {
    return {
      direct: categorizedConversations.direct
        .filter(c => !c.is_archived)
        .reduce((sum, c) => sum + (c.unread_count || 0), 0),
      groups: categorizedConversations.groups
        .filter(c => !c.is_archived)
        .reduce((sum, c) => sum + (c.unread_count || 0), 0),
      matches: categorizedConversations.matches
        .filter(c => !c.is_archived)
        .reduce((sum, c) => sum + (c.unread_count || 0), 0),
    };
  }, [categorizedConversations]);

  // Filter conversations based on active tab, search query, chat filters and exclude archived
  const { filteredConversations, archivedCount } = useMemo(() => {
    if (!conversations) return { filteredConversations: [], archivedCount: 0 };

    // Count total archived conversations across all categories
    const archivedCount = conversations.filter(c => c.is_archived).length;

    // Get conversations for active tab
    let tabConversations = categorizedConversations[activeTab];

    // Apply chat filters (only for direct messages tab where we have other_participant)
    if (
      chatFilters.blocked ||
      chatFilters.unread ||
      chatFilters.favorites ||
      chatFilters.archived ||
      chatFilters.muted ||
      chatFilters.pinned
    ) {
      tabConversations = tabConversations.filter(conversation => {
        // For blocked filter - show only conversations with blocked users (direct chats only)
        if (chatFilters.blocked) {
          if (conversation.conversation_type === 'direct' && conversation.other_participant?.id) {
            return blockedUserIds.has(conversation.other_participant.id);
          }
          return false; // Non-direct chats don't match blocked filter
        }

        // For unread filter - show only conversations with unread messages
        if (chatFilters.unread) {
          return (conversation.unread_count || 0) > 0;
        }

        // For favorites filter - show only conversations with favorite users (direct chats only)
        if (chatFilters.favorites) {
          if (conversation.conversation_type === 'direct' && conversation.other_participant?.id) {
            return favoriteUserIds.has(conversation.other_participant.id);
          }
          return false; // Non-direct chats don't match favorites filter
        }

        // For archived filter - show only archived conversations
        if (chatFilters.archived) {
          return conversation.is_archived === true;
        }

        // For muted filter - show only muted conversations
        if (chatFilters.muted) {
          return conversation.is_muted === true;
        }

        // For pinned filter - show only pinned conversations
        if (chatFilters.pinned) {
          return conversation.is_pinned === true;
        }

        return true;
      });
    }

    // When searching, search across current tab only (after applying chat filters)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      const filtered = tabConversations.filter(conversation => {
        // Don't include archived in search results (unless archived filter is active)
        if (conversation.is_archived && !chatFilters.archived) return false;

        // Search by conversation title (group name)
        if (conversation.title?.toLowerCase().includes(query)) {
          return true;
        }
        // Search by other participant name (for direct messages)
        if (conversation.other_participant) {
          const firstName = conversation.other_participant.first_name?.toLowerCase() || '';
          const lastName = conversation.other_participant.last_name?.toLowerCase() || '';
          const fullName = `${firstName} ${lastName}`.trim();
          if (firstName.includes(query) || lastName.includes(query) || fullName.includes(query)) {
            return true;
          }
        }
        // Search by match info (for match chats)
        if (conversation.match_info) {
          const sportName = conversation.match_info.sport_name?.toLowerCase() || '';
          if (sportName.includes(query)) {
            return true;
          }
        }
        return false;
      });
      return { filteredConversations: filtered, archivedCount };
    }

    // Filter out archived conversations for normal view (unless archived filter is active)
    if (chatFilters.archived) {
      // When archived filter is active, we've already filtered to only archived ones
      return { filteredConversations: tabConversations, archivedCount };
    }

    const filtered = tabConversations.filter(c => !c.is_archived);
    return { filteredConversations: filtered, archivedCount };
  }, [
    conversations,
    categorizedConversations,
    activeTab,
    searchQuery,
    chatFilters,
    blockedUserIds,
    favoriteUserIds,
  ]);

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
          // Refetch conversations to include the new group
          refetch();
          // Navigate to the new conversation
          rootNavigation.navigate('ChatConversation', {
            conversationId,
            title: undefined, // Will be loaded from conversation
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
        title: conversation.title || undefined,
      });
    },
    [rootNavigation]
  );

  const handleConversationLongPress = useCallback(
    (conversation: ConversationPreview) => {
      selectionHaptic();
      setSelectedConversation(conversation);

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
      // Check if the other user in a direct chat is blocked
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

    // Show different message when filter is active
    if (chatFilters.blocked) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="ban-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('chat.filters.emptyBlocked')}
          </Text>
        </View>
      );
    }

    if (chatFilters.unread) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="mail-open-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('chat.filters.emptyUnread')}
          </Text>
        </View>
      );
    }

    if (chatFilters.favorites) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="star-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('chat.filters.emptyFavorites')}
          </Text>
        </View>
      );
    }

    if (chatFilters.archived) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="archive-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('chat.filters.emptyArchived')}
          </Text>
        </View>
      );
    }

    if (chatFilters.muted) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="volume-mute-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('chat.filters.emptyMuted')}
          </Text>
        </View>
      );
    }

    if (chatFilters.pinned) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="pin-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            {t('chat.filters.emptyPinned')}
          </Text>
        </View>
      );
    }

    // Tab-specific empty messages
    const emptyMessages = {
      direct: {
        icon: 'chatbubble-outline' as keyof typeof Ionicons.glyphMap,
        title: t('chat.empty.direct.title'),
        subtitle: t('chat.empty.direct.subtitle'),
      },
      groups: {
        icon: 'people-outline' as keyof typeof Ionicons.glyphMap,
        title: t('chat.empty.groups.title'),
        subtitle: t('chat.empty.groups.subtitle'),
      },
      matches: {
        icon: 'tennisball-outline' as keyof typeof Ionicons.glyphMap,
        title: t('chat.empty.matches.title'),
        subtitle: t('chat.empty.matches.subtitle'),
      },
    };

    const { icon, title, subtitle } = emptyMessages[activeTab];

    return (
      <View style={styles.emptyContainer}>
        {activeTab === 'matches' ? (
          <SportIcon
            sportName={selectedSport?.name ?? 'tennis'}
            size={64}
            color={colors.textMuted}
          />
        ) : (
          <Ionicons name={icon} size={64} color={colors.textMuted} />
        )}
        <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>{subtitle}</Text>
      </View>
    );
  }, [isLoading, colors, searchQuery, activeTab, t, selectedSport?.name, chatFilters]);

  const renderSeparator = useCallback(
    () => <View style={[styles.separator, { backgroundColor: colors.border }]} />,
    [colors]
  );

  // Render full list header with header, search, filters, tabs, and archived row
  const renderListHeader = useCallback(() => {
    return (
      <>
        {/* Header */}
        <View style={styles.header}>
          <Text size="xl" weight="bold" color={colors.text}>
            {t('chat.inbox')}
          </Text>
        </View>

        {/* Search bar - Wrapped with CopilotStep for tour */}
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

        {/* Chat Filters Bar - below search, before tabs */}
        <ChatFiltersBar
          filters={chatFilters}
          onFiltersChange={setChatFilters}
          onReset={handleResetFilters}
        />

        {/* Tab Bar - Wrapped with CopilotStep for tour */}
        <CopilotStep text={t('tour.chatScreen.tabs.description')} order={31} name="chat_tabs">
          <WalkthroughableView
            style={[styles.tabContainer, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}
          >
            {TAB_CONFIGS.map(tab => {
              const isActive = activeTab === tab.key;
              const count = tabCounts[tab.key];
              const label = t(`chat.tabs.${tab.key}`);
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[
                    styles.tab,
                    isActive && [styles.activeTab, { backgroundColor: colors.cardBackground }],
                  ]}
                  onPress={() => {
                    selectionHaptic();
                    setActiveTab(tab.key);
                  }}
                  activeOpacity={0.7}
                >
                  {tab.key === 'matches' ? (
                    <SportIcon
                      sportName={selectedSport?.name ?? 'tennis'}
                      size={18}
                      color={isActive ? colors.primary : colors.textMuted}
                      style={styles.tabIcon}
                    />
                  ) : (
                    <Ionicons
                      name={tab.icon}
                      size={18}
                      color={isActive ? colors.primary : colors.textMuted}
                      style={styles.tabIcon}
                    />
                  )}
                  <Text
                    size="sm"
                    weight={isActive ? 'semibold' : 'medium'}
                    style={[
                      styles.tabLabel,
                      { color: isActive ? colors.primary : colors.textMuted },
                    ]}
                  >
                    {label}
                  </Text>
                  {count > 0 && (
                    <View
                      style={[
                        styles.tabBadge,
                        { backgroundColor: isActive ? colors.primary : neutral[400] },
                      ]}
                    >
                      <Text style={styles.tabBadgeText}>{count > 99 ? '99+' : count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </WalkthroughableView>
        </CopilotStep>

        {/* Archived chats row */}
        {!searchQuery.trim() && archivedCount > 0 && (
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
                <Text style={[styles.archivedText, { color: colors.text }]}>
                  {t('chat.archived')}
                </Text>
              </View>
              <View style={styles.archivedBadge}>
                <Text style={[styles.archivedCount, { color: colors.textMuted }]}>
                  {archivedCount}
                </Text>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
            <View style={[styles.separator, { backgroundColor: colors.border }]} />
          </>
        )}
      </>
    );
  }, [
    searchQuery,
    archivedCount,
    colors,
    isDark,
    handleArchivedPress,
    t,
    chatFilters,
    handleResetFilters,
    activeTab,
    tabCounts,
    selectedSport?.name,
  ]);

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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {/* Full-screen scrollable list with header, search, filters, tabs */}
      <FlatList
        data={isLoading ? [] : filteredConversations}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={renderListHeader}
        ItemSeparatorComponent={renderSeparator}
        ListEmptyComponent={
          isLoading ? (
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
            renderEmpty()
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={[primary[500]]}
            tintColor={primary[500]}
          />
        }
        contentContainerStyle={
          !isLoading && filteredConversations?.length === 0 && archivedCount === 0
            ? styles.emptyListContent
            : undefined
        }
        keyboardShouldPersistTaps="handled"
      />

      {/* FAB Container - Bug Report + New Group */}
      <View
        style={[
          styles.fabContainer,
          {
            bottom: Platform.OS === 'android' ? insets.bottom + 16 : 16,
            right: spacingPixels[5],
          },
        ]}
      >
        <FeedbackFAB />
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: primary[500] }]}
          onPress={handleNewGroupPress}
          activeOpacity={0.8}
        >
          <Ionicons name="add-outline" size={28} color="#fff" />
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
    alignItems: 'center',
    gap: 12,
  },
  fab: {
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
    marginLeft: 66 + spacingPixels[4], // Avatar width + container padding
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
  emptyListContent: {
    flex: 1,
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
  // Tab bar styles (pill container – matches Communities)
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  activeTab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabIcon: {
    marginRight: 6,
  },
  tabLabel: {
    fontSize: fontSizePixels.sm,
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacingPixels[1],
    paddingHorizontal: spacingPixels[1],
  },
  tabBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    ...(Platform.OS === 'android' && { textAlignVertical: 'center' as const }),
  },
});

export default Chat;
