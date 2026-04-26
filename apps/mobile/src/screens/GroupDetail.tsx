/**
 * GroupDetail Screen
 * Shows group details with tabs: Home, Leaderboard, Games
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Modal,
  Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import Svg, { Circle } from 'react-native-svg';
import { Text, Button } from '@rallia/shared-components';
import { lightHaptic, selectionHaptic, mediumHaptic, getShortName } from '@rallia/shared-utils';
import {
  useGroupWithMembers,
  useGroupStats,
  useGroupActivity,
  useIsGroupModerator,
  useLeaveGroup,
  useDeleteGroup,
  useGroupRealtime,
  useScoreConfirmationsRealtime,
  useConversationUnreadCount,
  useConversationUnreadCountLast7Days,
  useConversationUnreadRealtime,
  useSports,
  usePlayer,
  type GroupActivity as GroupActivityType,
  type GroupMatch,
} from '@rallia/shared-hooks';
import { SheetManager } from 'react-native-actions-sheet';
import {
  primary,
  secondary,
  status,
  neutral,
  spacingPixels,
  fontSizePixels,
  radiusPixels,
} from '@rallia/design-system';

import {
  useThemeStyles,
  useAuth,
  useTranslation,
  useNavigateToPlayerProfile,
  useRequireOnboarding,
} from '../hooks';
import { useSport } from '../context';
import { SportIcon } from '../components/SportIcon';
import type { RootStackParamList } from '../navigation/types';
import {
  AddScoreIntroModal,
  AddScoreModal,
  PendingScoresSection,
  type MatchType,
} from '../features/matches';
import { NetworkFavoriteFacilities } from '../components/NetworkFavoriteFacilities';
import { NetworkLeaderboardTab, NetworkMatchesTab } from '../features/matches/components';

const HEADER_HEIGHT = 140;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type GroupDetailRouteProp = RouteProp<RootStackParamList, 'GroupDetail'>;

type TabKey = 'leaderboard' | 'games';

const TAB_KEYS: TabKey[] = ['games', 'leaderboard'];

const TAB_ICONS: Record<TabKey, keyof typeof Ionicons.glyphMap> = {
  leaderboard: 'podium-outline',
  games: 'tennisball-outline', // placeholder, overridden with SportIcon
};

export default function GroupDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<GroupDetailRouteProp>();
  const { groupId, fromChat } = route.params;

  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { t, locale } = useTranslation();
  const { guardAction } = useRequireOnboarding();
  const { selectedSport } = useSport();
  const { sports } = useSports();
  const { player } = usePlayer();
  const playerId = session?.user?.id;
  const navigateToPlayerProfile = useNavigateToPlayerProfile();
  const insets = useSafeAreaInsets();

  // Get all sport IDs and names for displaying sport tags on facilities
  const { allSportIds, sportNames } = useMemo(() => {
    if (!sports || sports.length === 0) {
      return { allSportIds: [] as string[], sportNames: [] as string[] };
    }
    return {
      allSportIds: sports.map(s => s.id),
      sportNames: sports.map(s => s.name.charAt(0).toUpperCase() + s.name.slice(1)),
    };
  }, [sports]);

  const [activeTab, setActiveTab] = useState<TabKey>('games');
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  // Add Score flow state
  const [showAddScoreIntro, setShowAddScoreIntro] = useState(false);
  const [showAddScoreModal, setShowAddScoreModal] = useState(false);
  const [selectedMatchType, setSelectedMatchType] = useState<MatchType>('single');
  const [hasSeenAddScoreIntro, setHasSeenAddScoreIntro] = useState<boolean | null>(null);

  // Storage key for "never show intro again"
  const ADD_SCORE_INTRO_KEY = 'rallia_add_score_intro_dismissed';

  // Check if user has dismissed the intro before
  useEffect(() => {
    const checkIntroDismissed = async () => {
      try {
        const dismissed = await AsyncStorage.getItem(ADD_SCORE_INTRO_KEY);
        setHasSeenAddScoreIntro(dismissed === 'true');
      } catch (error) {
        console.error('Error reading intro preference:', error);
        setHasSeenAddScoreIntro(false);
      }
    };
    checkIntroDismissed();
  }, []);

  const { data: group, isLoading, refetch } = useGroupWithMembers(groupId);
  const { data: stats } = useGroupStats(groupId);
  const { data: activities } = useGroupActivity(groupId, 50);
  const { data: isModerator } = useIsGroupModerator(groupId, playerId);

  // Get unread message count for the group chat badge (all unread)
  const { data: unreadChatCount } = useConversationUnreadCount(
    group?.conversation_id ?? undefined,
    playerId
  );

  // Get unread message count for the last 7 days stats section
  const { data: unreadChatCountLast7Days } = useConversationUnreadCountLast7Days(
    group?.conversation_id ?? undefined,
    playerId
  );

  // Subscribe to real-time updates for this group
  useGroupRealtime(groupId, playerId);
  // Subscribe to real-time score confirmation updates
  useScoreConfirmationsRealtime(playerId);
  // Subscribe to real-time chat updates for unread count badge
  useConversationUnreadRealtime(group?.conversation_id ?? undefined, playerId);

  const leaveGroupMutation = useLeaveGroup();
  const deleteGroupMutation = useDeleteGroup();

  const handleOpenChat = useCallback(() => {
    if (!group?.conversation_id) return;
    if (!guardAction()) return;
    lightHaptic();
    navigation.navigate('ChatConversation', {
      conversationId: group.conversation_id,
      title: group.name,
    });
  }, [group, guardAction, navigation]);

  const handleMatchTypeSelect = useCallback((type: MatchType) => {
    selectionHaptic();
    setSelectedMatchType(type);
    setShowAddScoreModal(true);
  }, []);

  const handleAddGame = useCallback(() => {
    if (!guardAction()) return;
    mediumHaptic();
    // Check if user has seen the intro before
    if (hasSeenAddScoreIntro === false) {
      // First time - show the intro
      setShowAddScoreIntro(true);
    } else {
      // User has dismissed intro before - go directly to match type
      SheetManager.show('match-type', { payload: { onSelect: handleMatchTypeSelect } });
    }
  }, [guardAction, hasSeenAddScoreIntro, handleMatchTypeSelect]);

  const handleAddScoreIntroComplete = useCallback(() => {
    setShowAddScoreIntro(false);
    SheetManager.show('match-type', { payload: { onSelect: handleMatchTypeSelect } });
  }, [handleMatchTypeSelect]);

  const handleAddScoreSuccess = useCallback(
    (_matchId: string) => {
      setShowAddScoreModal(false);
      refetch(); // Refresh group data including leaderboard
    },
    [refetch]
  );

  const handleLeaveGroup = useCallback(() => {
    Alert.alert(t('groups.leaveGroup'), t('groups.confirmations.leave'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.leave'),
        style: 'destructive',
        onPress: async () => {
          if (!playerId) return;
          try {
            await leaveGroupMutation.mutateAsync({ groupId, playerId });
            navigation.goBack();
          } catch (error) {
            Alert.alert(
              t('common.error'),
              error instanceof Error ? error.message : t('groups.errors.failedToLeave')
            );
          }
        },
      },
    ]);
  }, [groupId, playerId, leaveGroupMutation, navigation, t]);

  const handleDeleteGroup = useCallback(() => {
    Alert.alert(t('groups.deleteGroup'), t('groups.confirmations.delete'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          if (!playerId) return;
          try {
            await deleteGroupMutation.mutateAsync({ groupId, playerId });
            navigation.goBack();
          } catch (error) {
            Alert.alert(
              t('common.error'),
              error instanceof Error ? error.message : t('groups.errors.failedToDelete')
            );
          }
        },
      },
    ]);
  }, [groupId, playerId, deleteGroupMutation, navigation, t]);

  // Build options for the menu modal (must be before handleShowOptions)
  const menuOptions = useMemo(() => {
    const isCreator = group?.created_by === playerId;
    const options: {
      id: string;
      label: string;
      icon: keyof typeof Ionicons.glyphMap;
      onPress: () => void;
      destructive?: boolean;
    }[] = [];

    // Share invite link - available to all members
    options.push({
      id: 'invite',
      label: t('groups.options.shareInviteLink'),
      icon: 'link-outline',
      onPress: () =>
        SheetManager.show('invite-link', {
          payload: {
            groupId,
            groupName: group?.name ?? '',
            currentUserId: playerId ?? '',
            isModerator: isModerator ?? false,
          },
        }),
    });

    if (isModerator && group) {
      options.push({
        id: 'edit',
        label: t('groups.options.editGroup'),
        icon: 'create-outline',
        onPress: () =>
          SheetManager.show('edit-group', {
            payload: { group, onSuccess: () => refetch() },
          }),
      });
    }

    options.push({
      id: 'leave',
      label: t('groups.options.leaveGroup'),
      icon: 'exit-outline',
      onPress: handleLeaveGroup,
      destructive: true,
    });

    if (isCreator) {
      options.push({
        id: 'delete',
        label: t('groups.options.deleteGroup'),
        icon: 'trash-outline',
        onPress: handleDeleteGroup,
        destructive: true,
      });
    }

    return options;
  }, [group, groupId, playerId, isModerator, refetch, handleLeaveGroup, handleDeleteGroup, t]);

  const handleShowOptions = useCallback(() => {
    lightHaptic();
    setShowOptionsMenu(true);
  }, []);

  const handleCloseOptionsMenu = useCallback(() => {
    setShowOptionsMenu(false);
  }, []);

  const handleOptionItemPress = useCallback((action: () => void) => {
    setShowOptionsMenu(false);
    setTimeout(action, 100);
  }, []);

  // Set header title to group name
  useEffect(() => {
    if (group?.name) {
      navigation.setOptions({ headerTitle: group.name });
    }
  }, [navigation, group?.name]);

  // Set header right button for options
  useEffect(() => {
    navigation.setOptions({
      headerRight: ({ tintColor }: { tintColor?: string }) => (
        <TouchableOpacity
          onPress={handleShowOptions}
          style={{ padding: 4, marginRight: 8 }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={tintColor ?? colors.text} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, handleShowOptions, colors.text]);

  // Format activity time
  const formatActivityTime = useCallback(
    (dateStr: string) => {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 60) return t('groups.time.minutesAgo', { count: diffMins });
      if (diffHours < 24) return t('groups.time.hoursAgo', { count: diffHours });
      if (diffDays < 7) return t('groups.time.daysAgo', { count: diffDays });
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    },
    [t]
  );

  // Group activities by day
  const groupedActivities = useMemo(() => {
    if (!activities) return [];

    const groups: { title: string; data: GroupActivityType[] }[] = [];
    let currentDay = '';

    for (const activity of activities) {
      const date = new Date(activity.created_at);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let dayLabel: string;
      if (date.toDateString() === today.toDateString()) {
        dayLabel = t('groups.activityMessages.today');
      } else if (date.toDateString() === yesterday.toDateString()) {
        dayLabel = t('groups.activityMessages.yesterday');
      } else {
        dayLabel = date.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        });
      }

      if (dayLabel !== currentDay) {
        groups.push({ title: dayLabel, data: [] });
        currentDay = dayLabel;
      }

      groups[groups.length - 1].data.push(activity);
    }

    return groups;
  }, [activities, t]);

  // Get activity message
  const getActivityMessage = useCallback(
    (activity: GroupActivityType) => {
      const actorName = activity.actor?.profile?.first_name || t('groups.activityMessages.someone');

      switch (activity.activity_type) {
        case 'member_joined':
          // Show "Added by [name]" if someone else added them
          if (activity.added_by_name) {
            return t('groups.activityMessages.wasAddedBy', {
              actorName,
              addedByName: activity.added_by_name,
            });
          }
          return t('groups.activityMessages.joinedTheGroup', { actorName });
        case 'member_left':
          return t('groups.activityMessages.leftTheGroup', { actorName });
        case 'member_promoted':
          return t('groups.activityMessages.promotedMember', { actorName });
        case 'member_demoted':
          return t('groups.activityMessages.demotedMember', { actorName });
        case 'game_created':
          return t('groups.activityMessages.createdGame', { actorName });
        case 'message_sent':
          return t('groups.activityMessages.sentMessage', { actorName });
        case 'group_updated':
          return t('groups.activityMessages.updatedGroup', { actorName });
        default:
          return t('groups.activityMessages.performedAction', { actorName });
      }
    },
    [t]
  );

  const renderTabContent = () => {
    // Calculate activity ring segments
    const membersCount = stats?.newMembersLast7Days || 0;
    const gamesCount = stats?.gamesCreatedLast7Days || 0;
    // Use actual unread count from last 7 days for "new messages" stat
    const messagesCount = unreadChatCountLast7Days ?? 0;
    const totalActivities = membersCount + gamesCount + messagesCount;

    // SVG circle properties
    const size = 100;
    const strokeWidth = 8;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    // Calculate stroke dash offsets for each segment
    const membersPercent = totalActivities > 0 ? membersCount / totalActivities : 0;
    const gamesPercent = totalActivities > 0 ? gamesCount / totalActivities : 0;
    const messagesPercent = totalActivities > 0 ? messagesCount / totalActivities : 0;

    const membersLength = circumference * membersPercent;
    const gamesLength = circumference * gamesPercent;
    const messagesLength = circumference * messagesPercent;

    // Starting rotation for each segment (members starts at top, -90deg)
    const membersRotation = -90;
    const gamesRotation = membersRotation + membersPercent * 360;
    const messagesRotation = gamesRotation + gamesPercent * 360;

    switch (activeTab) {
      case 'leaderboard': {
        return (
          <NetworkLeaderboardTab
            networkId={groupId}
            networkType="group"
            currentPlayerId={playerId ?? undefined}
            onAddScorePress={handleAddGame}
            onPlayerPress={navigateToPlayerProfile}
            onChallengePress={() => handleAddGame()}
          />
        );
      }

      case 'games':
        return (
          <NetworkMatchesTab
            networkId={groupId}
            networkType="group"
            sportId={group?.sport_id}
            inline
          />
        );

      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={64} color={colors.textMuted} />
          <Text style={{ color: colors.textSecondary, marginTop: 16 }}>{t('groups.notFound')}</Text>
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: colors.primary }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={{ color: '#FFFFFF' }}>{t('common.goBack')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              refetch();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {/* Header Section - with cover image or default icon */}
        {group.cover_image_url ? (
          <Image
            source={{ uri: group.cover_image_url }}
            style={styles.coverImage}
            resizeMode="cover"
          />
        ) : (
          <View
            style={[
              styles.headerSection,
              { backgroundColor: isDark ? primary[900] : primary[100] },
            ]}
          >
            <View style={[styles.headerIcon, { backgroundColor: colors.cardBackground }]}>
              <Ionicons name="people-outline" size={48} color={colors.primary} />
            </View>
          </View>
        )}

        {/* Group Info Card */}
        <View
          style={[
            styles.infoCard,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text weight="bold" size="xl" style={{ color: colors.text }}>
              {group.name}
            </Text>
          </View>

          {/* Members Row */}
          <TouchableOpacity
            style={styles.membersRow}
            onPress={() =>
              group &&
              SheetManager.show('member-list', {
                payload: {
                  group,
                  currentUserId: playerId ?? '',
                  isModerator: isModerator ?? false,
                  onMemberRemoved: () => refetch(),
                  onPlayerPress: (playerId: string) => {
                    SheetManager.hide('member-list');
                    navigateToPlayerProfile(playerId);
                  },
                },
              })
            }
          >
            <Text size="sm" style={{ color: colors.textSecondary }}>
              {t('common.memberCount', { count: group.member_count })}
            </Text>
            <View style={styles.memberAvatars}>
              {group.members.slice(0, 5).map((member, index) => (
                <View
                  key={member.id}
                  style={[
                    styles.memberAvatar,
                    {
                      backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA',
                      marginLeft: index > 0 ? -8 : 0,
                      zIndex: 5 - index,
                    },
                  ]}
                >
                  {member.player?.profile?.profile_picture_url ? (
                    <Image
                      source={{ uri: member.player.profile.profile_picture_url }}
                      style={styles.memberAvatarImage}
                    />
                  ) : (
                    <Text size="xs" weight="semibold" style={{ color: colors.text }}>
                      {member.player?.profile?.first_name?.charAt(0) || '?'}
                    </Text>
                  )}
                </View>
              ))}
              {group.member_count > 5 && (
                <View
                  style={[styles.memberAvatar, { backgroundColor: colors.primary, marginLeft: -8 }]}
                >
                  <Text size="xs" weight="semibold" style={{ color: '#FFFFFF' }}>
                    +{group.member_count - 5}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          {/* Action Buttons Row */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.actionButtonsScroll}
            contentContainerStyle={styles.actionButtonsContent}
          >
            {group.member_count < (group.max_members ?? 20) && (
              <TouchableOpacity
                style={[
                  styles.actionPill,
                  {
                    backgroundColor: isDark ? primary[900] : primary[50],
                    borderColor: isDark ? primary[700] : primary[200],
                  },
                ]}
                onPress={() =>
                  SheetManager.show('add-group-member', {
                    payload: {
                      groupId,
                      currentMemberIds: group?.members.map(m => m.player_id) ?? [],
                      onSuccess: () => refetch(),
                    },
                  })
                }
                activeOpacity={0.7}
              >
                <Ionicons
                  name="person-add-outline"
                  size={14}
                  color={isDark ? primary[300] : primary[600]}
                />
                <Text
                  style={[styles.actionPillText, { color: isDark ? primary[200] : primary[700] }]}
                >
                  {t('groups.detail.addPlayer')}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.actionPill,
                {
                  backgroundColor: isDark ? primary[900] : primary[50],
                  borderColor: isDark ? primary[700] : primary[200],
                },
              ]}
              onPress={() =>
                SheetManager.show('invite-link', {
                  payload: {
                    groupId,
                    groupName: group?.name ?? '',
                    currentUserId: playerId ?? '',
                    isModerator: isModerator ?? false,
                  },
                })
              }
              activeOpacity={0.7}
            >
              <Ionicons
                name="share-outline"
                size={14}
                color={isDark ? primary[300] : primary[600]}
              />
              <Text
                style={[styles.actionPillText, { color: isDark ? primary[200] : primary[700] }]}
              >
                {t('groups.detail.sendInvite')}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Pending Score Confirmations */}
        {playerId && (
          <View style={{ marginHorizontal: 16 }}>
            <PendingScoresSection
              playerId={playerId}
              groupId={groupId}
              title={t('groups.detail.scoresToConfirm')}
            />
          </View>
        )}

        {/* About Section */}
        {group?.description && (
          <View style={{ marginHorizontal: 16, marginTop: 16 }}>
            <Text size="lg" weight="bold" style={{ color: colors.text, marginBottom: 8 }}>
              {t('groups.home.about')}
            </Text>
            <View
              style={[
                styles.aboutCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: colors.textSecondary, lineHeight: 22 }}>
                {group.description}
              </Text>
            </View>
          </View>
        )}

        {/* Favorite Facilities Section */}
        {group?.sport_id && (
          <View style={{ marginHorizontal: 16 }}>
            <NetworkFavoriteFacilities
              networkId={groupId}
              currentPlayerId={playerId ?? null}
              sportId={group.sport_id}
              latitude={player?.latitude ?? null}
              longitude={player?.longitude ?? null}
              translationPrefix="groups"
              onNavigateToFacility={facilityId =>
                navigation.navigate('FacilityDetail', { facilityId })
              }
            />
          </View>
        )}

        {/* Tab Bar */}
        <View style={[styles.tabContainer, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
          {TAB_KEYS.map(tabKey => (
            <TouchableOpacity
              key={tabKey}
              style={[
                styles.tab,
                activeTab === tabKey && [
                  styles.activeTab,
                  { backgroundColor: colors.cardBackground },
                ],
              ]}
              onPress={() => setActiveTab(tabKey)}
            >
              {tabKey === 'games' ? (
                <SportIcon
                  sportName={selectedSport?.name ?? 'tennis'}
                  size={18}
                  color={activeTab === tabKey ? colors.primary : colors.textMuted}
                />
              ) : (
                <Ionicons
                  name={TAB_ICONS[tabKey]}
                  size={18}
                  color={activeTab === tabKey ? colors.primary : colors.textMuted}
                />
              )}
              <Text
                size="sm"
                weight={activeTab === tabKey ? 'semibold' : 'medium'}
                style={{
                  color: activeTab === tabKey ? colors.primary : colors.textMuted,
                  marginLeft: 6,
                }}
              >
                {t(`groups.tabs.${tabKey}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Content */}
        {renderTabContent()}

        {/* Bottom spacing for chat button */}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Bottom Action Button - changes based on active tab, hidden when opened from chat */}
      {!fromChat ? (
        <Button
          variant="primary"
          size="lg"
          onPress={handleOpenChat}
          leftIcon={
            <View style={styles.chatIconContainer}>
              <Ionicons name="chatbubbles-outline" size={20} color="#FFFFFF" />
              {(unreadChatCount ?? 0) > 0 && (
                <View style={styles.unreadBadge}>
                  <Text size="xs" weight="bold" style={styles.unreadBadgeText}>
                    {(unreadChatCount ?? 0) > 99 ? '99+' : unreadChatCount}
                  </Text>
                </View>
              )}
            </View>
          }
          isDark={isDark}
          style={[styles.chatButton, { bottom: Math.max(insets.bottom, 20) + 12 }]}
        >
          {t('groups.chatWithMembers')}
        </Button>
      ) : null}

      {/* Add Score Flow Modals */}
      <AddScoreIntroModal
        visible={showAddScoreIntro}
        onClose={() => setShowAddScoreIntro(false)}
        onAddScore={handleAddScoreIntroComplete}
        onNeverShowAgain={async () => {
          try {
            await AsyncStorage.setItem(ADD_SCORE_INTRO_KEY, 'true');
            setHasSeenAddScoreIntro(true);
          } catch (error) {
            console.error('Error saving intro preference:', error);
          }
          handleAddScoreIntroComplete();
        }}
      />

      <AddScoreModal
        visible={showAddScoreModal}
        onClose={() => setShowAddScoreModal(false)}
        onSuccess={handleAddScoreSuccess}
        matchType={selectedMatchType}
        networkId={groupId}
      />

      {/* Options Dropdown Menu */}
      <Modal
        visible={showOptionsMenu}
        transparent
        animationType="fade"
        onRequestClose={handleCloseOptionsMenu}
      >
        <Pressable style={styles.menuOverlay} onPress={handleCloseOptionsMenu}>
          <Pressable
            style={[
              styles.menuContainer,
              {
                backgroundColor: isDark ? colors.card : '#FFFFFF',
                top: insets.top + 50,
              },
            ]}
            onPress={e => e.stopPropagation()}
          >
            {menuOptions.map((item, index) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.menuItem,
                  index < menuOptions.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
                onPress={() => handleOptionItemPress(item.onPress)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={item.icon}
                  size={20}
                  color={item.destructive ? status.error.DEFAULT : colors.text}
                  style={styles.menuItemIcon}
                />
                <Text
                  style={{
                    fontSize: fontSizePixels.base,
                    color: item.destructive ? status.error.DEFAULT : colors.text,
                  }}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  backButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  coverImage: {
    width: '100%',
    height: HEADER_HEIGHT,
  },
  headerSection: {
    height: HEADER_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: 20,
  },
  infoCard: {
    marginHorizontal: 16,
    marginTop: -40,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  membersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  memberAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: primary[500],
    overflow: 'hidden',
  },
  memberAvatarImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  actionButtonsScroll: {
    marginTop: spacingPixels[3],
    marginHorizontal: -20,
    overflow: 'hidden',
  },
  actionButtonsContent: {
    paddingHorizontal: 20,
    gap: spacingPixels[2],
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1.5],
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
  },
  actionPillText: {
    fontSize: fontSizePixels.sm,
    fontWeight: '600',
  },
  tabContainer: {
    flexDirection: 'row',
    marginTop: 24,
    marginHorizontal: 16,
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
  aboutCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  chatButton: {
    position: 'absolute',
    left: 16,
    right: 16,
  },
  chatIconContainer: {
    position: 'relative',
  },
  unreadBadge: {
    position: 'absolute',
    top: -8,
    right: -10,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 12,
  },
  // Leaderboard Preview List
  // Matches Preview styles
  // Recent Games Card
  // Match Card Styles
  // New Team Card styles for Recent Games (groups players per team)
  // Original player card styles (kept for backward compatibility)
  // Leaderboard Section Styles
  // Podium Styles
  // Leaderboard List Styles
  // Options dropdown menu
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  menuContainer: {
    position: 'absolute',
    right: spacingPixels[3],
    minWidth: 200,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
  },
  menuItemIcon: {
    marginRight: spacingPixels[3],
    width: 24,
  },
});
