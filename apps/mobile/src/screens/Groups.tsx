/**
 * Groups Screen
 * Lists all player groups the user is a member of
 * Grid card layout with cover images
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  RefreshControl,
  Image,
  Dimensions,
  Animated,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SheetManager } from 'react-native-actions-sheet';

import { Text, Skeleton } from '@rallia/shared-components';
import { lightHaptic } from '@rallia/shared-utils';
import { getSafeAreaEdges } from '../utils';
import { useThemeStyles, useAuth, useTranslation, useRequireOnboarding } from '../hooks';
import { useSport } from '../context';
import {
  usePlayerGroups,
  usePlayerGroupsRealtime,
  useSports,
  type Group,
} from '@rallia/shared-hooks';
import type { RootStackParamList } from '../navigation/types';
import { QRScannerModal } from '../features/groups';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 12;
const CARD_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - CARD_PADDING * 2 - CARD_GAP) / 2;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface ThemeColors {
  background: string;
  cardBackground: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  primary: string;
}

// Extracted GroupCard component with press animation
const GroupCard: React.FC<{
  item: Group;
  index: number;
  colors: ThemeColors;
  isDark: boolean;
  onPress: (group: Group) => void;
  getSportName: (sportId: string | null) => string | null;
}> = ({ item, index, colors, isDark, onPress, getSportName }) => {
  const scaleAnim = useMemo(() => new Animated.Value(1), []);
  const { t } = useTranslation();
  const hasBooking = false; // TODO: Add booking feature indicator
  const sportName = getSportName(item.sport_id);

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

  // Get sport icon based on sport_id
  const renderSportIcon = () => {
    // null = both sports
    if (!item.sport_id) {
      return (
        <View style={styles.sportIconContainer}>
          <MaterialCommunityIcons name="tennis" size={14} color={colors.textMuted} />
          <Text style={[styles.sportIconPlus, { color: colors.textMuted }]}>+</Text>
          <MaterialCommunityIcons name="badminton" size={14} color={colors.textMuted} />
        </View>
      );
    }
    // Tennis
    if (sportName?.toLowerCase() === 'tennis') {
      return (
        <View style={styles.sportIconContainer}>
          <MaterialCommunityIcons name="tennis" size={16} color={colors.textMuted} />
        </View>
      );
    }
    // Pickleball
    if (sportName?.toLowerCase() === 'pickleball') {
      return (
        <View style={styles.sportIconContainer}>
          <MaterialCommunityIcons name="badminton" size={16} color={colors.textMuted} />
        </View>
      );
    }
    return null;
  };

  return (
    <TouchableWithoutFeedback
      onPress={() => onPress(item)}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View
        style={[
          styles.groupCard,
          {
            backgroundColor: colors.cardBackground,
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
              <Ionicons name="people-outline" size={40} color={colors.textMuted} />
            </View>
          )}

          {/* Badge overlay (e.g., "Court booking" feature) */}
          {hasBooking && (
            <View style={styles.badgeContainer}>
              <Text size="xs" weight="semibold" style={styles.badgeText}>
                Court booking
              </Text>
            </View>
          )}
        </View>

        {/* Group Info */}
        <View style={styles.groupInfo}>
          <View style={styles.titleRow}>
            <Text
              weight="semibold"
              size="sm"
              style={[{ color: colors.text }, styles.titleText]}
              numberOfLines={2}
            >
              {item.name}
            </Text>
            {renderSportIcon()}
          </View>

          {/* Verified indicator + Member count */}
          <View style={styles.bottomRow}>
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#34C759" />
            </View>
            <View style={styles.memberCount}>
              <Ionicons name="people-outline" size={14} color={colors.textMuted} />
              <Text size="xs" style={{ color: colors.textMuted, marginLeft: 4 }}>
                {t('common.memberCount', { count: item.member_count })}
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
};

export default function GroupsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { colors, isDark } = useThemeStyles();
  const { session } = useAuth();
  const { t } = useTranslation();
  const { guardAction } = useRequireOnboarding();
  const { selectedSport } = useSport();
  const playerId = session?.user?.id;

  const [showScannerModal, setShowScannerModal] = useState(false);

  // Filter groups by selected sport
  const {
    data: groups,
    isLoading,
    isRefetching,
    refetch,
  } = usePlayerGroups(playerId, selectedSport?.id);
  const { sports } = useSports();

  // Helper to get sport name from sport_id
  const getSportName = useCallback(
    (sportId: string | null): string | null => {
      if (!sportId || !sports) return null;
      const sport = sports.find(s => s.id === sportId);
      return sport?.name ?? null;
    },
    [sports]
  );

  // Subscribe to real-time updates for player's groups
  usePlayerGroupsRealtime(playerId);

  const handleGroupJoined = useCallback(
    (groupId: string, groupName: string) => {
      // Refetch groups list and navigate to the joined group
      refetch();
      Alert.alert(t('groups.welcome.title'), t('groups.welcome.joinedMessage', { groupName }), [
        {
          text: t('groups.viewGroup'),
          onPress: () => navigation.navigate('GroupDetail', { groupId }),
        },
      ]);
    },
    [refetch, navigation, t]
  );

  const handleGroupPress = useCallback(
    (group: Group) => {
      lightHaptic();
      navigation.navigate('GroupDetail', { groupId: group.id });
    },
    [navigation]
  );

  const renderGroupItem = useCallback(
    ({ item, index }: { item: Group; index: number }) => {
      return (
        <GroupCard
          item={item}
          index={index}
          colors={colors}
          isDark={isDark}
          onPress={handleGroupPress}
          getSportName={getSportName}
        />
      );
    },
    [colors, isDark, handleGroupPress, getSportName]
  );

  const renderEmptyState = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Ionicons name="people-outline" size={64} color={colors.textMuted} />
        <Text weight="semibold" size="lg" style={[styles.emptyTitle, { color: colors.text }]}>
          {t('groups.empty.title')}
        </Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          {t('groups.empty.subtitle')}
        </Text>
        <View style={styles.emptyButtons}>
          <TouchableOpacity
            style={[styles.createButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              if (!guardAction() || !playerId) return;
              SheetManager.show('create-group', { payload: { playerId } });
            }}
          >
            <Ionicons name="add-outline" size={20} color="#FFFFFF" />
            <Text weight="semibold" style={styles.createButtonText}>
              {t('groups.empty.createButton')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.scanButton,
              { backgroundColor: colors.cardBackground, borderColor: colors.border },
            ]}
            onPress={() => {
              if (!guardAction()) return;
              setShowScannerModal(true);
            }}
          >
            <Ionicons name="qr-code-outline" size={20} color={colors.primary} />
            <Text weight="semibold" style={[styles.scanButtonText, { color: colors.primary }]}>
              {t('groups.empty.scanButton')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [colors, t, guardAction, playerId]
  );

  if (isLoading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={getSafeAreaEdges(['bottom'])}
      >
        <View style={styles.loadingContainer}>
          {/* Header skeleton */}
          <View style={styles.headerSkeleton}>
            <Skeleton
              width={100}
              height={24}
              backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
              highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
            />
            <View style={styles.headerSkeletonButtons}>
              <Skeleton
                width={36}
                height={36}
                circle
                backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
                style={{ marginRight: 12 }}
              />
              <Skeleton
                width={36}
                height={36}
                circle
                backgroundColor={isDark ? '#2C2C2E' : '#E1E9EE'}
                highlightColor={isDark ? '#3C3C3E' : '#F2F8FC'}
              />
            </View>
          </View>
          {/* Grid skeleton */}
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
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={getSafeAreaEdges(['bottom'])}
    >
      <FlatList
        data={groups}
        renderItem={renderGroupItem}
        keyExtractor={item => item.id}
        numColumns={2}
        contentContainerStyle={[
          styles.listContent,
          (!groups || groups.length === 0) && styles.emptyListContent,
        ]}
        columnWrapperStyle={groups && groups.length > 1 ? styles.columnWrapper : undefined}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
        // Performance optimizations
        removeClippedSubviews={true}
        maxToRenderPerBatch={8}
        windowSize={8}
        initialNumToRender={6}
      />

      {/* FABs - Scan QR and Create Group */}
      {groups && groups.length > 0 && (
        <View style={styles.fabContainer}>
          {/* Scan QR FAB */}
          <TouchableOpacity
            style={[styles.fabSecondary, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]}
            onPress={() => {
              if (!guardAction()) return;
              setShowScannerModal(true);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="qr-code-outline" size={24} color={colors.text} />
          </TouchableOpacity>

          {/* Create Group FAB */}
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: colors.primary }]}
            onPress={() => {
              if (!guardAction() || !playerId) return;
              SheetManager.show('create-group', { payload: { playerId } });
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="add-outline" size={28} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* QR Scanner Modal */}
      {playerId && (
        <QRScannerModal
          visible={showScannerModal}
          onClose={() => setShowScannerModal(false)}
          playerId={playerId}
          onGroupJoined={handleGroupJoined}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    padding: CARD_PADDING,
  },
  headerSkeleton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerSkeletonButtons: {
    flexDirection: 'row',
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
    paddingBottom: 100, // Extra padding for FAB
  },
  emptyListContent: {
    flex: 1,
    justifyContent: 'center',
  },
  columnWrapper: {
    marginBottom: CARD_GAP,
  },
  groupCard: {
    width: CARD_WIDTH,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  imageContainer: {
    width: '100%',
    height: CARD_WIDTH * 0.75,
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
    backgroundColor: '#34C759',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: '#FFFFFF',
  },
  sportIconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },
  sportIconPlus: {
    color: '#666666',
    fontSize: 8,
    marginHorizontal: 1,
  },
  groupInfo: {
    padding: 12,
    gap: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  titleText: {
    flex: 1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  verifiedBadge: {
    marginRight: 8,
  },
  memberCount: {
    flexDirection: 'row',
    alignItems: 'center',
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
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  emptyButtons: {
    flexDirection: 'column',
    gap: 12,
    marginTop: 8,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 24,
    gap: 8,
    borderWidth: 1.5,
  },
  scanButtonText: {
    fontSize: 16,
  },
});
