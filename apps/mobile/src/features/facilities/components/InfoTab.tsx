/**
 * InfoTab Component
 * Displays facility basic info, address, contacts, and courts list.
 * Uses a flat, badge-driven layout matching the app's modern design language.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  LayoutAnimation,
  Linking,
  Platform,
  UIManager,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Text, Skeleton, useToast } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  accent,
  neutral,
  status,
  primary,
  base,
} from '@rallia/design-system';
import type { Court, Facility, FacilityOfficialInfo } from '@rallia/shared-types';
import { getFacilityOfficialInfo } from '@rallia/shared-types';
import type { FacilityWithDetails } from '@rallia/shared-services';
import { lightHaptic } from '@rallia/shared-utils';
import { useCommunitiesForFacility } from '@rallia/shared-hooks';

import { useTranslation, type TranslationKey, type TranslationOptions } from '#/hooks';
import { useSport } from '#/context';
import { SportIcon } from '#/components/SportIcon';
import { navigationRef } from '#/navigation/navigationRef';
import { CommunityCard } from '#/features/communities/components/CommunityCard';

import CourtCard from './CourtCard';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// =============================================================================
// TYPES
// =============================================================================

interface InfoTabProps {
  facility: FacilityWithDetails;
  courts: Court[];
  onOpenInMaps: () => void;
  onReportInaccuracy?: () => void;
  colors: {
    card: string;
    cardForeground: string;
    text: string;
    textMuted: string;
    primary: string;
    border: string;
    background: string;
  };
  isDark: boolean;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  isLoading?: boolean;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function formatFacilityType(type: Facility['facility_type'], t: InfoTabProps['t']): string | null {
  if (!type) return null;
  const key = `facilityDetail.facilityTypes.${type}` as Parameters<typeof t>[0];
  return t(key);
}

const ACCESS_ROWS = [
  { key: 'booking', icon: 'calendar-outline' },
  { key: 'fees', icon: 'pricetag-outline' },
  { key: 'season', icon: 'time-outline' },
  { key: 'cancellation', icon: 'close-circle-outline' },
  { key: 'notes', icon: 'information-circle-outline' },
] as const satisfies readonly {
  key: keyof FacilityOfficialInfo;
  icon: keyof typeof Ionicons.glyphMap;
}[];

function buildFullAddress(facility: FacilityWithDetails): string | null {
  const parts: string[] = [];
  const data = facility.facilityData;
  const address = facility.address || data?.address;

  if (address) parts.push(address);
  if (data?.city) parts.push(data.city);
  if (data?.postal_code) parts.push(data.postal_code);

  return parts.length > 0 ? parts.join(', ') : null;
}

// =============================================================================
// SKELETON LOADER
// =============================================================================

function InfoTabSkeleton({ colors, isDark }: { colors: InfoTabProps['colors']; isDark: boolean }) {
  const bgColor = isDark ? neutral[800] : '#E1E9EE';
  const highlightColor = isDark ? neutral[700] : '#F2F8FC';

  return (
    <View style={styles.container}>
      {/* About section skeleton */}
      <View style={styles.section}>
        <Skeleton
          width={60}
          height={20}
          backgroundColor={bgColor}
          highlightColor={highlightColor}
          style={{ borderRadius: radiusPixels.md }}
        />
        <View style={styles.badgesRow}>
          <Skeleton
            width={100}
            height={28}
            backgroundColor={bgColor}
            highlightColor={highlightColor}
            style={{ borderRadius: radiusPixels.full }}
          />
          <Skeleton
            width={120}
            height={28}
            backgroundColor={bgColor}
            highlightColor={highlightColor}
            style={{ borderRadius: radiusPixels.full }}
          />
        </View>
        <View style={{ gap: spacingPixels[1] }}>
          <Skeleton
            width="100%"
            height={14}
            backgroundColor={bgColor}
            highlightColor={highlightColor}
          />
          <Skeleton
            width="80%"
            height={14}
            backgroundColor={bgColor}
            highlightColor={highlightColor}
          />
        </View>
      </View>

      {/* Location section skeleton */}
      <View style={styles.section}>
        <Skeleton
          width={80}
          height={20}
          backgroundColor={bgColor}
          highlightColor={highlightColor}
          style={{ borderRadius: radiusPixels.md }}
        />
        <Skeleton
          width="100%"
          height={200}
          borderRadius={radiusPixels.xl}
          backgroundColor={bgColor}
          highlightColor={highlightColor}
        />
      </View>

      {/* Courts section skeleton */}
      <View style={styles.section}>
        <Skeleton
          width={80}
          height={20}
          backgroundColor={bgColor}
          highlightColor={highlightColor}
          style={{ borderRadius: radiusPixels.md }}
        />
        <View style={{ gap: spacingPixels[3] }}>
          {[1, 2, 3].map(i => (
            <Skeleton
              key={i}
              width="100%"
              height={56}
              borderRadius={radiusPixels.xl}
              backgroundColor={bgColor}
              highlightColor={highlightColor}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function InfoTab({
  facility,
  courts,
  onOpenInMaps,
  onReportInaccuracy,
  colors,
  isDark,
  t,
  isLoading = false,
}: InfoTabProps) {
  const toast = useToast();
  const { selectedSport } = useSport();
  const { locale } = useTranslation();
  const [showAllCourts, setShowAllCourts] = useState(false);
  const [showAllCommunities, setShowAllCommunities] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);

  const { communities } = useCommunitiesForFacility(facility.id, selectedSport?.id ?? null);

  const facilityData = facility.facilityData;
  const fullAddress = buildFullAddress(facility);
  const facilityType = formatFacilityType(facilityData?.facility_type, t);
  const membershipRequired = facilityData?.membership_required;
  const description = facilityData?.description;

  const officialInfo = getFacilityOfficialInfo(facilityData?.attributes);
  const officialPage = officialInfo?.[locale === 'fr-CA' ? 'page_fr' : 'page_en'] ?? null;
  const accessRows = useMemo(
    () =>
      officialInfo
        ? ACCESS_ROWS.map(row => ({ ...row, value: officialInfo[row.key] })).filter(
            (row): row is (typeof ACCESS_ROWS)[number] & { value: string } => !!row.value
          )
        : [],
    [officialInfo]
  );

  const facilityLatitude = facilityData?.latitude;
  const facilityLongitude = facilityData?.longitude;
  const hasCoordinates = facilityLatitude != null && facilityLongitude != null;

  const COURTS_PREVIEW_LIMIT = 4;
  const displayedCourts = showAllCourts ? courts : courts.slice(0, COURTS_PREVIEW_LIMIT);
  const hasMoreCourts = courts.length > COURTS_PREVIEW_LIMIT;

  const COMMUNITIES_PREVIEW_LIMIT = 3;
  const displayedCommunities = showAllCommunities
    ? communities
    : communities.slice(0, COMMUNITIES_PREVIEW_LIMIT);
  const hasMoreCommunities = communities.length > COMMUNITIES_PREVIEW_LIMIT;

  // ==========================================================================
  // HANDLERS
  // ==========================================================================

  const handleCopyAddress = useCallback(async () => {
    if (!fullAddress) return;
    lightHaptic();
    try {
      await Clipboard.setStringAsync(fullAddress);
      setAddressCopied(true);
      toast.success(t('facilityDetail.copied'));
      setTimeout(() => setAddressCopied(false), 2000);
    } catch {
      // Silently fail
    }
  }, [fullAddress, t, toast]);

  const handleOpenOfficialPage = useCallback(() => {
    if (!officialPage) return;
    lightHaptic();
    void Linking.openURL(officialPage);
  }, [officialPage]);

  const handleToggleShowAllCourts = useCallback(() => {
    lightHaptic();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowAllCourts(!showAllCourts);
  }, [showAllCourts]);

  const handleToggleShowAllCommunities = useCallback(() => {
    lightHaptic();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowAllCommunities(!showAllCommunities);
  }, [showAllCommunities]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  if (isLoading) {
    return <InfoTabSkeleton colors={colors} isDark={isDark} />;
  }

  return (
    <View style={styles.container}>
      {/* First come first serve banner */}
      {facilityData?.is_first_come_first_serve && (
        <View
          style={[
            styles.fcfsBanner,
            {
              backgroundColor: (isDark ? accent[400] : accent[500]) + '15',
              borderColor: isDark ? accent[400] : accent[500],
            },
          ]}
        >
          <Ionicons name="walk-outline" size={18} color={isDark ? accent[400] : accent[500]} />
          <Text
            size="sm"
            weight="medium"
            color={isDark ? accent[400] : accent[500]}
            style={styles.fcfsBannerText}
          >
            {t('facilityDetail.firstComeFirstServe')}
          </Text>
        </View>
      )}

      {/* About Section */}
      {(description || facilityType || membershipRequired !== undefined) && (
        <View style={styles.section}>
          <Text size="lg" weight="bold" color={colors.text}>
            {t('facilityDetail.about')}
          </Text>

          {/* Pill badges */}
          {(facilityType || membershipRequired !== undefined) && (
            <View style={styles.badgesRow}>
              {facilityType && (
                <View style={[styles.badge, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name="business-outline" size={12} color={colors.primary} />
                  <Text size="xs" weight="medium" color={colors.primary}>
                    {facilityType}
                  </Text>
                </View>
              )}
              {membershipRequired !== undefined && (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: membershipRequired
                        ? `${status.warning.DEFAULT}18`
                        : status.success.DEFAULT + '15',
                    },
                  ]}
                >
                  <Ionicons
                    name={membershipRequired ? 'lock-closed' : 'lock-open'}
                    size={12}
                    color={membershipRequired ? status.warning.dark : status.success.DEFAULT}
                  />
                  <Text
                    size="xs"
                    weight="medium"
                    color={membershipRequired ? status.warning.dark : status.success.DEFAULT}
                  >
                    {membershipRequired
                      ? t('facilityDetail.membersOnly')
                      : t('facilityDetail.publicAccess')}
                  </Text>
                </View>
              )}
            </View>
          )}

          {description && (
            <Text size="sm" color={colors.text} style={styles.descriptionText} numberOfLines={5}>
              {description}
            </Text>
          )}
        </View>
      )}

      {/* Access & booking (operator-published rules) */}
      {accessRows.length > 0 && (
        <View style={styles.section}>
          <Text size="lg" weight="bold" color={colors.text}>
            {t('facilityDetail.accessBooking.title')}
          </Text>

          <View
            style={[
              styles.accessCard,
              { backgroundColor: isDark ? neutral[800] : neutral[50], borderColor: colors.border },
            ]}
          >
            {accessRows.map((row, index) => (
              <View
                key={row.key}
                style={[
                  styles.accessRow,
                  index > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  name={row.icon}
                  size={16}
                  color={colors.primary}
                  style={styles.accessIcon}
                />
                <View style={styles.accessTextGroup}>
                  <Text size="xs" weight="semibold" color={colors.textMuted}>
                    {t(`facilityDetail.accessBooking.${row.key}`)}
                  </Text>
                  <Text size="sm" color={colors.text} style={styles.accessValue}>
                    {row.value}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {officialPage && (
            <TouchableOpacity
              onPress={handleOpenOfficialPage}
              style={[styles.showAllButton, { backgroundColor: colors.primary + '15' }]}
              activeOpacity={0.7}
            >
              <Text size="sm" weight="medium" color={colors.primary}>
                {t('facilityDetail.accessBooking.officialPage')}
              </Text>
              <Ionicons name="open-outline" size={16} color={colors.primary} />
            </TouchableOpacity>
          )}

          {officialInfo?.checked_at && (
            <Text size="xs" color={colors.textMuted}>
              {t('facilityDetail.accessBooking.sourceNote', { date: officialInfo.checked_at })}
            </Text>
          )}
        </View>
      )}

      {/* Location Section */}
      <View style={styles.section}>
        <Text size="lg" weight="bold" color={colors.text}>
          {t('facilityDetail.locationContact')}
        </Text>

        <TouchableOpacity
          style={[
            styles.locationCard,
            { backgroundColor: isDark ? neutral[800] : neutral[50], borderColor: colors.border },
          ]}
          onPress={onOpenInMaps}
          activeOpacity={0.7}
        >
          <View style={styles.locationRow}>
            <View style={{ flex: 1 }}>
              {fullAddress && (
                <Text size="sm" color={colors.text}>
                  {fullAddress}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={handleCopyAddress}
              style={[styles.copyButton, { backgroundColor: colors.primary + '15' }]}
              activeOpacity={0.7}
            >
              <Ionicons
                name={addressCopied ? 'checkmark' : 'copy-outline'}
                size={14}
                color={addressCopied ? status.success.DEFAULT : colors.primary}
              />
            </TouchableOpacity>
            <View style={styles.locationChevron}>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </View>
          </View>

          {/* Map preview */}
          {hasCoordinates && (
            <View style={[styles.mapContainer, { borderColor: colors.border }]}>
              {Platform.OS === 'android' ? (
                <WebView
                  style={styles.mapView}
                  originWhitelist={['*']}
                  scrollEnabled={false}
                  nestedScrollEnabled={false}
                  overScrollMode="never"
                  source={{
                    html: `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%}</style>
</head><body>
<div id="map"></div>
<script>
var map=L.map('map',{zoomControl:false,attributionControl:false,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false}).setView([${facilityLatitude},${facilityLongitude}],16);
L.tileLayer('https://{s}.${isDark ? 'basemaps.cartocdn.com/dark_all' : 'tile.openstreetmap.org'}/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
var markerColor='${isDark ? primary[400] : primary[500]}';
var icon=L.divIcon({className:'',iconSize:[36,44],iconAnchor:[18,44],html:'<div style="display:flex;flex-direction:column;align-items:center"><div style="width:36px;height:36px;border-radius:50%;background:'+markerColor+';border:2px solid rgba(255,255,255,0.5);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px '+markerColor+'66"><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></div><div style="width:6px;height:6px;border-radius:50%;background:'+markerColor+';margin-top:2px;box-shadow:0 1px 3px '+markerColor+'99"></div></div>'});
L.marker([${facilityLatitude},${facilityLongitude}],{icon:icon,interactive:false}).addTo(map);
</script></body></html>`,
                  }}
                />
              ) : (
                <MapView
                  style={styles.mapView}
                  initialRegion={{
                    latitude: facilityLatitude,
                    longitude: facilityLongitude,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                  }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  rotateEnabled={false}
                  pitchEnabled={false}
                  toolbarEnabled={false}
                  moveOnMarkerPress={false}
                  pointerEvents="none"
                  userInterfaceStyle={isDark ? 'dark' : 'light'}
                >
                  <Marker
                    coordinate={{
                      latitude: facilityLatitude,
                      longitude: facilityLongitude,
                    }}
                  >
                    <View
                      style={[
                        styles.glassMarkerContainer,
                        { shadowColor: isDark ? primary[400] : primary[600] },
                      ]}
                    >
                      <View
                        style={[
                          styles.glassMarkerGlow,
                          { backgroundColor: isDark ? `${primary[400]}30` : `${primary[500]}20` },
                        ]}
                      >
                        <View
                          style={[
                            styles.glassMarkerBody,
                            {
                              backgroundColor: isDark ? `${primary[400]}B3` : `${primary[500]}CC`,
                              borderColor: isDark ? `${base.white}30` : `${base.white}60`,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.glassMarkerHighlight,
                              { backgroundColor: isDark ? `${base.white}15` : `${base.white}30` },
                            ]}
                          />
                          <SportIcon
                            sportName={selectedSport?.name ?? 'tennis'}
                            size={16}
                            color={base.white}
                          />
                        </View>
                      </View>
                      <View
                        style={[
                          styles.glassMarkerDot,
                          {
                            backgroundColor: isDark ? primary[300] : primary[500],
                            shadowColor: isDark ? primary[300] : primary[500],
                          },
                        ]}
                      />
                    </View>
                  </Marker>
                </MapView>
              )}
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Courts Section */}
      <View style={styles.section}>
        <Text size="lg" weight="bold" color={colors.text}>
          {t('facilityDetail.courts')} ({courts.length})
        </Text>
        {courts.length === 0 ? (
          <View style={styles.emptyState}>
            <SportIcon
              sportName={selectedSport?.name ?? 'tennis'}
              size={32}
              color={colors.textMuted}
            />
            <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
              {t('facilityDetail.noCourts')}
            </Text>
          </View>
        ) : (
          <View style={styles.courtsList}>
            {displayedCourts.map(court => (
              <CourtCard key={court.id} court={court} colors={colors} isDark={isDark} t={t} />
            ))}

            {hasMoreCourts && (
              <TouchableOpacity
                onPress={handleToggleShowAllCourts}
                style={[styles.showAllButton, { backgroundColor: colors.primary + '15' }]}
                activeOpacity={0.7}
              >
                <Text size="sm" weight="medium" color={colors.primary}>
                  {showAllCourts
                    ? t('facilityDetail.hideCourts')
                    : t('facilityDetail.showAllCourts', { count: courts.length })}
                </Text>
                <Ionicons
                  name={showAllCourts ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.primary}
                />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Communities Section */}
      {communities.length > 0 && (
        <View style={styles.section}>
          <Text size="lg" weight="bold" color={colors.text}>
            {t('facilityDetail.communities.title')} ({communities.length})
          </Text>
          <View style={styles.courtsList}>
            {displayedCommunities.map(community => (
              <CommunityCard
                key={community.id}
                community={community}
                onPress={() =>
                  navigationRef.navigate('CommunityDetail', { communityId: community.id })
                }
                colors={colors}
                isDark={isDark}
                t={t}
              />
            ))}

            {hasMoreCommunities && (
              <TouchableOpacity
                onPress={handleToggleShowAllCommunities}
                style={[styles.showAllButton, { backgroundColor: colors.primary + '15' }]}
                activeOpacity={0.7}
              >
                <Text size="sm" weight="medium" color={colors.primary}>
                  {showAllCommunities
                    ? t('facilityDetail.communities.hideCommunities')
                    : t('facilityDetail.communities.showAll', {
                        count: communities.length,
                      })}
                </Text>
                <Ionicons
                  name={showAllCommunities ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.primary}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Report inaccuracy link */}
      {onReportInaccuracy && (
        <TouchableOpacity
          onPress={onReportInaccuracy}
          style={styles.reportLink}
          activeOpacity={0.7}
        >
          <Ionicons name="flag-outline" size={14} color={colors.textMuted} />
          <Text size="xs" color={colors.textMuted} style={{ marginLeft: spacingPixels[1] }}>
            {t('facilityDetail.reportInaccuracy')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    gap: spacingPixels[5],
    paddingBottom: spacingPixels[4],
  },
  fcfsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacingPixels[4],
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.md,
    borderWidth: 1,
  },
  fcfsBannerText: {
    marginLeft: spacingPixels[2],
    flex: 1,
  },

  // Section
  section: {
    gap: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[4],
  },

  // Badges
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2.5],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
  },

  // About Section
  descriptionText: {
    lineHeight: 22,
  },

  // Access & booking Section
  accessCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    paddingHorizontal: spacingPixels[3],
  },
  accessRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacingPixels[3],
  },
  accessIcon: {
    marginTop: 2,
    marginRight: spacingPixels[2.5],
  },
  accessTextGroup: {
    flex: 1,
    gap: spacingPixels[0.5],
  },
  accessValue: {
    lineHeight: 20,
  },

  // Location Section
  locationCard: {
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    padding: spacingPixels[3],
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationChevron: {
    marginLeft: spacingPixels[2],
    flexShrink: 0,
  },
  copyButton: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.md,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    marginLeft: spacingPixels[2],
  },
  mapContainer: {
    marginTop: spacingPixels[3],
    borderRadius: radiusPixels.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  mapView: {
    width: '100%',
    height: 150,
  },
  glassMarkerContainer: {
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  glassMarkerGlow: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassMarkerBody: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glassMarkerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  glassMarkerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 3,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 3,
    elevation: 3,
  },
  // Courts Section
  courtsList: {
    gap: spacingPixels[3],
  },
  emptyState: {
    paddingVertical: spacingPixels[6],
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  emptyStateText: {
    textAlign: 'center',
  },
  showAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[1],
    paddingVertical: spacingPixels[2.5],
    borderRadius: radiusPixels.lg,
    marginTop: spacingPixels[2],
  },
  reportLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
  },
});
