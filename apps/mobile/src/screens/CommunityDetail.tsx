/**
 * CommunityDetail Screen
 * Shows community details with tabs: Home, Leaderboard, Games
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
import { lightHaptic, mediumHaptic, selectionHaptic } from '@rallia/shared-utils';
import {
  useCommunityWithMembers,
  useIsCommunityModerator,
  useLeaveCommunity,
  useDeleteCommunity,
  usePendingCommunityMembers,
  useCommunityRealtime,
  usePendingRequestsRealtime,
  useGroupStats,
  useGroupActivity,
  useCommunityAccess,
  useRequestToJoinCommunity,
  useConversationUnreadCount,
  useConversationUnreadCountLast7Days,
  useConversationUnreadRealtime,
  useSports,
  usePlayer,
  usePlayerMeetsCommunityRating,
} from '@rallia/shared-hooks';
import type { GroupMatch } from '@rallia/shared-hooks';
import type { GroupWithMembers } from '@rallia/shared-services';
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
import RatingBadge from '../components/RatingBadge';
import type { RootStackParamList } from '../navigation/types';
import { AddScoreIntroModal, AddScoreModal, type MatchType } from '../features/matches';
import { NetworkLeaderboardTab, NetworkMatchesTab } from '../features/matches/components';
import { NetworkFavoriteFacilities } from '../components/NetworkFavoriteFacilities';
import { InfoModal } from '../components/InfoModal';

const HEADER_HEIGHT = 140;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type CommunityDetailRouteProp = RouteProp<RootStackParamList, 'CommunityDetail'>;

type TabKey = 'leaderboard' | 'games';

const TAB_KEYS: TabKey[] = ['games', 'leaderboard'];

const TAB_ICONS: Record<TabKey, keyof typeof Ionicons.glyphMap> = {
  leaderboard: 'podium-outline',
  games: 'tennisball-outline', // placeholder, overridden with SportIcon
};

// Storage key for "never show intro again"
const ADD_SCORE_INTRO_KEY = 'rallia_add_score_intro_dismissed';

export default function CommunityDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<CommunityDetailRouteProp>();
  const { communityId, fromChat } = route.params;

  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { t, locale } = useTranslation();
  const { guardAction } = useRequireOnboarding();
  const { selectedSport } = useSport();
  const { sports } = useSports();
  const playerId = session?.user?.id;
  const navigateToPlayerProfile = useNavigateToPlayerProfile();
  const { player } = usePlayer();

  const insets = useSafeAreaInsets();

  // Get all sport IDs and names for facility search when community has no specific sport
  const { allSportIds, sportNames } = useMemo(() => {
    if (!sports) return { allSportIds: [], sportNames: [] };
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
    playerId,
    selectedSport?.id
  );
  const { data: stats } = useGroupStats(communityId);
  const { data: activities } = useGroupActivity(communityId, 50);

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
  const requestToJoinMutation = useRequestToJoinCommunity();

  // Check if player meets community rating requirement (for non-members)
  const { data: ratingCheck } = usePlayerMeetsCommunityRating(
    community?.min_rating_score_id ? communityId : undefined,
    playerId
  );

  // Derive sport name for rating requirement display
  const communitySportName = useMemo(() => {
    if (!community?.sport_id || !sports) return undefined;
    const sport = sports.find(s => s.id === community.sport_id);
    return sport?.name ? sport.name.charAt(0).toUpperCase() + sport.name.slice(1) : undefined;
  }, [community?.sport_id, sports]);

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

  // Set header title to community name
  useEffect(() => {
    if (community?.name) {
      navigation.setOptions({ headerTitle: community.name });
    }
  }, [navigation, community?.name]);

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

  const handleMatchTypeSelect = useCallback((type: MatchType) => {
    selectionHaptic();
    setSelectedMatchType(type);
    setShowAddScoreModal(true);
  }, []);

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
      case 'leaderboard': {
        return (
          <NetworkLeaderboardTab
            networkId={communityId}
            networkType="community"
            currentPlayerId={playerId ?? undefined}
            onAddScorePress={handleAddGame}
            onPlayerPress={handleNavigateToPlayer}
            onChallengePress={() => handleAddGame()}
          />
        );
      }

      case 'games':
        return (
          <NetworkMatchesTab
            networkId={communityId}
            networkType="community"
            sportId={community?.sport_id}
            inline
          />
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
        edges={['bottom']}
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
        edges={['bottom']}
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
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Header with back button */}
          <View style={styles.nonMemberHeader}>
            <TouchableOpacity
              style={[styles.backButtonCircle, { backgroundColor: colors.cardBackground }]}
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="chevron-back" size={24} color={colors.text} />
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
            <Text weight="bold" size="xl" style={{ color: colors.text }}>
              {community.name}
            </Text>
            <View style={styles.badgeRow}>
              {/* Certification badge for verified communities */}
              {community.is_certified && (
                <View
                  style={[
                    styles.infoBadge,
                    { backgroundColor: isDark ? `${primary[400]}30` : `${primary[500]}15` },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="check-decagram"
                    size={12}
                    color={isDark ? primary[400] : primary[500]}
                    style={styles.infoBadgeIcon}
                  />
                  <Text
                    size="xs"
                    weight="semibold"
                    style={{ color: isDark ? primary[400] : primary[500] }}
                  >
                    {t('community.certified')}
                  </Text>
                </View>
              )}
              {!community.is_private ? (
                <View
                  style={[
                    styles.infoBadge,
                    { backgroundColor: isDark ? `${primary[400]}30` : `${primary[500]}15` },
                  ]}
                >
                  <Ionicons
                    name="globe-outline"
                    size={12}
                    color={isDark ? primary[400] : primary[500]}
                    style={styles.infoBadgeIcon}
                  />
                  <Text
                    size="xs"
                    weight="semibold"
                    style={{ color: isDark ? primary[400] : primary[500] }}
                  >
                    {t('community.visibility.public')}
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.infoBadge,
                    { backgroundColor: isDark ? `${neutral[600]}40` : `${neutral[500]}20` },
                  ]}
                >
                  <Ionicons
                    name="lock-closed"
                    size={12}
                    color={isDark ? neutral[300] : neutral[600]}
                    style={styles.infoBadgeIcon}
                  />
                  <Text
                    size="xs"
                    weight="semibold"
                    style={{ color: isDark ? neutral[300] : neutral[600] }}
                  >
                    {t('community.visibility.private')}
                  </Text>
                </View>
              )}
              {community.min_rating_score_id && (
                <RatingBadge
                  ratingLabel={t('community.minRatingBadge', {
                    label: ratingCheck?.min_rating_label ?? '...',
                  })}
                  certificationStatus={community.require_certified_rating ? 'certified' : undefined}
                  isDark={isDark}
                  size="sm"
                />
              )}
            </View>

            {community.description && (
              <Text size="sm" style={{ color: colors.textSecondary, marginTop: 8, lineHeight: 20 }}>
                {community.description}
              </Text>
            )}

            {/* Members Row */}
            <View style={[styles.membersRow, { marginTop: 16 }]}>
              <Text size="sm" style={{ color: colors.textSecondary }}>
                {t('common.memberCount', { count: community.member_count || 0 })}
              </Text>
              <View style={styles.memberAvatars}>
                {community.members?.slice(0, 5).map((member, index) => (
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
                {(community.member_count || 0) > 5 && (
                  <View
                    style={[
                      styles.memberAvatar,
                      { backgroundColor: colors.primary, marginLeft: -8 },
                    ]}
                  >
                    <Text size="xs" weight="semibold" style={{ color: '#FFFFFF' }}>
                      +{(community.member_count || 0) - 5}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Info Section */}
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
              ) : ratingCheck && !ratingCheck.meets_requirement ? (
                <View>
                  <View
                    style={[
                      styles.ratingRequirementBox,
                      { backgroundColor: isDark ? '#3C3C3E' : '#FFF3E0' },
                    ]}
                  >
                    <Ionicons
                      name="alert-circle-outline"
                      size={20}
                      color="#EF6C00"
                      style={{ marginRight: 8 }}
                    />
                    <View style={{ flex: 1 }}>
                      {ratingCheck.reason === 'NO_RATING' ? (
                        <Text size="sm" style={{ color: colors.text }}>
                          {t('community.ratingRequired', { sport: communitySportName ?? '' })}
                        </Text>
                      ) : ratingCheck.reason === 'CERTIFIED_REQUIRED' ? (
                        <>
                          <Text size="sm" style={{ color: colors.text }}>
                            {t('community.ratingRequirementCertifiedNeeded')}
                          </Text>
                          {ratingCheck.player_rating_label && (
                            <Text size="xs" style={{ color: colors.textSecondary, marginTop: 4 }}>
                              {ratingCheck.player_rating_label} → {ratingCheck.min_rating_label}+
                            </Text>
                          )}
                        </>
                      ) : (
                        <>
                          <Text size="sm" style={{ color: colors.text }}>
                            {t('community.ratingRequirementNotMet')}
                          </Text>
                          <Text size="xs" style={{ color: colors.textSecondary, marginTop: 4 }}>
                            {ratingCheck.player_rating_label ?? '—'} →{' '}
                            {ratingCheck.min_rating_label}+
                          </Text>
                        </>
                      )}
                    </View>
                  </View>
                </View>
              ) : null}

              <Text
                size="xs"
                style={{ color: colors.textMuted, marginTop: 12, textAlign: 'center' }}
              >
                {t('community.nonMember.joinToAccessContent')}
              </Text>
            </View>

            {/* Bottom spacing for floating button */}
            <View style={{ height: 80 }} />
          </View>
        </ScrollView>

        {/* Floating Join / Pending CTA */}
        {!(ratingCheck && !ratingCheck.meets_requirement) && (
          <Button
            variant="primary"
            size="lg"
            disabled={isPendingMember}
            loading={requestToJoinMutation.isPending}
            onPress={isPendingMember ? undefined : handleRequestToJoin}
            leftIcon={
              !requestToJoinMutation.isPending ? (
                <Ionicons
                  name={isPendingMember ? 'time-outline' : 'person-add-outline'}
                  size={20}
                  color="#FFFFFF"
                />
              ) : undefined
            }
            isDark={isDark}
            style={[styles.chatButton, { bottom: Math.max(insets.bottom, 20) + 12 }]}
          >
            {isPendingMember
              ? t('community.pendingRequests.pendingApproval')
              : t('community.pendingRequests.requestToJoin')}
          </Button>
        )}

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
              if (isModerator) {
                refetchPendingRequests();
              }
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
          <Text weight="bold" size="xl" style={{ color: colors.text }}>
            {community.name}
          </Text>
          <View style={styles.badgeRow}>
            {/* Certification badge for verified communities */}
            {community.is_certified && (
              <View
                style={[
                  styles.infoBadge,
                  { backgroundColor: isDark ? `${primary[400]}30` : `${primary[500]}15` },
                ]}
              >
                <MaterialCommunityIcons
                  name="check-decagram"
                  size={12}
                  color={isDark ? primary[400] : primary[500]}
                  style={styles.infoBadgeIcon}
                />
                <Text
                  size="xs"
                  weight="semibold"
                  style={{ color: isDark ? primary[400] : primary[500] }}
                >
                  {t('community.certified')}
                </Text>
              </View>
            )}
            {community.is_public ? (
              <View
                style={[
                  styles.infoBadge,
                  { backgroundColor: isDark ? `${primary[400]}30` : `${primary[500]}15` },
                ]}
              >
                <Ionicons
                  name="globe-outline"
                  size={12}
                  color={isDark ? primary[400] : primary[500]}
                  style={styles.infoBadgeIcon}
                />
                <Text
                  size="xs"
                  weight="semibold"
                  style={{ color: isDark ? primary[400] : primary[500] }}
                >
                  {t('community.visibility.public')}
                </Text>
              </View>
            ) : (
              <View
                style={[
                  styles.infoBadge,
                  { backgroundColor: isDark ? `${neutral[600]}40` : `${neutral[500]}20` },
                ]}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={12}
                  color={isDark ? neutral[300] : neutral[600]}
                  style={styles.infoBadgeIcon}
                />
                <Text
                  size="xs"
                  weight="semibold"
                  style={{ color: isDark ? neutral[300] : neutral[600] }}
                >
                  {t('community.visibility.private')}
                </Text>
              </View>
            )}
            {community.min_rating_score_id && (
              <RatingBadge
                ratingLabel={t('community.minRatingBadge', {
                  label: ratingCheck?.min_rating_label ?? '...',
                })}
                certificationStatus={community.require_certified_rating ? 'certified' : undefined}
                isDark={isDark}
                size="sm"
              />
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
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.actionButtonsScroll}
              contentContainerStyle={styles.actionButtonsContent}
            >
              {isModerator && pendingRequests && pendingRequests.length > 0 && (
                <TouchableOpacity
                  style={[
                    styles.actionPill,
                    {
                      backgroundColor: isDark ? '#3A2A00' : '#FFF8E1',
                      borderColor: isDark ? '#FF9500' : '#FFB74D',
                    },
                  ]}
                  onPress={() =>
                    SheetManager.show('pending-requests', {
                      payload: {
                        communityId,
                        sportId: selectedSport?.id,
                        onMemberChanged: () => refetch(),
                        onNavigateToPlayer: handleNavigateToPlayer,
                      },
                    })
                  }
                  activeOpacity={0.7}
                >
                  <Ionicons name="time-outline" size={14} color="#FF9500" />
                  <Text style={[styles.actionPillText, { color: '#FF9500' }]}>
                    {pendingRequests.length} Pending
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
                  SheetManager.show('add-community-member', {
                    payload: {
                      communityId,
                      currentMemberIds: community?.members.map(m => m.player_id) ?? [],
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
                  {t('community.addPlayer')}
                </Text>
              </TouchableOpacity>
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
                      groupId: communityId,
                      groupName: community?.name ?? '',
                      currentUserId: playerId ?? '',
                      isModerator: isModerator ?? false,
                      type: 'community',
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
                  {t('community.detail.sendInvite')}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>

        {/* About Section */}
        {community?.description && (
          <View style={{ marginHorizontal: 16, marginTop: 16 }}>
            <Text size="lg" weight="bold" style={{ color: colors.text, marginBottom: 8 }}>
              {t('community.detail.about')}
            </Text>
            <View
              style={[
                styles.aboutCard,
                { backgroundColor: colors.cardBackground, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: colors.textSecondary, lineHeight: 22 }}>
                {community.description}
              </Text>
            </View>
          </View>
        )}

        {/* Favorite Facilities Section */}
        {community?.sport_id && (
          <View style={{ marginHorizontal: 16 }}>
            <NetworkFavoriteFacilities
              networkId={communityId}
              currentPlayerId={playerId ?? null}
              sportId={community.sport_id}
              latitude={player?.latitude ?? null}
              longitude={player?.longitude ?? null}
              translationPrefix="community"
              onNavigateToFacility={handleNavigateToFacility}
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

      {/* Bottom Action Button - Ask to join for non-members, Chat for members */}
      {!fromChat ? (
        isActiveMember ? (
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
            {t('community.chat.chatWithMembers')}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            disabled={isPendingMember}
            loading={requestToJoinMutation.isPending}
            onPress={isPendingMember ? undefined : handleRequestToJoin}
            leftIcon={
              !requestToJoinMutation.isPending ? (
                <Ionicons
                  name={isPendingMember ? 'time-outline' : 'person-add-outline'}
                  size={20}
                  color="#FFFFFF"
                />
              ) : undefined
            }
            isDark={isDark}
            style={[styles.chatButton, { bottom: Math.max(insets.bottom, 20) + 12 }]}
          >
            {isPendingMember
              ? t('community.pendingRequests.pendingApproval')
              : t('community.pendingRequests.requestToJoin')}
          </Button>
        )
      ) : null}

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
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
    marginTop: spacingPixels[3],
  },
  infoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  infoBadgeIcon: {
    marginRight: spacingPixels[1],
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
  // Community Stats styles
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
  // Leaderboard styles
  // Matches Preview styles
  // Pending card styles
  // Activity styles
  // Recent Games Card
  // Match Card Styles
  // Team Card styles for Recent Games
  // Leaderboard Section Styles
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
  ratingRequirementBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 12,
    width: '100%',
  },
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
