/**
 * InfoTab Component
 * Displays facility basic info, address, contacts, and courts list.
 * Uses a card-based layout matching UserProfile section styling.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Text, Skeleton, useToast } from '@rallia/shared-components';
import {
  spacingPixels,
  radiusPixels,
  fontSizePixels,
  fontWeightNumeric,
  shadowsNative,
  primary,
  accent,
  neutral,
  status,
} from '@rallia/design-system';
import type { Court, Facility } from '@rallia/shared-types';
import type { FacilityWithDetails } from '@rallia/shared-services';
import { lightHaptic } from '@rallia/shared-utils';
import type { TranslationKey, TranslationOptions } from '../../../hooks';
import { useSport } from '../../../context';
import { SportIcon } from '../../../components/SportIcon';

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

/**
 * Format distance in meters to human-readable string
 */
function formatDistance(meters: number | null | undefined): string | null {
  if (meters == null) return null;
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Format facility type to display label
 */
function formatFacilityType(type: Facility['facility_type'], t: InfoTabProps['t']): string | null {
  if (!type) return null;
  const key = `facilityDetail.facilityTypes.${type}` as Parameters<typeof t>[0];
  return t(key);
}

/**
 * Build full address string
 */
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
// SUB-COMPONENTS
// =============================================================================

function SectionTitle({ title }: { title: string }) {
  return (
    <Text style={styles.sectionTitle} color="textMuted">
      {title}
    </Text>
  );
}

function CompactRow({
  label,
  value,
  colors,
  showDivider = true,
  right,
}: {
  label: string;
  value?: string | null;
  colors: InfoTabProps['colors'];
  showDivider?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <>
      <View style={styles.compactRow}>
        <Text style={styles.label} color={colors.textMuted}>
          {label}
        </Text>
        {right || (
          <Text style={styles.value} color={colors.text}>
            {value ?? '—'}
          </Text>
        )}
      </View>
      {showDivider && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
    </>
  );
}

// =============================================================================
// SKELETON LOADER
// =============================================================================

function InfoTabSkeleton({ colors, isDark }: { colors: InfoTabProps['colors']; isDark: boolean }) {
  const bgColor = isDark ? neutral[800] : '#E1E9EE';
  const highlightColor = isDark ? neutral[700] : '#F2F8FC';
  const skeletonCardStyle = [styles.card, { backgroundColor: colors.card }, shadowsNative.sm];

  const cardBg = isDark ? neutral[800] : '#E1E9EE';

  return (
    <View style={styles.container}>
      {/* About section skeleton */}
      <View style={styles.section}>
        <Skeleton
          width={80}
          height={12}
          backgroundColor={bgColor}
          highlightColor={highlightColor}
          style={{ borderRadius: radiusPixels.sm, marginLeft: spacingPixels[4] }}
        />
        <View style={skeletonCardStyle}>
          <View style={{ gap: spacingPixels[2.5] }}>
            <View style={styles.compactRow}>
              <Skeleton
                width={80}
                height={14}
                backgroundColor={bgColor}
                highlightColor={highlightColor}
              />
              <Skeleton
                width={100}
                height={14}
                backgroundColor={bgColor}
                highlightColor={highlightColor}
              />
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.compactRow}>
              <Skeleton
                width={100}
                height={14}
                backgroundColor={bgColor}
                highlightColor={highlightColor}
              />
              <Skeleton
                width={80}
                height={14}
                backgroundColor={bgColor}
                highlightColor={highlightColor}
              />
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
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
        </View>
      </View>

      {/* Location section skeleton */}
      <View style={styles.section}>
        <Skeleton
          width={140}
          height={12}
          backgroundColor={bgColor}
          highlightColor={highlightColor}
          style={{ borderRadius: radiusPixels.sm, marginLeft: spacingPixels[4] }}
        />
        <View style={skeletonCardStyle}>
          <View style={{ gap: spacingPixels[2.5] }}>
            <View style={styles.compactRow}>
              <Skeleton
                width={60}
                height={14}
                backgroundColor={bgColor}
                highlightColor={highlightColor}
                style={{ borderRadius: radiusPixels.md }}
              />
              <Skeleton
                width={160}
                height={14}
                backgroundColor={bgColor}
                highlightColor={highlightColor}
              />
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.compactRow}>
              <Skeleton
                width={60}
                height={14}
                backgroundColor={bgColor}
                highlightColor={highlightColor}
              />
              <Skeleton
                width={60}
                height={14}
                backgroundColor={bgColor}
                highlightColor={highlightColor}
              />
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Skeleton
              width="100%"
              height={44}
              borderRadius={12}
              backgroundColor={bgColor}
              highlightColor={highlightColor}
            />
            <View style={{ flexDirection: 'row', gap: spacingPixels[2] }}>
              {[1, 2, 3].map(i => (
                <Skeleton
                  key={i}
                  width={44}
                  height={44}
                  circle
                  backgroundColor={bgColor}
                  highlightColor={highlightColor}
                />
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* Courts section skeleton */}
      <View style={styles.section}>
        <Skeleton
          width={80}
          height={12}
          backgroundColor={bgColor}
          highlightColor={highlightColor}
          style={{ borderRadius: radiusPixels.sm, marginLeft: spacingPixels[4] }}
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
  colors,
  isDark,
  t,
  isLoading = false,
}: InfoTabProps) {
  const toast = useToast();
  const { selectedSport } = useSport();
  const [showAllCourts, setShowAllCourts] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);

  // Facility data from facilityData (full record)
  const facilityData = facility.facilityData;

  // Build full address
  const fullAddress = buildFullAddress(facility);

  // Format distance
  const distanceDisplay = formatDistance(facility.distance_meters);

  // Facility type and membership
  const facilityType = formatFacilityType(facilityData?.facility_type, t);
  const membershipRequired = facilityData?.membership_required;

  // Description
  const description = facilityData?.description;

  // Courts to display (limited or all)
  const COURTS_PREVIEW_LIMIT = 4;
  const displayedCourts = showAllCourts ? courts : courts.slice(0, COURTS_PREVIEW_LIMIT);
  const hasMoreCourts = courts.length > COURTS_PREVIEW_LIMIT;

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

  const handleToggleShowAllCourts = useCallback(() => {
    lightHaptic();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowAllCourts(!showAllCourts);
  }, [showAllCourts]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  if (isLoading) {
    return <InfoTabSkeleton colors={colors} isDark={isDark} />;
  }

  return (
    <View style={styles.container}>
      {/* About Section */}
      {(description || facilityType || membershipRequired !== undefined) && (
        <View style={styles.section}>
          <SectionTitle title={t('facilityDetail.about').toUpperCase()} />
          <View style={[styles.card, { backgroundColor: colors.card }, shadowsNative.sm]}>
            {facilityType && (
              <CompactRow
                label={t('facilityDetail.facilityType')}
                value={facilityType}
                colors={colors}
                showDivider={membershipRequired !== undefined || !!description}
              />
            )}
            {membershipRequired !== undefined && (
              <CompactRow
                label={t('facilityDetail.access')}
                colors={colors}
                showDivider={!!description}
                right={
                  <View style={styles.accessBadge}>
                    <Ionicons
                      name={membershipRequired ? 'lock-closed' : 'lock-open'}
                      size={12}
                      color={membershipRequired ? accent[600] : status.success.DEFAULT}
                    />
                    <Text
                      size="xs"
                      weight="medium"
                      color={membershipRequired ? accent[600] : status.success.DEFAULT}
                    >
                      {membershipRequired
                        ? t('facilityDetail.membersOnly')
                        : t('facilityDetail.publicAccess')}
                    </Text>
                  </View>
                }
              />
            )}
            {description && (
              <Text size="sm" color={colors.text} style={styles.descriptionText} numberOfLines={5}>
                {description}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Location & Contact Section */}
      <View style={styles.section}>
        <SectionTitle title={t('facilityDetail.locationContact').toUpperCase()} />
        <View style={[styles.card, { backgroundColor: colors.card }, shadowsNative.sm]}>
          {/* Address with copy */}
          {fullAddress && (
            <CompactRow
              label={t('facilityDetail.addressLabel')}
              colors={colors}
              showDivider={!!distanceDisplay}
              right={
                <View style={styles.addressRight}>
                  <Text style={styles.value} color={colors.text} numberOfLines={2}>
                    {fullAddress}
                  </Text>
                  <TouchableOpacity
                    onPress={handleCopyAddress}
                    style={[
                      styles.copyButton,
                      { backgroundColor: isDark ? neutral[800] : primary[50] },
                    ]}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={addressCopied ? 'checkmark' : 'copy-outline'}
                      size={14}
                      color={addressCopied ? status.success.DEFAULT : colors.primary}
                    />
                  </TouchableOpacity>
                </View>
              }
            />
          )}

          {/* Distance */}
          {distanceDisplay && (
            <CompactRow
              label={t('facilityDetail.distance')}
              value={t('facilityDetail.distanceAway', { distance: distanceDisplay })}
              colors={colors}
            />
          )}

          {/* Open in Maps button */}
          <TouchableOpacity
            onPress={onOpenInMaps}
            style={[styles.mapsButton, { backgroundColor: isDark ? neutral[700] : primary[50] }]}
            activeOpacity={0.7}
          >
            <Ionicons name="navigate-outline" size={16} color={colors.primary} />
            <Text size="sm" weight="semibold" color={colors.primary}>
              {t('facilityDetail.openInMaps')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Courts Section */}
      <View style={styles.section}>
        <SectionTitle title={`${t('facilityDetail.courts').toUpperCase()} (${courts.length})`} />
        {courts.length === 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card }, shadowsNative.sm]}>
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
          </View>
        ) : (
          <View style={styles.courtsList}>
            {displayedCourts.map(court => (
              <CourtCard key={court.id} court={court} colors={colors} isDark={isDark} t={t} />
            ))}

            {/* Show all / Hide toggle */}
            {hasMoreCourts && (
              <TouchableOpacity
                onPress={handleToggleShowAllCourts}
                style={[
                  styles.showAllButton,
                  { backgroundColor: isDark ? neutral[800] : primary[50] },
                ]}
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

  // Section
  section: {
    gap: spacingPixels[2],
    paddingHorizontal: spacingPixels[4],
  },
  sectionTitle: {
    fontSize: fontSizePixels.xs,
    fontWeight: fontWeightNumeric.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // Card
  card: {
    borderRadius: radiusPixels.xl,
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[1.5],
    ...shadowsNative.sm,
  },

  // Compact rows
  compactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacingPixels[2.5],
  },
  label: {
    fontSize: fontSizePixels.sm,
    flexShrink: 0,
    marginRight: spacingPixels[3],
  },
  value: {
    fontSize: fontSizePixels.sm,
    fontWeight: fontWeightNumeric.medium,
    flex: 1,
    textAlign: 'right',
    minWidth: 0,
  },
  divider: {
    height: 1,
  },

  // About Section
  accessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
  },
  descriptionText: {
    lineHeight: 22,
    paddingTop: spacingPixels[2],
  },

  // Location Section
  addressRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacingPixels[2],
  },
  copyButton: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.md,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  mapsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[2],
    paddingVertical: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    marginTop: spacingPixels[2],
    marginBottom: spacingPixels[2.5],
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
});
