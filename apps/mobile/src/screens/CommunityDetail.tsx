/**
 * CommunityDetail Screen
 * Shows community details with tabs: Home, Activity
 * UI mirrors GroupDetail but adapted for communities (public/private visibility, join requests)
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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from '@rallia/shared-components';
import { lightHaptic, mediumHaptic, selectionHaptic } from '@rallia/shared-utils';
import { getSafeAreaEdges } from '../utils';
import {
  useThemeStyles,
  useAuth,
  useTranslation,
  useNavigateToPlayerProfile,
  useRequireOnboarding,
} from '../hooks';
import { useSport, useMatchDetailSheet } from '../context';
import { SportIcon } from '../components/SportIcon';
import {
  useCommunityWithMembers,
  useIsCommunityModerator,
  useLeaveCommunity,
  useDeleteCommunity,
  usePendingCommunityMembers,
  useApproveCommunityMember,
  useRejectCommunityMember,
  useCommunityRealtime,
  usePendingRequestsRealtime,
  useGroupStats,
  useGroupActivity,
  useGroupLeaderboard,
  useMostRecentGroupMatch,
  useGroupMatches,
  useCommunityAccess,
  useRequestToJoinCommunity,
  useConversationUnreadCount,
  useConversationUnreadCountLast7Days,
  useConversationUnreadRealtime,
  useSports,
  usePlayer,
  useNetworkMemberUpcomingMatches,
} from '@rallia/shared-hooks';
import type { GroupMatch, NetworkMemberMatch } from '@rallia/shared-hooks';
import type { GroupWithMembers } from '@rallia/shared-services';
import { SheetManager } from 'react-native-actions-sheet';
import type { RootStackParamList } from '../navigation/types';
import { primary } from '@rallia/design-system';

import { AddScoreIntroModal, AddScoreModal, type MatchType } from '../features/matches';
import { CommunityFavoriteFacilitiesSelector } from '../features/communities/components';
import { InfoModal } from '../components/InfoModal';

const HEADER_HEIGHT = 140;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type CommunityDetailRouteProp = RouteProp<RootStackParamList, 'CommunityDetail'>;

type TabKey = 'home' | 'leaderboard' | 'activity';

const TAB_KEYS: TabKey[] = ['home', 'leaderboard', 'activity'];

const TAB_ICONS: Record<TabKey, keyof typeof Ionicons.glyphMap> = {
  home: 'home-outline',
  leaderboard: 'podium-outline',
  activity: 'flash-outline',
};

// Storage key for "never show intro again"
const ADD_SCORE_INTRO_KEY = 'rallia_add_score_intro_dismissed';

export default function CommunityDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<CommunityDetailRouteProp>();
  const { communityId } = route.params;

  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { t } = useTranslation();
  const { guardAction } = useRequireOnboarding();
  const { selectedSport } = useSport();
  const { sports } = useSports();
  const playerId = session?.user?.id;
  const navigateToPlayerProfile = useNavigateToPlayerProfile();
  const { player } = usePlayer();
  const { openSheet: openMatchDetail } = useMatchDetailSheet();

  // Get all sport IDs and names for facility search when community has no specific sport
  const { allSportIds, sportNames } = useMemo(() => {
    if (!sports) return { allSportIds: [], sportNames: [] };
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
  const [showPendingRequestsModal, setShowPendingRequestsModal] = useState(false);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<30 | 90 | 180 | 0>(30);

  // Add Score flow state
  const [showAddScoreIntro, setShowAddScoreIntro] = useState(false);

  const [showAddScoreModal, setShowAddScoreModal] = useState(false);
  const [selectedMatchType, setSelectedMatchType] = useState<MatchType>('single');
  const [hasSeenAddScoreIntro, setHasSeenAddScoreIntro] = useState<boolean | null>(null);
  const [showRequestSentModal, setShowRequestSentModal] = useState(false);

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

  const { data: community, isLoading, refetch } = useCommunityWithMembers(communityId);

  const { data: isModerator } = useIsCommunityModerator(communityId, playerId);
  const {
    data: accessInfo,
    isLoading: isLoadingAccess,
    refetch: refetchAccess,
  } = useCommunityAccess(communityId, playerId);
  const { data: pendingRequests, refetch: refetchPendingRequests } = usePendingCommunityMembers(
    isModerator ? communityId : undefined,
    playerId
  );
  const { data: stats } = useGroupStats(communityId);
  const { data: activities } = useGroupActivity(communityId, 50);
  const { data: leaderboard } = useGroupLeaderboard(
    communityId,
    leaderboardPeriod === 0 ? 3650 : leaderboardPeriod
  );
  const { data: recentMatch } = useMostRecentGroupMatch(communityId);
  const { data: allMatches } = useGroupMatches(communityId, 180, 100);

  // Get upcoming public matches from network members
  const { data: memberUpcomingMatches, refetch: refetchMemberMatches } =
    useNetworkMemberUpcomingMatches(
      communityId,
      'community',
      playerId ?? undefined,
      community?.sport_id ?? undefined,
      20
    );

  // Get unread message count for the community chat badge (all unread)
  const { data: unreadChatCount } = useConversationUnreadCount(
    community?.conversation_id ?? undefined,
    playerId
  );

  // Get unread message count for the last 7 days stats section
  const { data: unreadChatCountLast7Days } = useConversationUnreadCountLast7Days(
    community?.conversation_id ?? undefined,
    playerId
  );

  // Subscribe to real-time updates for this community
  useCommunityRealtime(communityId);
  // Subscribe to real-time pending requests updates (for moderators)
  usePendingRequestsRealtime(isModerator ? communityId : undefined);
  // Subscribe to real-time chat updates for unread count badge
  useConversationUnreadRealtime(community?.conversation_id ?? undefined, playerId);

  const leaveCommunityMutation = useLeaveCommunity();
  const deleteCommunityMutation = useDeleteCommunity();
  const approveMemberMutation = useApproveCommunityMember();
  const rejectMemberMutation = useRejectCommunityMember();
  const requestToJoinMutation = useRequestToJoinCommunity();

  // Computed access state
  const canAccessCommunity = accessInfo?.canAccess ?? false;
  const isActiveMember = accessInfo?.isMember && accessInfo?.membershipStatus === 'active';
  const isPendingMember = accessInfo?.membershipStatus === 'pending';

  const handleRequestToJoin = useCallback(async () => {
    if (!playerId || !community) return;
    if (!guardAction()) return;

    try {
      await requestToJoinMutation.mutateAsync({ communityId, playerId });
      setShowRequestSentModal(true);
      // Refetch access info to update the UI
      refetchAccess();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to send join request');
    }
  }, [playerId, community, guardAction, communityId, requestToJoinMutation, refetchAccess]);

  // Helper to show join prompt for logged-in non-members
  const showJoinPrompt = useCallback(() => {
    Alert.alert(t('community.joinCommunity'), t('community.nonMember.joinToAccessContent'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('community.pendingRequests.requestToJoin'),
        onPress: () => {
          void handleRequestToJoin();
        },
      },
    ]);
  }, [t, handleRequestToJoin]);

  // Guarded navigation callbacks
  // - Logged-out users: prompt sign-in via guardAction()
  // - Logged-in non-members: show "Request to Join" prompt
  // - Active members: allow navigation
  const handleNavigateToPlayer = useCallback(
    (targetPlayerId: string) => {
      if (!guardAction()) return;
      if (!isActiveMember) {
        showJoinPrompt();
        return;
      }
      navigateToPlayerProfile(targetPlayerId);
    },
    [guardAction, isActiveMember, showJoinPrompt, navigateToPlayerProfile]
  );

  const handleNavigateToMatch = useCallback(
    (match: GroupMatch) => {
      if (!guardAction()) return;
      if (!isActiveMember) {
        showJoinPrompt();
        return;
      }
      navigation.navigate('PlayedMatchDetail', { match });
    },
    [guardAction, isActiveMember, showJoinPrompt, navigation]
  );

  const handleNavigateToFacility = useCallback(
    (facilityId: string) => {
      if (!guardAction()) return;
      if (!isActiveMember) {
        showJoinPrompt();
        return;
      }
      navigation.navigate('FacilityDetail', { facilityId });
    },
    [guardAction, isActiveMember, showJoinPrompt, navigation]
  );

  // Guarded navigation to network matches
  const handleNavigateToNetworkMatches = useCallback(() => {
    if (!guardAction()) return;
    if (!isActiveMember) {
      showJoinPrompt();
      return;
    }
    lightHaptic();
    navigation.navigate('NetworkMatches', {
      networkId: communityId,
      networkType: 'community',
      networkName: community?.name,
      sportId: community?.sport_id ?? undefined,
    });
  }, [
    guardAction,
    isActiveMember,
    showJoinPrompt,
    navigation,
    communityId,
    community?.name,
    community?.sport_id,
  ]);

  const handleOpenChat = useCallback(() => {
    if (!community?.conversation_id) return;
    if (!guardAction()) return;
    if (!isActiveMember) {
      showJoinPrompt();
      return;
    }
    lightHaptic();
    navigation.navigate('ChatConversation', {
      conversationId: community.conversation_id,
      title: community.name,
    });
  }, [community, guardAction, isActiveMember, showJoinPrompt, navigation]);

  const handleLeaveCommunity = useCallback(() => {
    Alert.alert(t('community.leaveCommunity'), t('community.confirmations.leave'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.leave'),
        style: 'destructive',
        onPress: async () => {
          if (!playerId) return;
          try {
            await leaveCommunityMutation.mutateAsync({ communityId, playerId });
            navigation.goBack();
          } catch (error) {
            Alert.alert(
              t('common.error'),
              error instanceof Error ? error.message : t('community.errors.failedToLeave')
            );
          }
        },
      },
    ]);
  }, [communityId, playerId, leaveCommunityMutation, navigation, t]);

  const handleDeleteCommunity = useCallback(() => {
    Alert.alert(t('community.deleteCommunity'), t('community.confirmations.delete'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          if (!playerId) return;
          try {
            await deleteCommunityMutation.mutateAsync({ communityId, playerId });
            navigation.goBack();
          } catch (error) {
            Alert.alert(
              t('common.error'),
              error instanceof Error ? error.message : t('community.errors.failedToDelete')
            );
          }
        },
      },
    ]);
  }, [communityId, playerId, deleteCommunityMutation, navigation, t]);

  // Build options for the menu modal (must be before handleShowOptions)
  const menuOptions = useMemo(() => {
    const isCreator = community?.created_by === playerId;
    const options: {
      id: string;
      label: string;
      icon: keyof typeof Ionicons.glyphMap;
      onPress: () => void;
      destructive?: boolean;
    }[] = [];

    options.push({
      id: 'invite',
      label: t('community.options.shareInviteLink'),
      icon: 'link-outline',
      onPress: () =>
        SheetManager.show('invite-link', {
          payload: {
            groupId: communityId,
            groupName: community?.name ?? '',
            currentUserId: playerId ?? '',
            isModerator: isModerator ?? false,
            type: 'community',
          },
        }),
    });

    if (isModerator && pendingRequests && pendingRequests.length > 0) {
      options.push({
        id: 'requests',
        label: t('community.options.pendingRequests', {
          count: pendingRequests.length,
        }),
        icon: 'person-add-outline',
        onPress: () => setShowPendingRequestsModal(true),
      });
    }

    if (isModerator && community) {
      options.push({
        id: 'edit',
        label: t('community.options.editCommunity'),
        icon: 'create-outline',
        onPress: () =>
          SheetManager.show('edit-community', {
            payload: { community, onSuccess: () => refetch() },
          }),
      });
    }

    options.push({
      id: 'leave',
      label: t('community.options.leaveCommunity'),
      icon: 'exit-outline',
      onPress: handleLeaveCommunity,
      destructive: true,
    });

    if (isCreator) {
      options.push({
        id: 'delete',
        label: t('community.options.deleteCommunity'),
        icon: 'trash-outline',
        onPress: handleDeleteCommunity,
        destructive: true,
      });
    }

    return options;
  }, [
    community,
    communityId,
    playerId,
    isModerator,
    pendingRequests,
    refetch,
    handleLeaveCommunity,
    handleDeleteCommunity,
    t,
  ]);

  const handleShowOptions = useCallback(() => {
    SheetManager.show('group-options', {
      payload: { options: menuOptions, title: 'Community Options' },
    });
  }, [menuOptions]);

  const handleMatchTypeSelect = useCallback((type: MatchType) => {
    selectionHaptic();
    setSelectedMatchType(type);
    setShowAddScoreModal(true);
  }, []);

  // Handle network match card press - open match detail sheet
  const handleNetworkMatchPress = useCallback(
    (match: NetworkMemberMatch) => {
      lightHaptic();
      // Transform to minimal format for match detail sheet
      // The sheet will load full details from the match ID
      openMatchDetail({
        id: match.id,
        sport_id: match.sport_id,
        match_date: match.match_date,
        start_time: match.start_time,
        end_time: match.end_time,
        format: match.format,
        player_expectation: match.player_expectation,
        visibility: match.visibility,
        join_mode: match.join_mode,
        location_type: match.location_type,
        location_name: match.location_name,
        facility_id: match.facility_id,
        created_by: match.created_by,
        cancelled_at: match.cancelled_at,
        sport: match.sport,
        facility: match.facility,
        participants: match.participants,
      } as unknown as Parameters<typeof openMatchDetail>[0]);
    },
    [openMatchDetail]
  );

  // Add Game flow handlers
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
      refetch();
    },
    [refetch]
  );

  const renderTabContent = () => {
    // Calculate activity ring segments for Last 7 days
    const membersCountLast7Days = stats?.newMembersLast7Days || 0;
    const gamesCountLast7Days = stats?.gamesCreatedLast7Days || 0;
    // Use actual unread count from last 7 days for "new messages" stat
    const messagesCountLast7Days = unreadChatCountLast7Days ?? 0;
    const totalActivities = membersCountLast7Days + gamesCountLast7Days + messagesCountLast7Days;

    // SVG circle properties
    const size = 100;
    const strokeWidth = 8;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    // Calculate stroke dash offsets for each segment
    const membersPercent = totalActivities > 0 ? membersCountLast7Days / totalActivities : 0;
    const gamesPercent = totalActivities > 0 ? gamesCountLast7Days / totalActivities : 0;
    const messagesPercent = totalActivities > 0 ? messagesCountLast7Days / totalActivities : 0;

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
            {/* Community Stats Card */}
            <View
              style={[
                styles.communityStatsCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text weight="semibold" size="base" style={{ color: colors.text, marginBottom: 16 }}>
                Community Stats
              </Text>
              <View style={styles.communityStatsList}>
                <View style={styles.communityStatItem}>
                  <View style={[styles.communityStatIcon, { backgroundColor: '#5AC8FA20' }]}>
                    <Ionicons name="people-outline" size={24} color="#5AC8FA" />
                  </View>
                  <View style={styles.communityStatInfo}>
                    <Text weight="bold" size="lg" style={{ color: colors.text }}>
                      {community?.member_count || 0}
                    </Text>
                    <Text size="xs" style={{ color: colors.textSecondary }}>
                      Total Members
                    </Text>
                  </View>
                </View>
                <View style={styles.communityStatItem}>
                  <View
                    style={[
                      styles.communityStatIcon,
                      { backgroundColor: community?.is_public ? '#34C75920' : '#FF950020' },
                    ]}
                  >
                    <Ionicons
                      name={community?.is_public ? 'globe-outline' : 'lock-closed-outline'}
                      size={24}
                      color={community?.is_public ? '#34C759' : '#FF9500'}
                    />
                  </View>
                  <View style={styles.communityStatInfo}>
                    <Text weight="bold" size="lg" style={{ color: colors.text }}>
                      {community?.is_public ? 'Public' : 'Private'}
                    </Text>
                    <Text size="xs" style={{ color: colors.textSecondary }}>
                      Visibility
                    </Text>
                  </View>
                </View>
              </View>
              {isModerator && pendingRequests && pendingRequests.length > 0 && (
                <TouchableOpacity
                  style={[
                    styles.pendingRequestsBanner,
                    { backgroundColor: '#FF3B3010', borderColor: '#FF3B30' },
                  ]}
                  onPress={() => setShowPendingRequestsModal(true)}
                >
                  <Ionicons name="person-add-outline" size={20} color="#FF3B30" />
                  <Text
                    size="sm"
                    weight="semibold"
                    style={{ color: '#FF3B30', marginLeft: 8, flex: 1 }}
                  >
                    {pendingRequests.length} pending request
                    {pendingRequests.length !== 1 ? 's' : ''}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#FF3B30" />
                </TouchableOpacity>
              )}
            </View>

            {/* Last 7 Days Activities Card */}
            <View
              style={[
                styles.statsCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text weight="semibold" size="base" style={{ color: colors.text, marginBottom: 16 }}>
                {t('community.detail.last7DaysActivities')}
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
                      {membersCountLast7Days > 0 && (
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
                      {gamesCountLast7Days > 0 && (
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
                      {messagesCountLast7Days > 0 && (
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
                        {t('community.detail.activities')}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.statsList}>
                  <View style={styles.statItem}>
                    <Ionicons name="people-outline" size={20} color="#5AC8FA" />
                    <Text size="sm" style={{ color: colors.text, marginLeft: 10 }}>
                      {t('community.detail.newMembers', {
                        count: membersCountLast7Days,
                      })}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <SportIcon
                      sportName={selectedSport?.name ?? 'tennis'}
                      size={20}
                      color="#FF9500"
                    />
                    <Text size="sm" style={{ color: colors.text, marginLeft: 10 }}>
                      {t('community.detail.gamesCreated', {
                        count: gamesCountLast7Days,
                      })}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <Ionicons
                      name="chatbubble-ellipses-outline"
                      size={20}
                      color={isDark ? '#8E8E93' : '#C7C7CC'}
                    />
                    <Text size="sm" style={{ color: colors.text, marginLeft: 10 }}>
                      {t('community.detail.newMessages', {
                        count: messagesCountLast7Days,
                      })}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* About Section */}
            {community?.description && (
              <View
                style={[
                  styles.aboutCard,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                ]}
              >
                <View style={styles.aboutHeader}>
                  <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
                  <Text weight="semibold" size="base" style={{ color: colors.text, marginLeft: 8 }}>
                    {t('community.detail.about')}
                  </Text>
                </View>
                <Text style={{ color: colors.textSecondary, lineHeight: 22, marginTop: 8 }}>
                  {community.description}
                </Text>
              </View>
            )}

            {/* Favorite Facilities Section */}
            <CommunityFavoriteFacilitiesSelector
              networkId={communityId}
              currentPlayerId={playerId ?? null}
              sportId={community?.sport_id ?? null}
              allSportIds={allSportIds}
              sportNames={sportNames}
              latitude={player?.latitude ?? null}
              longitude={player?.longitude ?? null}
              colors={colors}
              t={t}
              onNavigateToFacility={handleNavigateToFacility}
            />

            {/* Member Upcoming Matches Preview */}
            <View
              style={[
                styles.matchesPreview,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitle}>
                  <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                  <Text weight="semibold" size="base" style={{ color: colors.text, marginLeft: 8 }}>
                    {t('community.matches.title')}
                  </Text>
                </View>
                {memberUpcomingMatches && memberUpcomingMatches.length > 0 && (
                  <TouchableOpacity onPress={handleNavigateToNetworkMatches}>
                    <Text size="sm" style={{ color: colors.primary }}>
                      {t('community.detail.viewAll')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              {memberUpcomingMatches && memberUpcomingMatches.length > 0 ? (
                <View style={styles.matchesPreviewList}>
                  {memberUpcomingMatches.slice(0, 2).map(match => {
                    const matchDate = new Date(match.match_date);
                    const formattedDate = matchDate.toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    });
                    const formattedTime = matchDate.toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    });
                    const slotsAvailable = match.max_players - match.current_players;
                    const isFull = slotsAvailable <= 0;

                    return (
                      <TouchableOpacity
                        key={match.id}
                        style={[
                          styles.matchPreviewCard,
                          { backgroundColor: isDark ? '#2C2C2E' : '#F5F5F5' },
                        ]}
                        onPress={() => {
                          handleNetworkMatchPress(match);
                        }}
                      >
                        <View style={styles.matchPreviewHeader}>
                          <SportIcon
                            sportName={match.sport?.name ?? 'padel'}
                            size={18}
                            color={colors.primary}
                          />
                          <Text
                            size="sm"
                            weight="semibold"
                            style={{ color: colors.text, marginLeft: 6, flex: 1 }}
                          >
                            {match.sport?.name ?? 'Match'}
                          </Text>
                          <View
                            style={[
                              styles.matchSlotBadge,
                              { backgroundColor: isFull ? colors.textMuted : colors.primary },
                            ]}
                          >
                            <Text size="xs" weight="semibold" style={{ color: '#FFFFFF' }}>
                              {isFull
                                ? t('match.slots.full')
                                : slotsAvailable === 1
                                  ? t('match.slots.oneLeft')
                                  : t('match.slots.left', { count: slotsAvailable })}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.matchPreviewDetails}>
                          <View style={styles.matchPreviewRow}>
                            <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                            <Text size="xs" style={{ color: colors.textSecondary, marginLeft: 4 }}>
                              {formattedDate} • {formattedTime}
                            </Text>
                          </View>
                          {match.facility && (
                            <View style={styles.matchPreviewRow}>
                              <Ionicons
                                name="location-outline"
                                size={14}
                                color={colors.textMuted}
                              />
                              <Text
                                size="xs"
                                style={{ color: colors.textSecondary, marginLeft: 4 }}
                                numberOfLines={1}
                              >
                                {match.facility.name}
                              </Text>
                            </View>
                          )}
                          <View style={styles.matchPreviewRow}>
                            <Ionicons name="person-outline" size={14} color={colors.textMuted} />
                            <Text size="xs" style={{ color: colors.textSecondary, marginLeft: 4 }}>
                              {t('match.hostedBy')}{' '}
                              {match.creator?.first_name ?? t('common.player')}
                            </Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.matchesEmptyState}>
                  <Ionicons name="calendar-outline" size={32} color={colors.textMuted} />
                  <Text
                    size="sm"
                    style={{ color: colors.textSecondary, marginTop: 8, textAlign: 'center' }}
                  >
                    {t('community.matches.empty.title')}
                  </Text>
                  <Text
                    size="xs"
                    style={{ color: colors.textMuted, marginTop: 4, textAlign: 'center' }}
                  >
                    {t('community.matches.empty.description')}
                  </Text>
                </View>
              )}
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
                    {t('community.leaderboard.title')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setActiveTab('leaderboard')}>
                  <Text size="sm" style={{ color: colors.primary }}>
                    {t('community.detail.viewAll')}
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
                        {entry.player?.profile?.first_name || t('common.player')}
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
                  {t('community.leaderboard.noGamesYet')}
                </Text>
              )}
            </View>

            {/* Pending Requests Section (moderators only) */}
            {isModerator && pendingRequests && pendingRequests.length > 0 && (
              <View
                style={[
                  styles.pendingRequestsCard,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                ]}
              >
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitle}>
                    <Ionicons name="person-add-outline" size={20} color="#FF9500" />
                    <Text
                      weight="semibold"
                      size="base"
                      style={{ color: colors.text, marginLeft: 8 }}
                    >
                      {t('community.pendingRequests.title')}
                    </Text>
                    <View style={[styles.badgeCount, { backgroundColor: '#FF3B30' }]}>
                      <Text size="xs" weight="bold" style={{ color: '#FFFFFF' }}>
                        {pendingRequests.length}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => setShowPendingRequestsModal(true)}>
                    <Text size="sm" style={{ color: colors.primary }}>
                      {t('community.detail.viewAll')}
                    </Text>
                  </TouchableOpacity>
                </View>
                {/* Show first 3 pending requests */}
                <View style={styles.pendingRequestsList}>
                  {pendingRequests.slice(0, 3).map(request => (
                    <View
                      key={request.id}
                      style={[styles.pendingRequestItem, { borderBottomColor: colors.border }]}
                    >
                      <View
                        style={[
                          styles.smallAvatar,
                          { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                        ]}
                      >
                        {request.player_profile_picture ? (
                          <Image
                            source={{ uri: request.player_profile_picture }}
                            style={styles.avatarImage}
                          />
                        ) : (
                          <Ionicons name="person-outline" size={14} color={colors.textMuted} />
                        )}
                      </View>
                      <View style={styles.pendingRequestInfo}>
                        <Text size="sm" weight="medium" style={{ color: colors.text }}>
                          {request.player_name || t('common.player')}
                        </Text>
                        <Text size="xs" style={{ color: colors.textSecondary }}>
                          {request.referrer_name
                            ? t('community.referredBy', {
                                name: request.referrer_name,
                              })
                            : t('community.pendingRequests.joinRequest')}
                        </Text>
                      </View>
                      <View style={styles.pendingRequestActions}>
                        <TouchableOpacity
                          style={[styles.miniApproveButton, { backgroundColor: colors.primary }]}
                          onPress={async () => {
                            if (!playerId) return;
                            try {
                              await approveMemberMutation.mutateAsync({
                                communityId,
                                memberId: request.id,
                                approverId: playerId,
                              });
                              refetchPendingRequests();
                              refetch();
                            } catch (error) {
                              console.error('[CommunityDetail] Error approving member:', error);
                            }
                          }}
                        >
                          <Ionicons name="checkmark-outline" size={16} color="#FFFFFF" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.miniRejectButton,
                            { backgroundColor: isDark ? '#3A3A3C' : '#E5E5EA' },
                          ]}
                          onPress={async () => {
                            if (!playerId) return;
                            try {
                              await rejectMemberMutation.mutateAsync({
                                communityId,
                                memberId: request.id,
                                rejectorId: playerId,
                              });
                              refetchPendingRequests();
                            } catch (error) {
                              console.error('[CommunityDetail] Error rejecting member:', error);
                            }
                          }}
                        >
                          <Ionicons name="close-outline" size={16} color={colors.text} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
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
                          handleNavigateToMatch(match as GroupMatch);
                        },
                        onPlayerPress: (targetPlayerId: string) => {
                          SheetManager.hide('recent-games');
                          handleNavigateToPlayer(targetPlayerId);
                        },
                      },
                    })
                  }
                >
                  <Text size="sm" style={{ color: colors.primary }}>
                    {t('community.detail.viewAll')}
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
                  onPress={() => handleNavigateToMatch(recentMatch)}
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
                        {recentMatch.match.sport?.name || 'Sport'} ·{' '}
                        {new Date(recentMatch.match.match_date).toLocaleDateString('en-US', {
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

                          {/* Team Avatars */}
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
                                  handleNavigateToPlayer(participant.player_id)
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
                              .map(p => p.player?.profile?.first_name || 'Player')
                              .join(', ')}
                          </Text>

                          {/* Team Score */}
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

                          {/* Team Avatars */}
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
                                  handleNavigateToPlayer(participant.player_id)
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
                              .map(p => p.player?.profile?.first_name || 'Player')
                              .join(', ')}
                          </Text>

                          {/* Team Score */}
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
                    {t('groups.detail.noRecentGames')}
                  </Text>
                </View>
              )}
            </View>

            {/* Period Selector */}
            <View
              style={[
                styles.periodSelector,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              {periodOptions.map(option => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.periodOption,
                    leaderboardPeriod === option.value && { backgroundColor: colors.primary },
                  ]}
                  onPress={() => setLeaderboardPeriod(option.value as 30 | 90 | 180 | 0)}
                >
                  <Text
                    size="sm"
                    weight={leaderboardPeriod === option.value ? 'semibold' : 'regular'}
                    style={{ color: leaderboardPeriod === option.value ? '#FFFFFF' : colors.text }}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Leaderboard List */}
            <View
              style={[
                styles.leaderboardCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              {leaderboard && leaderboard.length > 0 ? (
                leaderboard.map((entry, index) => (
                  <TouchableOpacity
                    key={entry.player_id}
                    style={[
                      styles.leaderboardItem,
                      index < leaderboard.length - 1 && {
                        borderBottomWidth: 1,
                        borderBottomColor: colors.border,
                      },
                    ]}
                    onPress={() => handleNavigateToPlayer(entry.player_id)}
                  >
                    <View style={styles.leaderboardRank}>
                      {index < 3 ? (
                        <View
                          style={[
                            styles.rankBadge,
                            {
                              backgroundColor:
                                index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : '#CD7F32',
                            },
                          ]}
                        >
                          <Text weight="bold" size="sm" style={{ color: '#FFFFFF' }}>
                            {index + 1}
                          </Text>
                        </View>
                      ) : (
                        <Text
                          weight="semibold"
                          style={{ color: colors.textMuted, width: 28, textAlign: 'center' }}
                        >
                          {index + 1}
                        </Text>
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
                          style={styles.leaderboardAvatarImage}
                        />
                      ) : (
                        <Ionicons name="person-outline" size={20} color={colors.textMuted} />
                      )}
                    </View>
                    <View style={styles.leaderboardInfo}>
                      <Text weight="semibold" style={{ color: colors.text }}>
                        {entry.player?.profile?.first_name || 'Player'}
                      </Text>
                      <Text size="xs" style={{ color: colors.textSecondary }}>
                        {entry.games_played} game{entry.games_played !== 1 ? 's' : ''} played
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.emptyLeaderboard}>
                  <Ionicons name="trophy-outline" size={48} color={colors.textMuted} />
                  <Text style={{ color: colors.textSecondary, marginTop: 12, textAlign: 'center' }}>
                    No games played yet.{'\n'}Start playing to appear on the leaderboard!
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
            {activities && activities.length > 0 ? (
              <View
                style={[
                  styles.activityList,
                  { backgroundColor: colors.cardBackground, borderColor: colors.border },
                ]}
              >
                {activities.slice(0, 20).map((activity, index) => {
                  const actorName = activity.actor?.profile?.first_name || 'Someone';
                  let message = '';
                  let icon: keyof typeof Ionicons.glyphMap | 'sport' = 'ellipse';
                  let iconColor: string = colors.primary;

                  switch (activity.activity_type) {
                    case 'member_joined':
                      message = activity.added_by_name
                        ? `${actorName} was added by ${activity.added_by_name}`
                        : `${actorName} joined the community`;
                      icon = 'person-add';
                      iconColor = '#5AC8FA';
                      break;
                    case 'member_left':
                      message = `${actorName} left the community`;
                      icon = 'exit';
                      iconColor = '#FF3B30';
                      break;
                    case 'member_promoted':
                      message = `${actorName} was promoted to moderator`;
                      icon = 'arrow-up-circle';
                      iconColor = '#34C759';
                      break;
                    case 'member_demoted':
                      message = `${actorName} was demoted to member`;
                      icon = 'arrow-down-circle';
                      iconColor = '#FF9500';
                      break;
                    case 'game_created':
                      message = `${actorName} created a new game`;
                      icon = 'sport'; // Rendered as SportIcon below
                      iconColor = '#FF9500';
                      break;
                    case 'message_sent':
                      message = `${actorName} sent a message`;
                      icon = 'chatbubble';
                      iconColor = colors.textSecondary;
                      break;
                    default:
                      message = `${actorName} performed an action`;
                  }

                  const activityDate = new Date(activity.created_at);
                  const timeAgo = getTimeAgo(activityDate);

                  return (
                    <TouchableOpacity
                      key={activity.id}
                      style={[
                        styles.activityItem,
                        index < Math.min(activities.length, 20) - 1 && {
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                        },
                      ]}
                      onPress={() => {
                        // Navigate to player profile if actor exists
                        if (activity.actor?.id) {
                          handleNavigateToPlayer(activity.actor.id);
                        }
                      }}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.activityIcon,
                          { backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7' },
                        ]}
                      >
                        {icon === 'sport' ? (
                          <SportIcon
                            sportName={selectedSport?.name ?? 'tennis'}
                            size={16}
                            color={iconColor}
                          />
                        ) : (
                          <Ionicons name={icon} size={16} color={iconColor} />
                        )}
                      </View>
                      <View style={styles.activityContent}>
                        <Text size="sm" style={{ color: colors.text }}>
                          {message}
                        </Text>
                        <Text size="xs" style={{ color: colors.textSecondary, marginTop: 2 }}>
                          {timeAgo}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
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
            )}
          </View>
        );

      default:
        return null;
    }
  };

  // Helper function for time ago
  const getTimeAgo = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('groups.time.justNow');
    if (diffMins < 60) return t('groups.time.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('groups.time.hoursAgo', { count: diffHours });
    if (diffDays === 1) return t('groups.activityMessages.yesterday');
    if (diffDays < 7) return t('groups.time.daysAgo', { count: diffDays });
    return date.toLocaleDateString(t('common.locale'), {
      month: 'short',
      day: 'numeric',
    });
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

  if (!community) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={getSafeAreaEdges(['top'])}
      >
        <View style={styles.errorContainer}>
          <Ionicons name="warning-outline" size={64} color={colors.textMuted} />
          <Text style={{ color: colors.textSecondary, marginTop: 16 }}>
            {t('community.detail.notFound')}
          </Text>
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

  // Non-member view: Show community info with Request to Join option
  if (!isLoadingAccess && !canAccessCommunity && !isActiveMember) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Header with back button */}
          <View style={styles.nonMemberHeader}>
            <TouchableOpacity
              style={[styles.backButtonCircle, { backgroundColor: colors.cardBackground }]}
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Cover Image */}
          {community.cover_image_url ? (
            <Image
              source={{ uri: community.cover_image_url }}
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
                <Ionicons name="globe-outline" size={48} color={colors.primary} />
              </View>
            </View>
          )}

          {/* Community Info Card */}
          <View
            style={[
              styles.infoCard,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
          >
            <View style={styles.titleRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Text weight="bold" size="xl" style={{ color: colors.text }}>
                  {community.name}
                </Text>
                {/* Sport icon(s) - show both when null, single when specific */}
                {(() => {
                  const sportName = getSportName(community.sport_id);
                  // null = both sports
                  if (!community.sport_id) {
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                        <SportIcon sportName="tennis" size={18} color={colors.textMuted} />
                        <Text
                          style={{ color: colors.textMuted, marginHorizontal: 2, fontSize: 12 }}
                        >
                          +
                        </Text>
                        <SportIcon sportName="pickleball" size={18} color={colors.textMuted} />
                      </View>
                    );
                  }
                  // Tennis
                  if (sportName?.toLowerCase() === 'tennis') {
                    return (
                      <View style={{ marginLeft: 8 }}>
                        <SportIcon sportName="tennis" size={20} color={colors.textMuted} />
                      </View>
                    );
                  }
                  // Pickleball
                  if (sportName?.toLowerCase() === 'pickleball') {
                    return (
                      <View style={{ marginLeft: 8 }}>
                        <SportIcon sportName="pickleball" size={20} color={colors.textMuted} />
                      </View>
                    );
                  }
                  return null;
                })()}
              </View>
              {/* Certification badge for verified communities */}
              {community.is_certified && (
                <View
                  style={[styles.visibilityBadge, { backgroundColor: '#E3F2FD', marginRight: 8 }]}
                >
                  <MaterialCommunityIcons name="check-decagram" size={14} color={colors.primary} />
                  <Text
                    size="xs"
                    weight="semibold"
                    style={{ color: colors.primary, marginLeft: 4 }}
                  >
                    {t('community.certified')}
                  </Text>
                </View>
              )}
              {!community.is_private ? (
                <View style={[styles.visibilityBadge, { backgroundColor: '#E8F5E9' }]}>
                  <Ionicons name="globe-outline" size={14} color="#2E7D32" />
                  <Text size="xs" weight="semibold" style={{ color: '#2E7D32', marginLeft: 4 }}>
                    {t('community.visibility.public')}
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.visibilityBadge,
                    { backgroundColor: isDark ? '#2C2C2E' : '#FFF3E0' },
                  ]}
                >
                  <Ionicons name="lock-closed" size={14} color="#F57C00" />
                  <Text size="xs" weight="semibold" style={{ color: '#F57C00', marginLeft: 4 }}>
                    {t('community.visibility.private')}
                  </Text>
                </View>
              )}
            </View>

            {community.description && (
              <Text size="sm" style={{ color: colors.textSecondary, marginTop: 8, lineHeight: 20 }}>
                {community.description}
              </Text>
            )}

            {/* Member count */}
            <View style={[styles.memberCountRow, { marginTop: 16 }]}>
              <Ionicons name="people-outline" size={18} color={colors.textMuted} />
              <Text size="sm" style={{ color: colors.textSecondary, marginLeft: 8 }}>
                {t('common.memberCount', { count: community.member_count || 0 })}
              </Text>
            </View>

            {/* Action Section */}
            <View style={styles.nonMemberActions}>
              {isPendingMember ? (
                <View
                  style={[
                    styles.pendingStatusBadge,
                    { backgroundColor: isDark ? '#3C3C3E' : '#E5E5EA' },
                  ]}
                >
                  <Ionicons name="time-outline" size={18} color={colors.textMuted} />
                  <Text
                    size="sm"
                    weight="medium"
                    style={{ color: colors.textMuted, marginLeft: 8 }}
                  >
                    {t('community.pendingRequests.pending')}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.requestToJoinButton, { backgroundColor: colors.primary }]}
                  onPress={handleRequestToJoin}
                  disabled={requestToJoinMutation.isPending}
                >
                  {requestToJoinMutation.isPending ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="person-add-outline" size={20} color="#FFFFFF" />
                      <Text
                        size="base"
                        weight="semibold"
                        style={{ color: '#FFFFFF', marginLeft: 8 }}
                      >
                        {t('community.pendingRequests.requestToJoin')}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              <Text
                size="xs"
                style={{ color: colors.textMuted, marginTop: 12, textAlign: 'center' }}
              >
                {t('community.nonMember.joinToAccessContent')}
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Request Sent Success Modal */}
        <InfoModal
          visible={showRequestSentModal}
          onClose={() => setShowRequestSentModal(false)}
          title={t('community.qrScanner.requestSent')}
          message={t('community.qrScanner.requestSentMessage', { communityName: community.name })}
          iconName="checkmark-circle"
          closeLabel={t('common.ok')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              refetch();
              refetchPendingRequests();
              refetchMemberMatches();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {/* Header Section */}
        {community.cover_image_url ? (
          <Image
            source={{ uri: community.cover_image_url }}
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
              <Ionicons name="globe-outline" size={48} color={colors.primary} />
            </View>
          </View>
        )}

        {/* Community Info Card */}
        <View
          style={[
            styles.infoCard,
            { backgroundColor: colors.cardBackground, borderColor: colors.border },
          ]}
        >
          <View style={styles.titleRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <Text weight="bold" size="xl" style={{ color: colors.text }}>
                {community.name}
              </Text>
              {(() => {
                const sportName = getSportName(community.sport_id);
                if (!community.sport_id) {
                  // Show both sports icons when no specific sport is set
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                      <SportIcon sportName="tennis" size={18} color={colors.textMuted} />
                      <Text style={{ color: colors.textMuted, marginHorizontal: 2, fontSize: 12 }}>
                        +
                      </Text>
                      <SportIcon sportName="pickleball" size={18} color={colors.textMuted} />
                    </View>
                  );
                }
                if (sportName?.toLowerCase() === 'tennis') {
                  return (
                    <View style={{ marginLeft: 8 }}>
                      <SportIcon sportName="tennis" size={20} color={colors.textMuted} />
                    </View>
                  );
                }
                if (sportName?.toLowerCase() === 'pickleball') {
                  return (
                    <View style={{ marginLeft: 8 }}>
                      <SportIcon sportName="pickleball" size={20} color={colors.textMuted} />
                    </View>
                  );
                }
                return null;
              })()}
            </View>
            {/* Certification badge for verified communities */}
            {community.is_certified && (
              <View
                style={[styles.visibilityBadge, { backgroundColor: '#E3F2FD', marginRight: 8 }]}
              >
                <MaterialCommunityIcons name="check-decagram" size={14} color={colors.primary} />
                <Text size="xs" weight="semibold" style={{ color: colors.primary, marginLeft: 4 }}>
                  {t('community.certified')}
                </Text>
              </View>
            )}
            {community.is_public ? (
              <View style={[styles.visibilityBadge, { backgroundColor: '#E8F5E9' }]}>
                <Ionicons name="globe-outline" size={14} color="#2E7D32" />
                <Text size="xs" weight="semibold" style={{ color: '#2E7D32', marginLeft: 4 }}>
                  {t('community.visibility.public')}
                </Text>
              </View>
            ) : (
              <View
                style={[
                  styles.visibilityBadge,
                  { backgroundColor: isDark ? '#2C2C2E' : '#FFF3E0' },
                ]}
              >
                <Ionicons name="lock-closed-outline" size={14} color="#EF6C00" />
                <Text size="xs" weight="semibold" style={{ color: '#EF6C00', marginLeft: 4 }}>
                  {t('community.visibility.private')}
                </Text>
              </View>
            )}
          </View>

          {/* Members Row */}
          <TouchableOpacity
            style={styles.membersRow}
            onPress={() =>
              community &&
              SheetManager.show('member-list', {
                payload: {
                  group: community as unknown as GroupWithMembers,
                  currentUserId: playerId ?? '',
                  isModerator: isModerator ?? false,
                  type: 'community',
                  onMemberRemoved: () => refetch(),
                  onPlayerPress: (memberId: string) => {
                    SheetManager.hide('member-list');
                    handleNavigateToPlayer(memberId);
                  },
                },
              })
            }
          >
            <Text size="sm" style={{ color: colors.textSecondary }}>
              {t('common.memberCount', { count: community.member_count })}
            </Text>
            <View style={styles.memberAvatars}>
              {community.members.slice(0, 5).map((member, index) => (
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
              {community.member_count > 5 && (
                <View
                  style={[styles.memberAvatar, { backgroundColor: colors.primary, marginLeft: -8 }]}
                >
                  <Text size="xs" weight="semibold" style={{ color: '#FFFFFF' }}>
                    +{community.member_count - 5}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          {/* Action Buttons Row - Only show for active members */}
          {isActiveMember && (
            <View style={styles.actionButtonsRow}>
              <TouchableOpacity
                style={[styles.addMemberButton, { borderColor: colors.primary, flex: 1 }]}
                onPress={() =>
                  SheetManager.show('add-community-member', {
                    payload: {
                      communityId,
                      currentMemberIds: community?.members.map(m => m.player_id) ?? [],
                      onSuccess: () => refetch(),
                    },
                  })
                }
              >
                <Ionicons name="person-add-outline" size={18} color={colors.primary} />
                <Text weight="semibold" style={{ color: colors.primary, marginLeft: 8 }}>
                  {t('community.members.addMember')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.menuButton, { borderColor: colors.primary }]}
                onPress={() =>
                  SheetManager.show('invite-link', {
                    payload: {
                      groupId: communityId,
                      groupName: community?.name ?? '',
                      currentUserId: playerId ?? '',
                      isModerator: isModerator ?? false,
                      type: 'community',
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
          )}
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
                {t(`community.tabs.${tabKey}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Content */}
        {renderTabContent()}

        {/* Bottom spacing */}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Bottom Action Button - changes based on active tab */}
      {activeTab === 'home' ? (
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
            {t('community.chat.chatWithMembers')}
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* Pending Requests Modal */}
      <Modal
        visible={showPendingRequestsModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPendingRequestsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            onPress={() => setShowPendingRequestsModal(false)}
            activeOpacity={1}
          />
          <View style={[styles.modalContent, { backgroundColor: colors.cardBackground }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text weight="bold" size="lg" style={{ color: colors.text }}>
                Pending Requests
              </Text>
              <TouchableOpacity onPress={() => setShowPendingRequestsModal(false)}>
                <Ionicons name="close-outline" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {pendingRequests && pendingRequests.length > 0 ? (
                pendingRequests.map(request => (
                  <View
                    key={request.id}
                    style={[styles.requestCard, { borderColor: colors.border }]}
                  >
                    <TouchableOpacity
                      style={styles.requestHeader}
                      onPress={() => {
                        setShowPendingRequestsModal(false);
                        handleNavigateToPlayer(request.player_id);
                      }}
                    >
                      <View
                        style={[
                          styles.requestAvatar,
                          { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' },
                        ]}
                      >
                        {request.player_profile_picture ? (
                          <Image
                            source={{ uri: request.player_profile_picture }}
                            style={styles.requestAvatarImage}
                          />
                        ) : (
                          <Ionicons name="person-outline" size={24} color={colors.textMuted} />
                        )}
                      </View>
                      <View style={styles.requestInfo}>
                        <Text weight="semibold" style={{ color: colors.text }}>
                          {request.player_name || 'Player'}
                        </Text>
                        <Text size="sm" style={{ color: colors.textSecondary }}>
                          Requested{' '}
                          {new Date(request.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                          {request.referrer_name && ` · Referred by ${request.referrer_name}`}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <View style={styles.requestActions}>
                      <TouchableOpacity
                        style={[styles.approveButton, { backgroundColor: colors.primary }]}
                        onPress={async () => {
                          if (!playerId) return;
                          try {
                            mediumHaptic();
                            await approveMemberMutation.mutateAsync({
                              communityId,
                              memberId: request.id,
                              approverId: playerId,
                            });
                            refetchPendingRequests();
                            refetch();
                          } catch (error) {
                            Alert.alert(
                              'Error',
                              error instanceof Error ? error.message : 'Failed to approve member'
                            );
                          }
                        }}
                        disabled={approveMemberMutation.isPending || rejectMemberMutation.isPending}
                      >
                        <Ionicons name="checkmark-outline" size={18} color="#FFFFFF" />
                        <Text
                          weight="semibold"
                          size="sm"
                          style={{ color: '#FFFFFF', marginLeft: 4 }}
                        >
                          Approve
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.rejectButton, { borderColor: colors.border }]}
                        onPress={async () => {
                          if (!playerId) return;
                          try {
                            mediumHaptic();
                            await rejectMemberMutation.mutateAsync({
                              communityId,
                              memberId: request.id,
                              rejectorId: playerId,
                            });
                            refetchPendingRequests();
                          } catch (error) {
                            Alert.alert(
                              'Error',
                              error instanceof Error ? error.message : 'Failed to reject request'
                            );
                          }
                        }}
                        disabled={approveMemberMutation.isPending || rejectMemberMutation.isPending}
                      >
                        <Ionicons name="close-outline" size={18} color={colors.text} />
                        <Text
                          weight="semibold"
                          size="sm"
                          style={{ color: colors.text, marginLeft: 4 }}
                        >
                          Decline
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.emptyRequests}>
                  <Ionicons name="checkmark-circle-outline" size={48} color={colors.textMuted} />
                  <Text style={{ color: colors.textSecondary, marginTop: 12 }}>
                    No pending requests
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add Score Flow Modals */}
      <AddScoreIntroModal
        visible={showAddScoreIntro}
        onClose={() => setShowAddScoreIntro(false)}
        onAddScore={handleAddScoreIntroComplete}
        onNeverShowAgain={() => {
          AsyncStorage.setItem(ADD_SCORE_INTRO_KEY, 'true').catch(console.error);
          setHasSeenAddScoreIntro(true);
          handleAddScoreIntroComplete();
        }}
      />

      <AddScoreModal
        visible={showAddScoreModal}
        onClose={() => setShowAddScoreModal(false)}
        onSuccess={handleAddScoreSuccess}
        matchType={selectedMatchType}
        networkId={communityId}
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  visibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
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
  // Community Stats styles
  communityStatsCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  communityStatsList: {
    flexDirection: 'row',
    gap: 16,
  },
  communityStatItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  communityStatIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  communityStatInfo: {
    marginLeft: 12,
  },
  pendingRequestsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
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
  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  modalBody: {
    padding: 16,
  },
  requestCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  requestAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  requestAvatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  requestInfo: {
    flex: 1,
    marginLeft: 12,
  },
  requestActions: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 12,
  },
  approveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  emptyRequests: {
    padding: 40,
    alignItems: 'center',
  },
  // Leaderboard styles
  leaderboardPreview: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  pendingRequestsCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  pendingRequestsList: {
    marginTop: 12,
  },
  pendingRequestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pendingRequestInfo: {
    flex: 1,
    marginLeft: 10,
  },
  pendingRequestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  miniApproveButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniRejectButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeCount: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
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
  leaderboardPreviewList: {
    marginTop: 16,
    gap: 12,
  },
  leaderboardPreviewItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  smallAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  // Matches Preview styles
  matchesPreview: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  matchesPreviewList: {
    marginTop: 16,
    gap: 12,
  },
  matchPreviewCard: {
    padding: 12,
    borderRadius: 12,
  },
  matchPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  matchSlotBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  matchPreviewDetails: {
    marginTop: 10,
    gap: 4,
  },
  matchPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  matchesEmptyState: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  periodSelector: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  periodOption: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  leaderboardCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  leaderboardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  leaderboardRank: {
    width: 32,
    marginRight: 12,
    alignItems: 'center',
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaderboardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  leaderboardAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  leaderboardInfo: {
    flex: 1,
    marginLeft: 12,
  },
  emptyLeaderboard: {
    padding: 40,
    alignItems: 'center',
  },
  // Pending card styles
  pendingCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 24,
    alignItems: 'center',
  },
  // Activity styles
  activityList: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityContent: {
    flex: 1,
    marginLeft: 12,
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
  // Team Card styles for Recent Games
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
  // Non-member view styles
  nonMemberHeader: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 10,
  },
  backButtonCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  memberCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nonMemberActions: {
    marginTop: 24,
    alignItems: 'center',
  },
  pendingStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
  },
  requestToJoinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
  },
});
