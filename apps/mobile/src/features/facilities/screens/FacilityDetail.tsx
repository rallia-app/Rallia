/**
 * FacilityDetail Screen
 * Displays detailed facility information with three tabs:
 * - Info: Basic info, address, contacts, courts list
 * - Availability: Court availability and booking
 * - Matches: Public matches at this facility
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Linking,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, Skeleton, useToast } from '@rallia/shared-components';
import {
  useFacilityDetail,
  useFavoriteFacilities,
  usePlayer,
  useCourtAvailability,
  useProfile,
} from '@rallia/shared-hooks';
import {
  useThemeStyles,
  useTranslation,
  useEffectiveLocation,
  useRequireOnboarding,
  useAuth,
} from '../../../hooks';
import { getSafeAreaEdges } from '../../../utils';
import { useSport } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';
import { useCourtsRoute } from '../../../navigation/hooks';
import {
  spacingPixels,
  radiusPixels,
  shadowsNative,
  primary,
  neutral,
} from '@rallia/design-system';
import { lightHaptic } from '@rallia/shared-utils';

// Tab components
import InfoTab from '../components/InfoTab';
import AvailabilityTab from '../components/AvailabilityTab';
import MatchesTab from '../components/MatchesTab';

// =============================================================================
// TYPES
// =============================================================================

type TabKey = 'info' | 'availability' | 'matches';
const TAB_KEYS: TabKey[] = ['info', 'availability', 'matches'];

const TAB_ICONS: Record<TabKey, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle-outline',
  availability: 'calendar-outline',
  matches: 'tennisball-outline',
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function FacilityDetail() {
  const route = useCourtsRoute<'FacilityDetail'>();
  const { facilityId } = route.params;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const { location } = useEffectiveLocation();
  const { selectedSport } = useSport();
  const { player } = usePlayer();
  const { isReady: isOnboarded } = useRequireOnboarding();
  const { session } = useAuth();
  const { profile } = useProfile();

  const showFavoriteButton = !!session?.user && !!profile?.onboarding_completed;

  // Active tab state
  const [activeTab, setActiveTab] = useState<TabKey>('info');
  // Image carousel: current slide index for dot indicator
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  const { width: windowWidth } = useWindowDimensions();

  // Fetch facility details
  const { facility, courts, contacts, isLoading, isFetching, refetch } = useFacilityDetail({
    facilityId,
    sportId: selectedSport?.id,
    latitude: location?.latitude,
    longitude: location?.longitude,
  });

  // Fetch availability for the facility
  const {
    slots: formattedSlots,
    isLoading: availabilityLoading,
    refetch: refetchAvailability,
  } = useCourtAvailability({
    facilityId,
    dataProviderId: facility?.data_provider_id ?? null,
    dataProviderType: facility?.data_provider_type ?? null,
    externalProviderId: facility?.external_provider_id ?? null,
    bookingUrlTemplate: facility?.booking_url_template ?? null,
    facilityTimezone: facility?.timezone ?? null,
    sportName: selectedSport?.name,
    enabled: !!facility,
  });

  // Favorites management
  const { isFavorite, addFavorite, removeFavorite, isMaxReached } = useFavoriteFacilities(
    player?.id ?? null
  );

  const facilityIsFavorite = facility ? isFavorite(facility.id) : false;

  // Handle favorite toggle
  const handleToggleFavorite = useCallback(async () => {
    if (!facility || !player?.id) return;

    lightHaptic();

    if (facilityIsFavorite) {
      const success = await removeFavorite(facility.id);
      if (success) {
        toast.success(t('facilitiesTab.favorites.removedFromFavorites'));
      }
    } else {
      if (isMaxReached) {
        toast.info(t('facilitiesTab.favorites.maxReached'));
        return;
      }
      const success = await addFavorite(facility);
      if (success) {
        toast.success(t('facilitiesTab.favorites.addedToFavorites'));
      }
    }
  }, [
    facility,
    player?.id,
    facilityIsFavorite,
    removeFavorite,
    addFavorite,
    isMaxReached,
    t,
    toast,
  ]);

  // Handle refresh (only for info and availability tabs - matches tab handles its own refresh)
  const handleRefresh = useCallback(() => {
    refetch();
    if (activeTab === 'availability') {
      refetchAvailability();
    }
  }, [activeTab, refetch, refetchAvailability]);

  // Handle opening address in maps
  const handleOpenInMaps = useCallback(() => {
    if (!facility?.facilityData) return;

    const address = facility.address || facility.facilityData.address;
    const lat = facility.facilityData.latitude;
    const lng = facility.facilityData.longitude;

    let url: string;
    if (lat && lng) {
      // Open with coordinates
      url = Platform.select({
        ios: `maps:0,0?q=${lat},${lng}`,
        android: `geo:${lat},${lng}?q=${lat},${lng}`,
      }) as string;
    } else if (address) {
      // Open with address
      const encodedAddress = encodeURIComponent(address);
      url = Platform.select({
        ios: `maps:0,0?q=${encodedAddress}`,
        android: `geo:0,0?q=${encodedAddress}`,
      }) as string;
    } else {
      return;
    }

    Linking.canOpenURL(url).then(supported => {
      if (supported) {
        Linking.openURL(url);
      }
    });
  }, [facility]);

  // Contact info
  const primaryContact = contacts.find(c => c.is_primary) || contacts[0];
  const phone = primaryContact?.phone;
  const email = primaryContact?.email;
  const website = primaryContact?.website;
  const hasContactInfo = !!(phone || email || website);

  const handleCall = useCallback(() => {
    if (!phone) return;
    lightHaptic();
    Linking.openURL(`tel:${phone}`);
  }, [phone]);

  const handleEmail = useCallback(() => {
    if (!email) return;
    lightHaptic();
    Linking.openURL(`mailto:${email}`);
  }, [email]);

  const handleWebsite = useCallback(() => {
    if (!website) return;
    lightHaptic();
    Linking.openURL(website);
  }, [website]);
  // Image carousel: values and hooks (must be before any early return to keep hook count stable)
  const headerImageWidth = windowWidth - 2 * spacingPixels[4];
  const headerImages = facility?.images?.filter(img => img.url || img.thumbnail_url) ?? [];
  const hasHeaderImages = headerImages.length > 0;
  const imageCount = headerImages.length;

  const handleImageScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const x = e.nativeEvent.contentOffset.x;
      const index = Math.round(x / headerImageWidth);
      const clamped = Math.max(0, Math.min(index, Math.max(0, imageCount - 1)));
      setCurrentImageIndex(clamped);
    },
    [headerImageWidth, imageCount]
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setCurrentImageIndex(0);
    });
    return () => cancelAnimationFrame(id);
  }, [facilityId, imageCount]);

  // Theme-aware skeleton colors
  const skeletonBg = isDark ? neutral[800] : '#E1E9EE';
  const skeletonHighlight = isDark ? neutral[700] : '#F2F8FC';

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={getSafeAreaEdges(['bottom'])}
      >
        <View style={styles.loadingContainer}>
          {/* Header skeleton */}
          <View style={[styles.headerSkeleton, { backgroundColor: colors.card }]}>
            <View style={styles.headerSkeletonContent}>
              <Skeleton
                width="70%"
                height={24}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
                style={{ borderRadius: radiusPixels.md }}
              />
              <Skeleton
                width="40%"
                height={16}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
                style={{ marginTop: spacingPixels[2], borderRadius: radiusPixels.sm }}
              />
            </View>
            <Skeleton
              width={40}
              height={40}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
              style={{ borderRadius: radiusPixels.full }}
            />
          </View>

          {/* Tab bar skeleton */}
          <View style={styles.tabBarSkeleton}>
            {[1, 2, 3].map(i => (
              <Skeleton
                key={i}
                width={80}
                height={36}
                backgroundColor={skeletonBg}
                highlightColor={skeletonHighlight}
                style={{ borderRadius: radiusPixels.lg }}
              />
            ))}
          </View>

          {/* Content skeleton */}
          <View style={styles.contentSkeleton}>
            <Skeleton
              width="100%"
              height={100}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
              style={{ borderRadius: radiusPixels.xl }}
            />
            <Skeleton
              width="100%"
              height={160}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
              style={{ marginTop: spacingPixels[4], borderRadius: radiusPixels.xl }}
            />
            <Skeleton
              width="100%"
              height={80}
              backgroundColor={skeletonBg}
              highlightColor={skeletonHighlight}
              style={{ marginTop: spacingPixels[4], borderRadius: radiusPixels.xl }}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Not found state
  if (!facility) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={getSafeAreaEdges(['bottom'])}
      >
        <View style={styles.emptyContainer}>
          <View
            style={[
              styles.emptyIconWrapper,
              { backgroundColor: isDark ? neutral[800] : primary[50] },
            ]}
          >
            <Ionicons name="business-outline" size={48} color={colors.primary} />
          </View>
          <Text size="xl" weight="bold" color={colors.text} style={styles.emptyTitle}>
            {t('facilitiesTab.empty.title')}
          </Text>
          <Text size="sm" color={colors.textMuted} style={styles.emptySubtitle}>
            {t('facilitiesTab.empty.description')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Header card (images + name + favorite) – used only in Info tab
  const renderInfoHeader = () => (
    <View
      style={[
        styles.header,
        { backgroundColor: colors.card },
        isDark ? shadowsNative.sm : shadowsNative.DEFAULT,
        hasHeaderImages && styles.headerWithImages,
      ]}
    >
      {hasHeaderImages && (
        <View style={styles.headerImageStripWrapper}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.headerImageStripContent}
            onScroll={handleImageScroll}
            onMomentumScrollEnd={handleImageScroll}
            scrollEventThrottle={16}
            accessibilityLabel={t('facilityDetail.facilityImages')}
          >
            {headerImages.map(img => {
              const uri = img.url || img.thumbnail_url;
              return (
                <View key={img.id} style={[styles.headerImageSlide, { width: headerImageWidth }]}>
                  <Image
                    source={{ uri: uri! }}
                    style={[styles.headerImage, { width: headerImageWidth, height: 170 }]}
                    contentFit="cover"
                  />
                </View>
              );
            })}
          </ScrollView>
          {imageCount > 0 && (
            <View style={[styles.imageCountBadge, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
              <Text size="xs" weight="semibold" color="#FFF">
                {currentImageIndex + 1}/{imageCount}
              </Text>
            </View>
          )}
        </View>
      )}
      <View style={styles.headerRow}>
        <View style={styles.headerContent}>
          <Text size="xl" weight="bold" color={colors.text} numberOfLines={3} style={{ flex: 1 }}>
            {facility.name}
          </Text>
          {isOnboarded && (
            <TouchableOpacity
              onPress={handleToggleFavorite}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[
                styles.favoriteButton,
                {
                  backgroundColor: facilityIsFavorite
                    ? colors.error + '15'
                    : isDark
                      ? neutral[700]
                      : neutral[100],
                },
              ]}
              activeOpacity={0.7}
            >
              <Ionicons
                name={facilityIsFavorite ? 'heart' : 'heart-outline'}
                size={22}
                color={facilityIsFavorite ? colors.error : colors.textMuted}
              />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.headerBottom}>
          <View style={styles.headerMeta}>
            {facility.distance_meters !== null && (
              <View style={[styles.metaBadge, { backgroundColor: primary[500] + '15' }]}>
                <Ionicons name="navigate-outline" size={12} color={colors.primary} />
                <Text size="xs" weight="medium" color={colors.primary}>
                  {facility.distance_meters < 1000
                    ? `${Math.round(facility.distance_meters)} m`
                    : `${(facility.distance_meters / 1000).toFixed(1)} km`}
                </Text>
              </View>
            )}
            {courts.length > 0 && (
              <View
                style={[
                  styles.metaBadge,
                  { backgroundColor: isDark ? neutral[700] : neutral[100] },
                ]}
              >
                <Ionicons name="grid-outline" size={12} color={colors.textMuted} />
                <Text size="xs" weight="medium" color={colors.textMuted}>
                  {courts.length} {courts.length === 1 ? 'court' : 'courts'}
                </Text>
              </View>
            )}
          </View>
          {hasContactInfo && (
            <View style={styles.contactActions}>
              {phone && (
                <TouchableOpacity
                  onPress={handleCall}
                  style={[styles.contactButton, { backgroundColor: primary[500] + '15' }]}
                  activeOpacity={0.7}
                >
                  <Ionicons name="call-outline" size={20} color={primary[600]} />
                </TouchableOpacity>
              )}
              {email && (
                <TouchableOpacity
                  onPress={handleEmail}
                  style={[styles.contactButton, { backgroundColor: primary[500] + '15' }]}
                  activeOpacity={0.7}
                >
                  <Ionicons name="mail-outline" size={20} color={primary[600]} />
                </TouchableOpacity>
              )}
              {website && (
                <TouchableOpacity
                  onPress={handleWebsite}
                  style={[styles.contactButton, { backgroundColor: primary[500] + '15' }]}
                  activeOpacity={0.7}
                >
                  <Ionicons name="globe-outline" size={20} color={primary[600]} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={[]}>
      {/* Tab Bar at top */}
      <View style={[styles.tabBar, { backgroundColor: isDark ? '#1C1C1E' : '#F2F2F7' }]}>
        {TAB_KEYS.map(tab => {
          const isActive = activeTab === tab;
          const tabLabel = t(`facilityDetail.tabs.${tab}` as Parameters<typeof t>[0]);
          const iconName = TAB_ICONS[tab];
          return (
            <TouchableOpacity
              key={tab}
              onPress={() => {
                lightHaptic();
                setActiveTab(tab);
              }}
              style={[
                styles.tab,
                isActive && [styles.activeTab, { backgroundColor: colors.cardBackground }],
              ]}
              activeOpacity={0.7}
            >
              {tab === 'matches' ? (
                <SportIcon
                  sportName={selectedSport?.name ?? 'tennis'}
                  size={18}
                  color={isActive ? colors.primary : colors.textMuted}
                />
              ) : (
                <Ionicons
                  name={iconName}
                  size={18}
                  color={isActive ? colors.primary : colors.textMuted}
                />
              )}
              <Text
                size="sm"
                weight={isActive ? 'semibold' : 'medium'}
                style={{
                  color: isActive ? colors.primary : colors.textMuted,
                  marginLeft: 6,
                }}
              >
                {tabLabel}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Tab content */}
      {activeTab === 'matches' ? (
        <View style={styles.contentWithTopPadding}>
          <MatchesTab facilityId={facilityId} />
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          refreshControl={
            <RefreshControl
              refreshing={isFetching}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {activeTab === 'info' && (
            <>
              {renderInfoHeader()}
              <InfoTab
                facility={facility}
                courts={courts}
                onOpenInMaps={handleOpenInMaps}
                colors={colors}
                isDark={isDark}
                t={t}
                isLoading={isLoading}
              />
            </>
          )}
          {activeTab === 'availability' && (
            <AvailabilityTab
              facility={facility}
              slots={formattedSlots}
              isLoading={availabilityLoading}
              courts={courts}
              colors={colors}
              isDark={isDark}
              t={t}
            />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: spacingPixels[2],
  },
  // Loading state styles
  loadingContainer: {
    flex: 1,
  },
  headerSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    marginHorizontal: spacingPixels[4],
    marginTop: spacingPixels[2],
    borderRadius: radiusPixels.xl,
  },
  headerSkeletonContent: {
    flex: 1,
  },
  tabBarSkeleton: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    marginTop: spacingPixels[2],
  },
  contentSkeleton: {
    padding: spacingPixels[4],
  },
  // Empty state styles
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingPixels[8],
  },
  emptyIconWrapper: {
    width: 96,
    height: 96,
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacingPixels[4],
  },
  emptyTitle: {
    textAlign: 'center',
    marginBottom: spacingPixels[2],
  },
  emptySubtitle: {
    textAlign: 'center',
    maxWidth: 280,
  },
  // Header styles (used as first block in Info tab; no marginTop – spacing comes from contentContainer paddingTop)
  header: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[2],
    marginHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[4],
    borderRadius: radiusPixels.xl,
  },
  headerWithImages: {
    flexDirection: 'column',
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: 'hidden',
  },
  headerImageStripWrapper: {
    height: 170,
    width: '100%',
    borderTopLeftRadius: radiusPixels.xl,
    borderTopRightRadius: radiusPixels.xl,
    overflow: 'hidden',
  },
  headerImageStripContent: {
    flexDirection: 'row',
  },
  headerImageSlide: {
    height: 170,
  },
  headerImage: {
    width: '100%',
    height: '100%',
  },
  imageCountBadge: {
    position: 'absolute',
    bottom: spacingPixels[2],
    right: spacingPixels[2],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
  },
  headerRow: {
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacingPixels[3],
  },
  headerBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacingPixels[3],
  },
  headerMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },
  contactActions: {
    flexDirection: 'row',
    gap: spacingPixels[2],
  },
  contactButton: {
    width: 38,
    height: 38,
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  favoriteButton: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.full,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  // Tab bar styles (pill container – matches Communities)
  tabBar: {
    flexDirection: 'row',
    marginTop: spacingPixels[3],
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
  // Content styles – same top spacing for all tabs (tab bar to first content)
  content: {
    flex: 1,
    marginTop: spacingPixels[2],
  },
  contentContainer: {
    paddingTop: spacingPixels[3],
    paddingBottom: spacingPixels[6],
  },
  // Matches tab wrapper: same top padding as ScrollView contentContainer so spacing matches
  contentWithTopPadding: {
    flex: 1,
    marginTop: spacingPixels[2],
    paddingTop: spacingPixels[3],
  },
});
