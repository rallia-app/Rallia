/**
 * Communities Screen
 * Lists all public communities for discovery and communities the user is a member of
 * Features a segmented control to switch between "Discover" and "My Communities"
 */

import React, { useState, useCallback, useLayoutEffect, useMemo, useEffect, useRef } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  RefreshControl,
  Alert,
  Image,
  Dimensions,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Text, Skeleton, Button, useToast } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import {
  useThemeStyles,
  useAuth,
  useTranslation,
  useRequireOnboarding,
  type TranslationKey,
} from '../hooks';
import { useSport, useMatchDetailSheet } from '../context';
import type { MatchDetailData } from '../context';
import {
  usePublicCommunities,
  usePlayerCommunities,
  useRequestToJoinCommunity,
  usePlayerCommunitiesRealtime,
  usePublicCommunitiesRealtime,
  useSports,
  type CommunityWithStatus,
} from '@rallia/shared-hooks';
import type { RootStackParamList, CommunityStackParamList } from '../navigation/types';
import type { CompositeNavigationProp } from '@react-navigation/native';
import {
  InviteQRScannerModal,
  type InviteScanJoinResult,
} from '../components/InviteQRScannerModal';
import { getJoinErrorToastMessage } from '../utils/joinErrorToast';
import { SheetManager } from 'react-native-actions-sheet';
import { InfoModal } from '../components/InfoModal';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 12;
const CARD_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP) / 2;

type NavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<CommunityStackParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
}

// Extracted CommunityCard component with press animation
const CommunityCard: React.FC<{
  item: CommunityWithStatus;
  index: number;
  colors: ThemeColors;
  isDark: boolean;
  activeTab: TabType;
  onPress: (community: CommunityWithStatus) => void;
  onRequestToJoin: (id: string, name: string) => void;
  requestingCommunityId: string | null;
}> = ({
  item,
  index,
  colors,
  isDark,
  activeTab,
  onPress,
  onRequestToJoin,
  requestingCommunityId,
}) => {
  const scaleAnim = useMemo(() => new Animated.Value(1), []);
  const { t } = useTranslation();
  // Only show as member if they have active status (not pending)
  const isUserMember = item.is_member && item.membership_status === 'active';
  const isPending = item.membership_status === 'pending';

  const handlePressIn = useCallback(() => {
    Animated.timing(scaleAnim, {
      toValue: 0.97,
      duration: 100,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  return (
    <TouchableWithoutFeedback
      onPress={() => onPress(item)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[
          styles.communityCard,
          {
            backgroundColor: colors.cardBackground,
            borderColor: colors.border,
            marginRight: index % 2 === 0 ? CARD_GAP : 0,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {/* Cover Image */}
        <View style={styles.imageContainer}>
          {item.cover_image_url ? (
            <Image
              source={{ uri: item.cover_image_url }}
              style={styles.coverImage}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[styles.placeholderImage, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}
            >
              <Ionicons name="globe-outline" size={40} color={colors.textMuted} />
            </View>
          )}

          {/* Public/Private badge */}
          {!item.is_public && (
            <View style={[styles.badgeContainer, { backgroundColor: '#FF9500' }]}>
              <Ionicons name="lock-closed" size={10} color="#FFFFFF" />
              <Text size="xs" weight="semibold" style={styles.badgeText}>
                {t('community.visibility.private')}
              </Text>
            </View>
          )}
        </View>

        {/* Community Info */}
        <View style={styles.communityInfo}>
          <View style={styles.titleRow}>
            <View style={styles.nameWithBadge}>
              <Text
                weight="semibold"
                size="sm"
                style={[{ color: colors.text }, styles.titleText]}
                numberOfLines={2}
              >
                {item.name}
              </Text>
              {item.is_certified && (
                <MaterialCommunityIcons name="check-decagram" size={14} color="#22c55e" />
              )}
            </View>
          </View>

          {/* Member count + Status */}
          <View style={styles.bottomRow}>
            <View style={styles.memberCount}>
              <Ionicons name="people-outline" size={14} color={colors.textMuted} />
              <Text size="xs" style={{ color: colors.textMuted, marginLeft: 4 }}>
                {t('common.memberCount', { count: item.member_count })}
              </Text>
            </View>
          </View>

          {/* Join button for non-members in discover tab */}
          {activeTab === 'discover' && !isUserMember && !isPending && (
            <Button
              variant="primary"
              size="xs"
              fullWidth
              onPress={e => {
                e?.stopPropagation();
                onRequestToJoin(item.id, item.name);
              }}
              disabled={requestingCommunityId === item.id}
              isDark={isDark}
              style={styles.joinButton}
            >
              {t('community.pendingRequests.requestToJoin')}
            </Button>
          )}

          {/* Pending indicator */}
          {isPending && (
            <View
              style={[styles.pendingBadge, { backgroundColor: isDark ? '#3C3C3E' : '#E5E5EA' }]}
            >
              <Ionicons name="time-outline" size={12} color={colors.textMuted} />
              <Text size="xs" style={{ color: colors.textMuted, marginLeft: 4 }}>
                {t('community.pendingRequests.pending')}
              </Text>
            </View>
          )}

          {/* Member indicator */}
          {isUserMember && (
            <View style={[styles.memberBadge, { backgroundColor: '#34C75920' }]}>
              <Ionicons name="checkmark-circle" size={12} color="#34C759" />
              <Text size="xs" style={{ color: '#34C759', marginLeft: 4 }}>
                {t('community.memberBadge')}
              </Text>
            </View>
          )}
        </View>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
};

type TabType = 'discover' | 'my-communities';

export default function CommunitiesScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { t } = useTranslation();
  const { guardAction } = useRequireOnboarding();
  const { selectedSport } = useSport();
  const { openSheet: openMatchDetail } = useMatchDetailSheet();
  const toast = useToast();
  const playerId = session?.user?.id;

  const [activeTab, setActiveTab] = useState<TabType>('discover');
  const [showQRScanner, setShowQRScanner] = useState(false);

  const openScanner = useCallback(() => {
    lightHaptic();
    if (!guardAction()) return;
    setShowQRScanner(true);
  }, [guardAction]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={openScanner}
          style={styles.headerButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('inviteScanner.title')}
        >
          <Ionicons name="qr-code-outline" size={24} color={colors.headerForeground} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, openScanner, colors.headerForeground, t]);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successModalCommunityName, setSuccessModalCommunityName] = useState('');

  // Switch to discover tab if user signs out while on "My Communities"
  useEffect(() => {
    if (activeTab === 'my-communities' && !playerId) {
      // Use setTimeout to avoid calling setState synchronously within effect
      setTimeout(() => {
        setActiveTab('discover');
      }, 0);
    }
  }, [activeTab, playerId]);

  // Queries - filter by selected sport
  const {
    data: publicCommunities,
    isLoading: isLoadingPublic,
    isRefetching: isRefetchingPublic,
    isFetchingNextPage: isFetchingNextPublic,
    hasNextPage: hasNextPublic,
    fetchNextPage: fetchNextPublic,
    refetch: refetchPublic,
  } = usePublicCommunities(playerId, selectedSport?.id);

  const {
    data: myCommunities,
    isLoading: isLoadingMy,
    isRefetching: isRefetchingMy,
    refetch: refetchMy,
  } = usePlayerCommunities(playerId, selectedSport?.id);

  // Real-time subscriptions
  usePlayerCommunitiesRealtime(playerId);
  usePublicCommunitiesRealtime(playerId);

  // Mutations
  const requestToJoinMutation = useRequestToJoinCommunity();
  const requestingCommunityId = requestToJoinMutation.isPending
    ? (requestToJoinMutation.variables?.communityId ?? null)
    : null;

  const isLoading = activeTab === 'discover' ? isLoadingPublic : isLoadingMy;
  const isRefetching = activeTab === 'discover' ? isRefetchingPublic : isRefetchingMy;
  const communities = activeTab === 'discover' ? publicCommunities : myCommunities;
  const isManualRefresh = useRef(false);

  const handleRefresh = useCallback(() => {
    isManualRefresh.current = true;
    const refetchFn = activeTab === 'discover' ? refetchPublic : refetchMy;
    refetchFn().finally(() => {
      isManualRefresh.current = false;
    });
  }, [activeTab, refetchPublic, refetchMy]);

  const handleEndReached = useCallback(() => {
    if (activeTab === 'discover' && hasNextPublic && !isFetchingNextPublic) {
      fetchNextPublic();
    }
  }, [activeTab, hasNextPublic, isFetchingNextPublic, fetchNextPublic]);

  const handleOpenCreateCommunityActionSheet = useCallback(() => {
    lightHaptic();
    if (!guardAction() || !playerId) return;
    SheetManager.show('create-community', { payload: { playerId } });
  }, [guardAction, playerId]);

  const handleRequestToJoin = useCallback(
    async (communityId: string, communityName: string) => {
      if (!guardAction()) return;

      try {
        await requestToJoinMutation.mutateAsync({ communityId, playerId: playerId! });
        setSuccessModalCommunityName(communityName);
        setShowSuccessModal(true);
      } catch (error) {
        toast.error(getJoinErrorToastMessage(error, t));
      }
    },
    [guardAction, playerId, requestToJoinMutation, toast, t]
  );

  const handleCommunityPress = useCallback(
    (community: CommunityWithStatus) => {
      lightHaptic();
      navigation.navigate('CommunityDetail', { communityId: community.id });
    },
    [navigation]
  );

  const handleScannerJoined = useCallback(
    (result: InviteScanJoinResult) => {
      if (result.kind === 'community') {
        setSuccessModalCommunityName(result.name);
        setShowSuccessModal(true);
        return;
      }
      Alert.alert(
        t('inviteScanner.joinedGroupTitle'),
        t('inviteScanner.joinedGroupMessage', { name: result.name }),
        [
          {
            text: t('common.ok'),
            onPress: () =>
              navigation.navigate('GroupDetail', {
                groupId: result.networkId,
                groupName: result.name,
              }),
          },
        ]
      );
    },
    [navigation, t]
  );

  const handleScannerMatchScanned = useCallback(
    (match: MatchDetailData) => {
      openMatchDetail(match);
    },
    [openMatchDetail]
  );

  const handleTabChange = useCallback(
    (tab: TabType) => {
      lightHaptic();
      // If trying to access "My Communities" without auth/onboarding, open auth sheet
      if (tab === 'my-communities' && !guardAction()) {
        return;
      }
      setActiveTab(tab);
    },
    [guardAction]
  );

  const renderCommunityItem = useCallback(
    ({ item, index }: { item: CommunityWithStatus; index: number }) => {
      return (
        <CommunityCard
          item={item}
          index={index}
          colors={colors}
          isDark={isDark}
          activeTab={activeTab}
          onPress={handleCommunityPress}
          onRequestToJoin={handleRequestToJoin}
          requestingCommunityId={requestingCommunityId}
        />
      );
    },
    [colors, isDark, activeTab, handleCommunityPress, handleRequestToJoin, requestingCommunityId]
  );

  const renderEmptyState = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Ionicons
          name={activeTab === 'discover' ? 'globe-outline' : 'people-outline'}
          size={64}
          color={colors.textMuted}
        />
        <Text weight="semibold" size="lg" style={[styles.emptyTitle, { color: colors.text }]}>
          {activeTab === 'discover'
            ? t('community.empty.discover.title')
            : t('community.empty.myCommunities.title')}
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          {activeTab === 'discover'
            ? t('community.empty.discover.subtitle')
            : t('community.empty.myCommunities.subtitle')}
        </Text>
        {activeTab === 'discover' && (
          <Button
            variant="primary"
            size="md"
            rounded
            onPress={handleOpenCreateCommunityActionSheet}
            leftIcon={<Ionicons name="add-outline" size={20} color="#FFFFFF" />}
            isDark={isDark}
          >
            {t('community.createCommunity')}
          </Button>
        )}
        {activeTab === 'my-communities' && (
          <Button
            variant="primary"
            size="md"
            rounded
            onPress={() => handleTabChange('discover')}
            leftIcon={<Ionicons name="compass-outline" size={20} color="#FFFFFF" />}
            isDark={isDark}
          >
            {t('community.discoverCommunities')}
          </Button>
        )}
      </View>
    ),
    [colors, activeTab, handleTabChange, t, handleOpenCreateCommunityActionSheet]
  );

  const renderTabs = useMemo(
    () => (
      <View style={[styles.tabContainer, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'discover' && [
              styles.activeTab,
              { backgroundColor: colors.cardBackground },
            ],
          ]}
          onPress={() => handleTabChange('discover')}
        >
          <Ionicons
            name="compass-outline"
            size={18}
            color={activeTab === 'discover' ? colors.primary : colors.textMuted}
          />
          <Text
            size="sm"
            weight={activeTab === 'discover' ? 'semibold' : 'medium'}
            style={{
              color: activeTab === 'discover' ? colors.primary : colors.textMuted,
              marginLeft: 6,
            }}
          >
            {t('community.tabs.discover')}
          </Text>
        </TouchableOpacity>
        {/* Only show "My Communities" tab for authenticated users */}
        {playerId && (
          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === 'my-communities' && [
                styles.activeTab,
                { backgroundColor: colors.cardBackground },
              ],
            ]}
            onPress={() => handleTabChange('my-communities')}
          >
            <Ionicons
              name="heart-outline"
              size={18}
              color={activeTab === 'my-communities' ? colors.primary : colors.textMuted}
            />
            <Text
              size="sm"
              weight={activeTab === 'my-communities' ? 'semibold' : 'medium'}
              style={{
                color: activeTab === 'my-communities' ? colors.primary : colors.textMuted,
                marginLeft: 6,
              }}
            >
              {t('community.tabs.myCommunities')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    ),
    [colors, isDark, activeTab, handleTabChange, t, playerId]
  );

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
        {/* Only show tabs when authenticated */}
        {playerId && renderTabs}
        <View style={styles.loadingContainer}>
          <View style={styles.gridSkeleton}>
            {[1, 2, 3, 4, 5, 6].map(i => (
              <View
                key={i}
                style={[styles.cardSkeleton, { backgroundColor: colors.cardBackground }]}
              >
                <Skeleton
                  width="100%"
                  height={CARD_WIDTH * 0.6}
                  borderRadius={12}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  style={{ marginBottom: 12 }}
                />
                <Skeleton
                  width="70%"
                  height={16}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                  style={{ marginBottom: 8 }}
                />
                <Skeleton
                  width="50%"
                  height={12}
                  backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                  highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                />
              </View>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {/* Only show tabs when authenticated (to switch between Discover and My Communities) */}
      {playerId && renderTabs}

      <FlatList
        data={communities}
        renderItem={renderCommunityItem}
        keyExtractor={item => item.id}
        numColumns={2}
        contentContainerStyle={[
          styles.listContent,
          (!communities || communities.length === 0) && styles.emptyListContent,
        ]}
        columnWrapperStyle={
          communities && communities.length > 1 ? styles.columnWrapper : undefined
        }
        ListEmptyComponent={renderEmptyState}
        ListFooterComponent={
          isFetchingNextPublic && activeTab === 'discover' ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && isManualRefresh.current}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Create Community FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={handleOpenCreateCommunityActionSheet}
        activeOpacity={0.8}
      >
        <Ionicons name="add-outline" size={28} color="#FFFFFF" />
      </TouchableOpacity>

      {/* QR Scanner Modal */}
      {playerId && (
        <InviteQRScannerModal
          visible={showQRScanner}
          onClose={() => setShowQRScanner(false)}
          playerId={playerId}
          onJoined={handleScannerJoined}
          onMatchScanned={handleScannerMatchScanned}
        />
      )}

      {/* Request Sent Success Modal */}
      <InfoModal
        visible={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        title={t('community.qrScanner.requestSent')}
        message={t('community.qrScanner.requestSentMessage', {
          communityName: successModalCommunityName,
        })}
        iconName="checkmark-circle"
        closeLabel={t('common.ok')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: CARD_PADDING,
    marginTop: 20,
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
  loadingContainer: {
    flex: 1,
    padding: CARD_PADDING,
  },
  gridSkeleton: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GAP,
  },
  cardSkeleton: {
    width: CARD_WIDTH,
    borderRadius: 16,
    padding: 12,
    marginBottom: CARD_GAP,
  },
  listContent: {
    padding: CARD_PADDING,
    paddingBottom: 100,
  },
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center' as const,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 0,
  },
  columnWrapper: {
    marginBottom: CARD_GAP,
  },
  communityCard: {
    width: CARD_WIDTH,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  imageContainer: {
    width: '100%',
    height: CARD_WIDTH * 0.65,
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  placeholderImage: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeContainer: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  badgeText: {
    color: '#FFFFFF',
  },
  nameWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    flexWrap: 'wrap',
    gap: 4,
  },
  communityInfo: {
    padding: 12,
    gap: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleText: {
    flexShrink: 1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  memberCount: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  joinButton: {
    marginTop: 8,
  },
  pendingBadge: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  memberBadge: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fabSecondary: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
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
  headerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
});
