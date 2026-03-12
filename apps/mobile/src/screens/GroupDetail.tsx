/**
 * GroupDetail Screen
 * Shows group details with tabs: Home, Leaderboard, Activity
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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '@rallia/shared-components';
import { lightHaptic, selectionHaptic, mediumHaptic } from '@rallia/shared-utils';
import { getSafeAreaEdges } from '../utils';
import {
  useThemeStyles,
  useAuth,
  useTranslation,
  useNavigateToPlayerProfile,
  useRequireOnboarding,
} from '../hooks';
import { useSport } from '../context';
import { SportIcon } from '../components/SportIcon';
import {
  useGroupWithMembers,
  useGroupStats,
  useGroupActivity,
  useIsGroupModerator,
  useLeaveGroup,
  useDeleteGroup,
  useGroupMatches,
  useMostRecentGroupMatch,
  useGroupLeaderboard,
  useGroupRealtime,
  useScoreConfirmationsRealtime,
  useConversationUnreadCount,
  useConversationUnreadRealtime,
  useSports,
  usePlayer,
  type GroupActivity as GroupActivityType,
  type GroupMatch,
} from '@rallia/shared-hooks';
import type { RootStackParamList } from '../navigation/types';
import { SheetManager } from 'react-native-actions-sheet';
import { primary } from '@rallia/design-system';
import {
  AddScoreIntroModal,
  AddScoreModal,
  PendingScoresSection,
  type MatchType,
} from '../features/matches';
import { GroupFavoriteFacilitiesSelector } from '../features/groups/components';

const HEADER_HEIGHT = 140;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type GroupDetailRouteProp = RouteProp<RootStackParamList, 'GroupDetail'>;

type TabKey = 'home' | 'leaderboard' | 'activity';

const TAB_KEYS: TabKey[] = ['home', 'leaderboard', 'activity'];

const TAB_ICONS: Record<TabKey, keyof typeof Ionicons.glyphMap> = {
  home: 'home-outline',
  leaderboard: 'podium-outline',
  activity: 'flash-outline',
};

export default function GroupDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<GroupDetailRouteProp>();
  const { groupId } = route.params;

  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { t } = useTranslation();
  const { guardAction } = useRequireOnboarding();
  const { selectedSport } = useSport();
  const { sports } = useSports();
  const { player } = usePlayer();
  const playerId = session?.user?.id;
  const navigateToPlayerProfile = useNavigateToPlayerProfile();

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

  // Helper to get sport name from sport_id
  const getSportName = useCallback(
    (sportId: string | null): string | null => {
      if (!sportId || !sports) return null;
      const sport = sports.find(s => s.id === sportId);
      return sport?.name ?? null;
    },
    [sports]
  );

  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<30 | 90 | 180 | 0>(30);
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
  const { data: recentMatch } = useMostRecentGroupMatch(groupId);
  const { data: allMatches } = useGroupMatches(groupId, 180, 100);
  const { data: leaderboard } = useGroupLeaderboard(
    groupId,
    leaderboardPeriod === 0 ? 3650 : leaderboardPeriod
  );

  // Get unread message count for the group chat
  const { data: unreadChatCount } = useConversationUnreadCount(
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
    SheetManager.show('group-options', {
      payload: { options: menuOptions, title: 'Group Options' },
    });
  }, [menuOptions]);

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
    const messagesCount = stats?.messagesLast7Days || 0;
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
      case 'home':
        return (
          <View style={styles.tabContent}>
            {/* Pending Score Confirmations */}
            {playerId && (
              <PendingScoresSection
                playerId={playerId}
                groupId={groupId}
                title={t('groups.detail.scoresToConfirm')}
              />
            )}

            {/* Group Stats */}
            <View
              style={[
                styles.groupStatsCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text weight="semibold" size="base" style={{ color: colors.text, marginBottom: 12 }}>
                {t('groups.detail.groupStats')}
              </Text>
              <View style={styles.groupStatsList}>
                <View style={styles.groupStatItem}>
                  <View style={[styles.groupStatIcon, { backgroundColor: '#5AC8FA20' }]}>
                    <Ionicons name="people-outline" size={20} color="#5AC8FA" />
                  </View>
                  <View style={styles.groupStatInfo}>
                    <Text size="sm" style={{ color: colors.textSecondary }}>
                      {t('groups.detail.totalMembers')}
                    </Text>
                    <Text weight="semibold" size="base" style={{ color: colors.text }}>
                      {group?.member_count ?? 0}
                    </Text>
                  </View>
                </View>
                <View style={styles.groupStatItem}>
                  <View style={[styles.groupStatIcon, { backgroundColor: '#FF950015' }]}>
                    <Ionicons name="lock-closed" size={20} color="#FF9500" />
                  </View>
                  <View style={styles.groupStatInfo}>
                    <Text size="sm" style={{ color: colors.textSecondary }}>
                      {t('groups.detail.visibility')}
                    </Text>
                    <Text weight="semibold" size="base" style={{ color: colors.text }}>
                      {t('groups.detail.private')}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Activity Stats Card */}
            <View
              style={[
                styles.statsCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text weight="semibold" size="base" style={{ color: colors.text, marginBottom: 16 }}>
                {t('groups.detail.last7DaysActivities')}
              </Text>
              <View style={styles.statsRow}>
                <View style={styles.statCircle}>
                  {/* Donut Chart */}
                  <View style={styles.donutContainer}>
                    <Svg width={size} height={size}>
                      {/* Background circle */}
                      <Circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        stroke={colors.border}
                        strokeWidth={strokeWidth}
                        fill="transparent"
                      />
                      {/* Members segment (cyan/blue) */}
                      {membersCount > 0 && (
                        <Circle
                          cx={size / 2}
                          cy={size / 2}
                          r={radius}
                          stroke="#5AC8FA"
                          strokeWidth={strokeWidth}
                          fill="transparent"
                          strokeDasharray={`${membersLength} ${circumference - membersLength}`}
                          strokeDashoffset={0}
                          strokeLinecap="round"
                          rotation={membersRotation}
                          origin={`${size / 2}, ${size / 2}`}
                        />
                      )}
                      {/* Games segment (orange) */}
                      {gamesCount > 0 && (
                        <Circle
                          cx={size / 2}
                          cy={size / 2}
                          r={radius}
                          stroke="#FF9500"
                          strokeWidth={strokeWidth}
                          fill="transparent"
                          strokeDasharray={`${gamesLength} ${circumference - gamesLength}`}
                          strokeDashoffset={0}
                          strokeLinecap="round"
                          rotation={gamesRotation}
                          origin={`${size / 2}, ${size / 2}`}
                        />
                      )}
                      {/* Messages segment (gray/dark) */}
                      {messagesCount > 0 && (
                        <Circle
                          cx={size / 2}
                          cy={size / 2}
                          r={radius}
                          stroke={isDark ? '#8E8E93' : '#636366'}
                          strokeWidth={strokeWidth}
                          fill="transparent"
                          strokeDasharray={`${messagesLength} ${circumference - messagesLength}`}
                          strokeDashoffset={0}
                          strokeLinecap="round"
                          rotation={messagesRotation}
                          origin={`${size / 2}, ${size / 2}`}
                        />
                      )}
                    </Svg>
                    {/* Center text */}
                    <View style={styles.donutCenter}>
                      <Text weight="bold" size="xl" style={{ color: colors.text }}>
                        {totalActivities}
                      </Text>
                      <Text size="xs" style={{ color: colors.textSecondary }}>
                        {t('groups.activity.activities')}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.statsList}>
                  <View style={styles.statItem}>
                    <Ionicons name="people-outline" size={20} color="#5AC8FA" />
                    <Text size="sm" style={{ color: colors.text, marginLeft: 10 }}>
                      {t('groups.activity.newMembers', { count: membersCount })}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <SportIcon
                      sportName={selectedSport?.name ?? 'tennis'}
                      size={20}
                      color="#FF9500"
                    />
                    <Text size="sm" style={{ color: colors.text, marginLeft: 10 }}>
                      {t('groups.activity.gamesCreated', { count: gamesCount })}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <Ionicons
                      name="chatbubble-ellipses-outline"
                      size={20}
                      color={isDark ? '#8E8E93' : '#C7C7CC'}
                    />
                    <Text size="sm" style={{ color: colors.text, marginLeft: 10 }}>
                      {t('groups.activity.newMessages', { count: messagesCount })}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* About Section */}
            {group?.description && (
              <View
                style={[
                  styles.aboutCard,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                ]}
              >
                <View style={styles.aboutHeader}>
                  <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
                  <Text weight="semibold" size="base" style={{ color: colors.text, marginLeft: 8 }}>
                    {t('groups.home.about')}
                  </Text>
                </View>
                <Text style={{ color: colors.textSecondary, lineHeight: 22, marginTop: 8 }}>
                  {group.description}
                </Text>
              </View>
            )}

            {/* Favorite Facilities Section */}
            <View
              style={[
                styles.facilitiesCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <GroupFavoriteFacilitiesSelector
                groupId={groupId}
                currentPlayerId={playerId ?? null}
                sportId={group?.sport_id ?? null}
                allSportIds={allSportIds}
                sportNames={sportNames}
                latitude={player?.latitude ?? null}
                longitude={player?.longitude ?? null}
                colors={colors}
                t={t}
                onNavigateToFacility={facilityId =>
                  navigation.navigate('FacilityDetail', { facilityId })
                }
              />
            </View>

            {/* Leaderboard Preview */}
            <View
              style={[
                styles.leaderboardPreview,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitle}>
                  <Ionicons name="trophy-outline" size={20} color={colors.primary} />
                  <Text weight="semibold" size="base" style={{ color: colors.text, marginLeft: 8 }}>
                    {t('groups.leaderboard.title')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setActiveTab('leaderboard')}>
                  <Text size="sm" style={{ color: colors.primary }}>
                    {t('groups.home.viewAll')}
                  </Text>
                </TouchableOpacity>
              </View>
              {/* Show top 3 from leaderboard preview or empty state */}
              {leaderboard && leaderboard.length > 0 ? (
                <View style={styles.leaderboardPreviewList}>
                  {leaderboard.slice(0, 3).map((entry, index) => (
                    <View key={entry.player_id} style={styles.leaderboardPreviewItem}>
                      <Text weight="semibold" style={{ color: colors.textMuted, width: 20 }}>
                        {index + 1}.
                      </Text>
                      <View
                        style={[
                          styles.smallAvatar,
                          { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                        ]}
                      >
                        {entry.player?.profile?.profile_picture_url ? (
                          <Image
                            source={{ uri: entry.player.profile.profile_picture_url }}
                            style={styles.avatarImage}
                          />
                        ) : (
                          <Ionicons name="person-outline" size={14} color={colors.textMuted} />
                        )}
                      </View>
                      <Text size="sm" style={{ color: colors.text, flex: 1, marginLeft: 8 }}>
                        {entry.player?.profile?.first_name || t('groups.recentGames.player')}
                      </Text>
                      <Text size="sm" weight="semibold" style={{ color: colors.primary }}>
                        {entry.games_played}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text
                  size="sm"
                  style={{ color: colors.textSecondary, marginTop: 12, textAlign: 'center' }}
                >
                  {t('groups.detail.noGamesPlayedYet')}
                </Text>
              )}
            </View>
          </View>
        );

      case 'leaderboard': {
        const periodOptions = [
          { value: 30, label: t('groups.leaderboardPeriod.30days') },
          { value: 90, label: t('groups.leaderboardPeriod.90days') },
          { value: 180, label: t('groups.leaderboardPeriod.180days') },
          { value: 0, label: t('groups.leaderboardPeriod.allTime') },
        ];

        return (
          <View style={styles.tabContent}>
            {/* Recent Games Section */}
            <View
              style={[
                styles.recentGamesCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitle}>
                  <Ionicons name="time-outline" size={20} color={colors.textSecondary} />
                  <Text weight="semibold" size="base" style={{ color: colors.text, marginLeft: 8 }}>
                    {t('groups.recentGames.title')}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() =>
                    SheetManager.show('recent-games', {
                      payload: {
                        matches: allMatches || [],
                        onMatchPress: (match: unknown) => {
                          SheetManager.hide('recent-games');
                          navigation.navigate('PlayedMatchDetail', { match: match as GroupMatch });
                        },
                        onPlayerPress: (playerId: string) => {
                          SheetManager.hide('recent-games');
                          navigateToPlayerProfile(playerId);
                        },
                      },
                    })
                  }
                >
                  <Text size="sm" style={{ color: colors.primary }}>
                    {t('groups.recentGames.viewAll')}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Most Recent Match Card */}
              {recentMatch?.match ? (
                <TouchableOpacity
                  style={[
                    styles.matchCard,
                    { backgroundColor: isDark ? '#1C1C1E' : '#F8F8F8', borderColor: colors.border },
                  ]}
                  onPress={() => {
                    navigation.navigate('PlayedMatchDetail', { match: recentMatch });
                  }}
                  activeOpacity={0.7}
                >
                  {/* Match Header */}
                  <View style={styles.matchHeader}>
                    <View style={styles.matchInfo}>
                      <SportIcon
                        sportName={recentMatch.match.sport?.name ?? 'tennis'}
                        size={16}
                        color={colors.primary}
                      />
                      <Text size="sm" style={{ color: colors.textSecondary, marginLeft: 6 }}>
                        {recentMatch.match.sport?.name || t('common.game')} ·{' '}
                        {new Date(recentMatch.match.match_date).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.matchBadge,
                        {
                          backgroundColor:
                            recentMatch.match.player_expectation === 'competitive'
                              ? '#E8F5E9'
                              : '#FFF3E0',
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          recentMatch.match.player_expectation === 'competitive'
                            ? 'trophy'
                            : 'fitness'
                        }
                        size={12}
                        color={
                          recentMatch.match.player_expectation === 'competitive'
                            ? '#2E7D32'
                            : '#EF6C00'
                        }
                      />
                      <Text
                        size="xs"
                        weight="semibold"
                        style={{
                          color:
                            recentMatch.match.player_expectation === 'competitive'
                              ? '#2E7D32'
                              : '#EF6C00',
                          marginLeft: 4,
                        }}
                      >
                        {recentMatch.match.player_expectation === 'competitive'
                          ? t('groups.recentGames.competitive')
                          : t('groups.recentGames.practice')}
                      </Text>
                    </View>
                  </View>

                  {/* Players - Team-based layout */}
                  <View style={styles.matchPlayersContainer}>
                    {/* Team 1 Card */}
                    {(() => {
                      const team1Players = recentMatch.match.participants.filter(
                        p => p.team_number === 1
                      );
                      const isWinner = recentMatch.match?.result?.winning_team === 1;

                      return (
                        <View
                          style={[
                            styles.teamCard,
                            isWinner && styles.winnerTeamCard,
                            isWinner && { borderColor: '#F59E0B' },
                          ]}
                        >
                          {isWinner && (
                            <View style={styles.teamWinnerBadge}>
                              <Ionicons name="trophy-outline" size={12} color="#F59E0B" />
                            </View>
                          )}

                          {/* Team Avatars - overlapping for doubles, tappable to view profile */}
                          <View style={styles.teamAvatarsContainer}>
                            {team1Players.map((participant, index) => (
                              <TouchableOpacity
                                key={participant.id}
                                style={[
                                  styles.teamPlayerAvatar,
                                  { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                                  index > 0 && styles.teamAvatarOverlap,
                                ]}
                                onPress={() =>
                                  participant.player_id &&
                                  navigateToPlayerProfile(participant.player_id)
                                }
                                activeOpacity={0.7}
                              >
                                {participant.player?.profile?.profile_picture_url ? (
                                  <Image
                                    source={{ uri: participant.player.profile.profile_picture_url }}
                                    style={styles.teamAvatarImage}
                                  />
                                ) : (
                                  <Ionicons
                                    name="person-outline"
                                    size={20}
                                    color={colors.textMuted}
                                  />
                                )}
                              </TouchableOpacity>
                            ))}
                          </View>

                          {/* Team Names */}
                          <Text
                            size="xs"
                            weight={isWinner ? 'semibold' : 'regular'}
                            style={{ color: colors.text, marginTop: 6, textAlign: 'center' }}
                            numberOfLines={2}
                          >
                            {team1Players
                              .map(
                                p => p.player?.profile?.first_name || t('groups.recentGames.player')
                              )
                              .join(', ')}
                          </Text>

                          {/* Team Score - same for all team members */}
                          {recentMatch.match?.result && (
                            <Text
                              size="sm"
                              weight="bold"
                              style={{
                                color: isWinner ? '#F59E0B' : colors.textMuted,
                                marginTop: 4,
                              }}
                            >
                              {recentMatch.match.result.sets &&
                              recentMatch.match.result.sets.length > 0
                                ? recentMatch.match.result.sets
                                    .sort((a, b) => a.set_number - b.set_number)
                                    .map(set => set.team1_score)
                                    .join('  ')
                                : (recentMatch.match.result.team1_score ?? '-')}
                            </Text>
                          )}
                        </View>
                      );
                    })()}

                    {/* VS */}
                    <Text
                      weight="semibold"
                      style={{ color: colors.textMuted, marginHorizontal: 12 }}
                    >
                      vs
                    </Text>

                    {/* Team 2 Card */}
                    {(() => {
                      const team2Players = recentMatch.match.participants.filter(
                        p => p.team_number === 2
                      );
                      const isWinner = recentMatch.match?.result?.winning_team === 2;

                      return (
                        <View
                          style={[
                            styles.teamCard,
                            isWinner && styles.winnerTeamCard,
                            isWinner && { borderColor: '#F59E0B' },
                          ]}
                        >
                          {isWinner && (
                            <View style={styles.teamWinnerBadge}>
                              <Ionicons name="trophy-outline" size={12} color="#F59E0B" />
                            </View>
                          )}

                          {/* Team Avatars - overlapping for doubles, tappable to view profile */}
                          <View style={styles.teamAvatarsContainer}>
                            {team2Players.map((participant, index) => (
                              <TouchableOpacity
                                key={participant.id}
                                style={[
                                  styles.teamPlayerAvatar,
                                  { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                                  index > 0 && styles.teamAvatarOverlap,
                                ]}
                                onPress={() =>
                                  participant.player_id &&
                                  navigateToPlayerProfile(participant.player_id)
                                }
                                activeOpacity={0.7}
                              >
                                {participant.player?.profile?.profile_picture_url ? (
                                  <Image
                                    source={{ uri: participant.player.profile.profile_picture_url }}
                                    style={styles.teamAvatarImage}
                                  />
                                ) : (
                                  <Ionicons
                                    name="person-outline"
                                    size={20}
                                    color={colors.textMuted}
                                  />
                                )}
                              </TouchableOpacity>
                            ))}
                          </View>

                          {/* Team Names */}
                          <Text
                            size="xs"
                            weight={isWinner ? 'semibold' : 'regular'}
                            style={{ color: colors.text, marginTop: 6, textAlign: 'center' }}
                            numberOfLines={2}
                          >
                            {team2Players
                              .map(
                                p => p.player?.profile?.first_name || t('groups.recentGames.player')
                              )
                              .join(', ')}
                          </Text>

                          {/* Team Score - same for all team members */}
                          {recentMatch.match?.result && (
                            <Text
                              size="sm"
                              weight="bold"
                              style={{
                                color: isWinner ? '#F59E0B' : colors.textMuted,
                                marginTop: 4,
                              }}
                            >
                              {recentMatch.match.result.sets &&
                              recentMatch.match.result.sets.length > 0
                                ? recentMatch.match.result.sets
                                    .sort((a, b) => a.set_number - b.set_number)
                                    .map(set => set.team2_score)
                                    .join('  ')
                                : (recentMatch.match.result.team2_score ?? '-')}
                            </Text>
                          )}
                        </View>
                      );
                    })()}
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={styles.emptyMatch}>
                  <SportIcon
                    sportName={selectedSport?.name ?? 'tennis'}
                    size={32}
                    color={colors.textMuted}
                  />
                  <Text size="sm" style={{ color: colors.textSecondary, marginTop: 8 }}>
                    {t('groups.recentGames.noGames')}
                  </Text>
                </View>
              )}
            </View>

            {/* Leaderboard Section */}
            <View
              style={[
                styles.leaderboardCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitle}>
                  <Ionicons name="podium-outline" size={20} color={colors.textSecondary} />
                  <Text weight="semibold" size="base" style={{ color: colors.text, marginLeft: 8 }}>
                    {t('groups.leaderboard.title')}
                  </Text>
                  <TouchableOpacity style={styles.infoButton}>
                    <Ionicons
                      name="information-circle-outline"
                      size={18}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>

                {/* Period Filter Dropdown */}
                <TouchableOpacity
                  style={[styles.periodFilter, { backgroundColor: isDark ? '#2C2C2E' : '#F0F0F0' }]}
                  onPress={() => {
                    const nextIndex =
                      (periodOptions.findIndex(o => o.value === leaderboardPeriod) + 1) %
                      periodOptions.length;
                    setLeaderboardPeriod(periodOptions[nextIndex].value as 30 | 90 | 180 | 0);
                  }}
                >
                  <Text size="sm" style={{ color: colors.text }}>
                    {periodOptions.find(o => o.value === leaderboardPeriod)?.label}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={16}
                    color={colors.textMuted}
                    style={{ marginLeft: 4 }}
                  />
                </TouchableOpacity>
              </View>

              {leaderboard && leaderboard.length > 0 ? (
                <>
                  {/* Podium for top 3 */}
                  {leaderboard.length >= 3 && (
                    <View style={styles.podiumContainer}>
                      {/* 2nd Place */}
                      <View style={styles.podiumItem}>
                        <View
                          style={[
                            styles.podiumAvatar,
                            styles.podiumAvatar2nd,
                            { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                          ]}
                        >
                          {leaderboard[1].player?.profile?.profile_picture_url ? (
                            <Image
                              source={{ uri: leaderboard[1].player.profile.profile_picture_url }}
                              style={styles.avatarImage}
                            />
                          ) : (
                            <Ionicons name="person-outline" size={28} color={colors.textMuted} />
                          )}
                          <View style={[styles.rankBadge, { backgroundColor: '#C0C0C0' }]}>
                            <Text size="xs" weight="bold" style={{ color: '#FFF' }}>
                              2
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* 1st Place */}
                      <View style={styles.podiumItem}>
                        <View
                          style={[
                            styles.podiumAvatar,
                            styles.podiumAvatar1st,
                            { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                          ]}
                        >
                          {leaderboard[0].player?.profile?.profile_picture_url ? (
                            <Image
                              source={{ uri: leaderboard[0].player.profile.profile_picture_url }}
                              style={styles.avatarImage}
                            />
                          ) : (
                            <Ionicons name="person-outline" size={32} color={colors.textMuted} />
                          )}
                          <View
                            style={[
                              styles.rankBadge,
                              styles.rankBadge1st,
                              { backgroundColor: '#FFD700' },
                            ]}
                          >
                            <Ionicons name="trophy-outline" size={14} color="#FFF" />
                          </View>
                        </View>
                      </View>

                      {/* 3rd Place */}
                      <View style={styles.podiumItem}>
                        <View
                          style={[
                            styles.podiumAvatar,
                            styles.podiumAvatar3rd,
                            { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                          ]}
                        >
                          {leaderboard[2].player?.profile?.profile_picture_url ? (
                            <Image
                              source={{ uri: leaderboard[2].player.profile.profile_picture_url }}
                              style={styles.avatarImage}
                            />
                          ) : (
                            <Ionicons name="person-outline" size={24} color={colors.textMuted} />
                          )}
                          <View style={[styles.rankBadge, { backgroundColor: '#CD7F32' }]}>
                            <Text size="xs" weight="bold" style={{ color: '#FFF' }}>
                              3
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Stats Header */}
                  <View style={styles.leaderboardHeader}>
                    <Text size="xs" style={{ color: colors.textMuted, flex: 1 }}>
                      {t('groups.leaderboard.players')}
                    </Text>
                    <Text
                      size="xs"
                      style={{ color: colors.textMuted, width: 80, textAlign: 'center' }}
                    >
                      {t('groups.leaderboard.gamesPlayed')}
                    </Text>
                  </View>

                  {/* Leaderboard List */}
                  {leaderboard.map((entry, index) => (
                    <View
                      key={entry.player_id}
                      style={[styles.leaderboardRow, { borderBottomColor: colors.border }]}
                    >
                      <View style={styles.leaderboardRank}>
                        {index < 3 ? (
                          <View
                            style={[
                              styles.topRankBadge,
                              {
                                backgroundColor:
                                  index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : '#CD7F32',
                              },
                            ]}
                          >
                            <Text size="xs" weight="bold" style={{ color: '#FFF' }}>
                              {index + 1}
                            </Text>
                          </View>
                        ) : (
                          <Text style={{ color: colors.textMuted }}>{index + 1}</Text>
                        )}
                      </View>
                      <View
                        style={[
                          styles.leaderboardAvatar,
                          { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                        ]}
                      >
                        {entry.player?.profile?.profile_picture_url ? (
                          <Image
                            source={{ uri: entry.player.profile.profile_picture_url }}
                            style={styles.avatarImage}
                          />
                        ) : (
                          <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                        )}
                      </View>
                      <Text size="sm" style={{ color: colors.text, flex: 1, marginLeft: 12 }}>
                        {entry.player?.profile?.display_name ||
                          entry.player?.profile?.first_name ||
                          t('groups.recentGames.player')}
                      </Text>
                      <Text
                        size="sm"
                        weight="semibold"
                        style={{ color: colors.text, width: 80, textAlign: 'center' }}
                      >
                        {entry.games_played}
                      </Text>
                    </View>
                  ))}
                </>
              ) : (
                <View style={styles.emptyLeaderboard}>
                  <Ionicons name="trophy-outline" size={48} color={colors.textMuted} />
                  <Text style={{ color: colors.textSecondary, marginTop: 12, textAlign: 'center' }}>
                    {t('groups.detail.playGamesToAppear')}
                  </Text>
                </View>
              )}
            </View>
          </View>
        );
      }

      case 'activity':
        return (
          <View style={styles.tabContent}>
            {groupedActivities.length === 0 ? (
              <View
                style={[
                  styles.emptyActivity,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                ]}
              >
                <Ionicons name="time-outline" size={48} color={colors.textMuted} />
                <Text style={{ color: colors.textSecondary, marginTop: 12 }}>
                  {t('groups.detail.noRecentActivity')}
                </Text>
              </View>
            ) : (
              groupedActivities.map((section, sectionIndex) => (
                <View key={sectionIndex} style={styles.activitySection}>
                  <Text
                    weight="semibold"
                    size="sm"
                    style={[styles.activityDayHeader, { color: colors.textSecondary }]}
                  >
                    {section.title}
                  </Text>
                  {section.data.map(activity => (
                    <TouchableOpacity
                      key={activity.id}
                      style={[
                        styles.activityItem,
                        { backgroundColor: colors.cardBackground, borderColor: colors.border },
                      ]}
                      onPress={() => {
                        if (activity.actor?.id) {
                          navigateToPlayerProfile(activity.actor.id);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.activityAvatar,
                          { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                        ]}
                      >
                        {activity.actor?.profile?.profile_picture_url ? (
                          <Image
                            source={{ uri: activity.actor.profile.profile_picture_url }}
                            style={styles.avatarImage}
                          />
                        ) : (
                          <Ionicons name="person-outline" size={20} color={colors.textMuted} />
                        )}
                      </View>
                      <View style={styles.activityContent}>
                        <Text size="sm" style={{ color: colors.text }}>
                          {getActivityMessage(activity)}
                        </Text>
                        <Text size="xs" style={{ color: colors.textMuted }}>
                          {formatActivityTime(activity.created_at)}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              ))
            )}
          </View>
        );

      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={getSafeAreaEdges(['top'])}
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
        edges={getSafeAreaEdges(['top'])}
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.primary} />
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
            {/* Sport icon(s) - show both when null, single when specific */}
            {(() => {
              const sportName = getSportName(group.sport_id);
              // null = both sports
              if (!group.sport_id) {
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                    <MaterialCommunityIcons name="tennis" size={18} color={colors.textMuted} />
                    <Text style={{ color: colors.textMuted, marginHorizontal: 2, fontSize: 12 }}>
                      +
                    </Text>
                    <MaterialCommunityIcons name="badminton" size={18} color={colors.textMuted} />
                  </View>
                );
              }
              // Tennis
              if (sportName?.toLowerCase() === 'tennis') {
                return (
                  <View style={{ marginLeft: 8 }}>
                    <MaterialCommunityIcons name="tennis" size={20} color={colors.textMuted} />
                  </View>
                );
              }
              // Pickleball
              if (sportName?.toLowerCase() === 'pickleball') {
                return (
                  <View style={{ marginLeft: 8 }}>
                    <MaterialCommunityIcons name="badminton" size={20} color={colors.textMuted} />
                  </View>
                );
              }
              return null;
            })()}
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
          <View style={styles.actionButtonsRow}>
            {group.member_count < (group.max_members ?? 20) && (
              <TouchableOpacity
                style={[styles.addMemberButton, { borderColor: colors.primary, flex: 1 }]}
                onPress={() =>
                  SheetManager.show('add-member', {
                    payload: {
                      groupId,
                      currentMemberIds: group?.members.map(m => m.player_id) ?? [],
                      onSuccess: () => refetch(),
                    },
                  })
                }
              >
                <Ionicons name="person-add-outline" size={18} color={colors.primary} />
                <Text weight="semibold" style={{ color: colors.primary, marginLeft: 8 }}>
                  {t('groups.detail.addMember')}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.menuButton, { borderColor: colors.primary }]}
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
            >
              <Ionicons name="share-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuButton, { borderColor: colors.border }]}
              onPress={handleShowOptions}
            >
              <Ionicons name="ellipsis-horizontal-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

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
              <Ionicons
                name={TAB_ICONS[tabKey]}
                size={18}
                color={activeTab === tabKey ? colors.primary : colors.textMuted}
              />
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

      {/* Bottom Action Button - changes based on active tab */}
      {activeTab === 'leaderboard' ? (
        <TouchableOpacity
          style={[styles.chatButton, { backgroundColor: colors.primary }]}
          onPress={handleAddGame}
        >
          <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
          <Text weight="semibold" style={styles.chatButtonText}>
            {t('community.leaderboard.addPlayedGame')}
          </Text>
        </TouchableOpacity>
      ) : activeTab === 'home' ? (
        <TouchableOpacity
          style={[styles.chatButton, { backgroundColor: colors.primary }]}
          onPress={handleOpenChat}
        >
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
          <Text weight="semibold" style={styles.chatButtonText}>
            {t('groups.chatWithMembers')}
          </Text>
        </TouchableOpacity>
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
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  navButton: {
    width: 40,
    height: 40,
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
  },
  memberAvatarImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 12,
  },
  addMemberButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  tabContent: {
    padding: 16,
    gap: 16,
  },
  groupStatsCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  groupStatsList: {
    flexDirection: 'row',
    gap: 16,
  },
  groupStatItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupStatIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  groupStatInfo: {
    flex: 1,
  },
  statsCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statCircle: {
    marginRight: 24,
  },
  donutContainer: {
    width: 100,
    height: 100,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  donutCenter: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsList: {
    flex: 1,
    gap: 16,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  aboutCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  aboutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  facilitiesCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  leaderboardPreview: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leaderboardCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  emptyLeaderboard: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  activitySection: {
    marginBottom: 8,
  },
  activityDayHeader: {
    marginBottom: 8,
    marginLeft: 4,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  activityAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  activityContent: {
    flex: 1,
  },
  emptyActivity: {
    padding: 40,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  chatButton: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  chatButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
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
  leaderboardPreviewList: {
    marginTop: 12,
  },
  leaderboardPreviewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  smallAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  // Recent Games Card
  recentGamesCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  // Match Card Styles
  matchCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  matchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  matchInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  matchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  matchPlayersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingHorizontal: 8,
  },
  teamContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // New Team Card styles for Recent Games (groups players per team)
  teamCard: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    minWidth: 90,
    maxWidth: 120,
  },
  winnerTeamCard: {
    borderWidth: 2,
  },
  teamAvatarsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  teamPlayerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
  },
  teamAvatarOverlap: {
    marginLeft: -12,
  },
  teamAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  teamWinnerBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 2,
  },
  // Original player card styles (kept for backward compatibility)
  playerCard: {
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  winnerCard: {
    borderWidth: 2,
  },
  playerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  winnerBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 2,
  },
  scoresRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  emptyMatch: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  // Leaderboard Section Styles
  infoButton: {
    marginLeft: 8,
  },
  periodFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  // Podium Styles
  podiumContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginVertical: 24,
  },
  podiumItem: {
    alignItems: 'center',
    marginHorizontal: 8,
  },
  podiumAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 35,
    overflow: 'hidden',
    position: 'relative',
  },
  podiumAvatar1st: {
    width: 70,
    height: 70,
  },
  podiumAvatar2nd: {
    width: 56,
    height: 56,
    marginBottom: 12,
    borderRadius: 28,
  },
  podiumAvatar3rd: {
    width: 48,
    height: 48,
    marginBottom: 20,
    borderRadius: 24,
  },
  rankBadge: {
    position: 'absolute',
    bottom: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankBadge1st: {
    width: 24,
    height: 24,
    borderRadius: 12,
    bottom: -6,
  },
  // Leaderboard List Styles
  leaderboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  leaderboardRank: {
    width: 32,
    alignItems: 'center',
  },
  topRankBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaderboardAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
});
