/**
 * Where Step
 *
 * Step 2 of the match creation wizard.
 * Handles location type selection and facility/custom location input.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  AppState,
  Linking,
  Animated,
  Keyboard,
  Platform,
} from 'react-native';
import { UseFormReturn, useWatch } from 'react-hook-form';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Text, LocationSelector } from '@rallia/shared-components';
import { SearchBar } from '../../../../components/SearchBar';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import {
  getOrCreateCourt,
  parseCourtNumber,
  getFacilityWithDetails,
} from '@rallia/shared-services';
import {
  useFacilitySearch,
  usePreferredFacility,
  usePlacesAutocomplete,
  useCourtAvailability,
} from '@rallia/shared-hooks';
import type { FormattedSlot, CourtOption } from '@rallia/shared-hooks';
import type {
  MatchFormSchemaData,
  FacilitySearchResult,
  PlacePrediction,
  MatchWithDetails,
} from '@rallia/shared-types';
import { SheetManager } from 'react-native-actions-sheet';
import { ConfirmationModal } from '../../../../components/ConfirmationModal';
import type { TranslationKey, TranslationOptions } from '../../../../hooks/useTranslation';
import { useEffectiveLocation } from '../../../../hooks/useEffectiveLocation';
import { useUserHomeLocation } from '../../../../context';
import { usePlayer } from '@rallia/shared-hooks';

// =============================================================================
// TYPES
// =============================================================================

/** Data extracted from a booked slot for auto-filling date/time/duration */
export interface BookedSlotData {
  matchDate: string;
  startTime: string;
  endTime: string;
  duration: '30' | '60' | '90' | '120' | 'custom';
  customDurationMinutes?: number;
  timezone: string;
}

interface WhereStepProps {
  form: UseFormReturn<MatchFormSchemaData>;
  colors: {
    text: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    buttonActive: string;
    buttonInactive: string;
    buttonTextActive: string;
    cardBackground: string;
  };
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  isDark: boolean;
  sportId: string | undefined;
  /** Sport name for filtering provider availability (e.g., "tennis") */
  sportName?: string;
  /** Device timezone (fallback when facility doesn't have one) */
  deviceTimezone: string;
  /** Callback when user confirms booking a slot - auto-fills date/time/duration */
  onSlotBooked?: (slotData: BookedSlotData) => void;
  /** Optional facility ID to pre-select when step loads */
  preferredFacilityId?: string;
  /** Match data when in edit mode - used to initialize facility/location state */
  editMatch?: MatchWithDetails;
}

interface LocationTypeCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
  colors: WhereStepProps['colors'];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format a date as YYYY-MM-DD in local time
 */
function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a date's time as HH:mm (24-hour format)
 */
function formatTime24(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Calculate duration in minutes between two dates
 */
function calculateDurationMinutes(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
}

/**
 * Map duration minutes to form duration value
 */
function mapDurationToFormValue(minutes: number): '30' | '60' | '90' | '120' | 'custom' {
  const standardDurations = [30, 60, 90, 120] as const;
  for (const d of standardDurations) {
    if (minutes === d) {
      return String(d) as '30' | '60' | '90' | '120';
    }
  }
  return 'custom';
}

/**
 * Format distance in meters to human-readable string
 */
function formatDistance(meters: number | null): string {
  if (meters === null) return '';
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

// =============================================================================
// LOCATION TYPE CARD
// =============================================================================

const LocationTypeCard: React.FC<LocationTypeCardProps> = ({
  icon,
  title,
  description,
  selected,
  onPress,
  colors,
}) => (
  <TouchableOpacity
    style={[
      styles.locationCard,
      {
        backgroundColor: selected ? `${colors.buttonActive}15` : colors.buttonInactive,
        borderColor: selected ? colors.buttonActive : colors.border,
      },
    ]}
    onPress={() => {
      lightHaptic();
      onPress();
    }}
    activeOpacity={0.7}
  >
    <View
      style={[
        styles.locationIconContainer,
        { backgroundColor: selected ? colors.buttonActive : colors.border },
      ]}
    >
      <Ionicons
        name={icon}
        size={24}
        color={selected ? colors.buttonTextActive : colors.textMuted}
      />
    </View>
    <View style={styles.locationTextContainer}>
      <Text
        size="base"
        weight={selected ? 'semibold' : 'regular'}
        color={selected ? colors.buttonActive : colors.text}
      >
        {title}
      </Text>
      <Text size="xs" color={colors.textMuted}>
        {description}
      </Text>
    </View>
    {selected && <Ionicons name="checkmark-circle" size={22} color={colors.buttonActive} />}
  </TouchableOpacity>
);

// =============================================================================
// SKELETON COMPONENTS
// =============================================================================

interface SkeletonProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  colors: WhereStepProps['colors'];
  style?: object;
}

const Skeleton: React.FC<SkeletonProps> = ({ width, height, borderRadius = 4, colors, style }) => {
  // Use useMemo to avoid accessing refs during render
  const pulseAnim = React.useMemo(() => new Animated.Value(0.3), []);

  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: colors.border,
          opacity: pulseAnim,
        },
        style,
      ]}
    />
  );
};

interface SkeletonSlotsProps {
  colors: WhereStepProps['colors'];
}

const SkeletonSlots: React.FC<SkeletonSlotsProps> = ({ colors }) => {
  return (
    <View style={styles.slotsContainer}>
      <Skeleton width={56} height={24} borderRadius={12} colors={colors} />
      <Skeleton width={56} height={24} borderRadius={12} colors={colors} />
      <Skeleton width={56} height={24} borderRadius={12} colors={colors} />
    </View>
  );
};

// =============================================================================
// FACILITY ITEM
// =============================================================================

interface FacilityItemProps {
  facility: FacilitySearchResult;
  onSelect: (facility: FacilitySearchResult) => void;
  onSlotPress?: (facility: FacilitySearchResult, slot: FormattedSlot) => void;
  colors: WhereStepProps['colors'];
  t: (key: TranslationKey, options?: TranslationOptions) => string;
  isDark: boolean;
  /** Whether this is the user's preferred facility */
  isPreferred?: boolean;
  /** Sport name for filtering provider availability (e.g., "tennis") */
  sportName?: string;
}

const FacilityItem: React.FC<FacilityItemProps> = ({
  facility,
  onSelect,
  onSlotPress,
  colors,
  t,
  isDark,
  isPreferred = false,
  sportName,
}) => {
  // Fetch availability using the unified system (local-first, then external provider)
  const { slotsByDate, isLoading } = useCourtAvailability({
    facilityId: facility.id,
    dataProviderId: facility.data_provider_id,
    dataProviderType: facility.data_provider_type,
    externalProviderId: facility.external_provider_id,
    bookingUrlTemplate: facility.booking_url_template,
    facilityTimezone: facility.timezone,
    sportName,
  });

  // Determine if slot is actionable (has booking URL or is a local slot)
  const isSlotActionable = (slot: FormattedSlot): boolean => {
    return !!slot.bookingUrl || !!slot.isLocalSlot;
  };

  const handleSlotPress = (slot: FormattedSlot) => {
    if (onSlotPress && isSlotActionable(slot)) {
      lightHaptic();
      onSlotPress(facility, slot);
    }
  };

  return (
    <TouchableOpacity
      style={[
        styles.facilityItem,
        { backgroundColor: colors.buttonInactive, borderColor: colors.border },
      ]}
      onPress={() => {
        lightHaptic();
        onSelect(facility);
      }}
      activeOpacity={0.7}
    >
      <View style={styles.facilityItemContent}>
        {/* Header row with name and distance */}
        <View style={styles.facilityHeader}>
          <View style={styles.facilityNameContainer}>
            <View style={styles.facilityNameRow}>
              <Text size="base" weight="medium" color={colors.text} numberOfLines={1}>
                {facility.name}
              </Text>
              {isPreferred && (
                <View
                  style={[styles.preferredBadge, { backgroundColor: `${colors.buttonActive}20` }]}
                >
                  <Ionicons name="star" size={10} color={colors.buttonActive} />
                  <Text size="xs" weight="semibold" color={colors.buttonActive}>
                    {t('matchCreation.fields.preferredFacility')}
                  </Text>
                </View>
              )}
            </View>
            <Text size="sm" color={colors.textMuted} numberOfLines={1}>
              {[facility.address, facility.city].filter(Boolean).join(', ')}
            </Text>
          </View>
          {facility.distance_meters !== null && (
            <View style={styles.distanceBadge}>
              <Text size="xs" color={colors.textSecondary}>
                {formatDistance(facility.distance_meters)}
              </Text>
            </View>
          )}
        </View>

        {/* Skeleton slots while loading */}
        {isLoading && <SkeletonSlots colors={colors} />}

        {/* Date-sectioned slots with horizontal scroll */}
        {slotsByDate.length > 0 && !isLoading && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.slotsScrollContent}
            style={styles.slotsScrollView}
          >
            {slotsByDate.map(dateGroup => (
              <View key={dateGroup.dateKey} style={styles.dateGroup}>
                <Text
                  size="xs"
                  weight="semibold"
                  color={dateGroup.isToday ? colors.buttonActive : colors.textMuted}
                  style={styles.dateLabel}
                >
                  {dateGroup.dateLabel}
                </Text>
                <View style={styles.dateSlotsRow}>
                  {dateGroup.slots.map((slot, index) => {
                    // Slot is tappable if it has a booking URL (external) or is a local slot
                    const isTappable = !!slot.bookingUrl || !!slot.isLocalSlot;
                    return (
                      <TouchableOpacity
                        key={`${slot.facilityScheduleId}-${index}`}
                        style={[
                          styles.slotChip,
                          {
                            backgroundColor: isTappable
                              ? `${colors.buttonActive}15`
                              : colors.buttonInactive,
                            borderColor: isTappable ? colors.buttonActive : colors.border,
                          },
                        ]}
                        onPress={() => isTappable && handleSlotPress(slot)}
                        disabled={!isTappable}
                        activeOpacity={0.7}
                      >
                        <Text
                          size="xs"
                          weight="medium"
                          color={isTappable ? colors.buttonActive : colors.textMuted}
                        >
                          {slot.time}
                        </Text>
                        {/* Show court count badge for external slots, building icon for local */}
                        {slot.isLocalSlot ? (
                          <Ionicons name="business-outline" size={10} color={colors.buttonActive} />
                        ) : (
                          slot.courtCount > 0 && (
                            <View
                              style={[
                                styles.courtCountBadge,
                                {
                                  backgroundColor: isTappable
                                    ? colors.buttonActive
                                    : isDark
                                      ? colors.border
                                      : colors.textMuted,
                                },
                              ]}
                            >
                              <Text
                                size="xs"
                                weight="bold"
                                color={isTappable ? colors.buttonTextActive : colors.buttonInactive}
                                style={styles.courtCountText}
                              >
                                {slot.courtCount}
                              </Text>
                            </View>
                          )
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Empty state when no slots available - only show if we fetched but got no results */}
        {slotsByDate.length === 0 && !isLoading && (
          <View style={styles.emptySlots}>
            <Ionicons name="calendar-clear-outline" size={14} color={colors.textMuted} />
            <Text size="xs" color={colors.textMuted}>
              {t('matchCreation.booking.noSlotsAvailable')}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

// =============================================================================
// SELECTED FACILITY DISPLAY
// =============================================================================

interface SelectedFacilityProps {
  facility: FacilitySearchResult;
  onClear: () => void;
  colors: WhereStepProps['colors'];
  /** Court number from a confirmed booking (only shown if set) */
  bookedCourtNumber?: number | null;
  t: (key: TranslationKey, options?: TranslationOptions) => string;
}

const SelectedFacility: React.FC<SelectedFacilityProps> = ({
  facility,
  onClear,
  colors,
  bookedCourtNumber,
  t,
}) => (
  <View
    style={[
      styles.selectedFacility,
      { backgroundColor: `${colors.buttonActive}15`, borderColor: colors.buttonActive },
    ]}
  >
    <View style={styles.selectedFacilityContent}>
      <Ionicons name="business-outline" size={20} color={colors.buttonActive} />
      <View style={styles.selectedFacilityText}>
        <View style={styles.selectedFacilityHeader}>
          <Text size="base" weight="semibold" color={colors.text}>
            {facility.name}
          </Text>
        </View>
        <Text size="sm" color={colors.textMuted} numberOfLines={1}>
          {[facility.address, facility.city].filter(Boolean).join(', ')}
        </Text>
        {bookedCourtNumber !== null && bookedCourtNumber !== undefined && (
          <View style={[styles.courtNumberBadge, { backgroundColor: `${colors.buttonActive}20` }]}>
            <Text size="xs" weight="semibold" color={colors.buttonActive}>
              {t('matchCreation.fields.courtNumber', {
                number: bookedCourtNumber,
              })}
            </Text>
          </View>
        )}
      </View>
    </View>
    <TouchableOpacity
      onPress={() => {
        lightHaptic();
        onClear();
      }}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons name="close-circle" size={24} color={colors.textMuted} />
    </TouchableOpacity>
  </View>
);

// =============================================================================
// PLACE PREDICTION ITEM
// =============================================================================

interface PlaceItemProps {
  place: PlacePrediction;
  onSelect: (place: PlacePrediction) => void;
  colors: WhereStepProps['colors'];
}

const PlaceItem: React.FC<PlaceItemProps> = ({ place, onSelect, colors }) => (
  <TouchableOpacity
    style={[
      styles.facilityItem,
      { backgroundColor: colors.buttonInactive, borderColor: colors.border },
    ]}
    onPress={() => {
      lightHaptic();
      onSelect(place);
    }}
    activeOpacity={0.7}
  >
    <View style={styles.placeItemIcon}>
      <Ionicons name="location" size={18} color={colors.buttonActive} />
    </View>
    <View style={styles.facilityItemContent}>
      <Text size="base" weight="medium" color={colors.text} numberOfLines={1}>
        {place.name}
      </Text>
      {place.address && (
        <Text size="sm" color={colors.textMuted} numberOfLines={1}>
          {place.address}
        </Text>
      )}
    </View>
  </TouchableOpacity>
);

// =============================================================================
// SELECTED PLACE DISPLAY
// =============================================================================

interface SelectedPlaceProps {
  name: string;
  address?: string;
  onClear: () => void;
  colors: WhereStepProps['colors'];
}

const SelectedPlace: React.FC<SelectedPlaceProps> = ({ name, address, onClear, colors }) => (
  <View
    style={[
      styles.selectedFacility,
      { backgroundColor: `${colors.buttonActive}15`, borderColor: colors.buttonActive },
    ]}
  >
    <View style={styles.selectedFacilityContent}>
      <Ionicons name="location" size={20} color={colors.buttonActive} />
      <View style={styles.selectedFacilityText}>
        <Text size="base" weight="semibold" color={colors.text}>
          {name}
        </Text>
        {address && (
          <Text size="sm" color={colors.textMuted} numberOfLines={2}>
            {address}
          </Text>
        )}
      </View>
    </View>
    <TouchableOpacity
      onPress={() => {
        lightHaptic();
        onClear();
      }}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons name="close-circle" size={24} color={colors.textMuted} />
    </TouchableOpacity>
  </View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const WhereStep: React.FC<WhereStepProps> = ({
  form,
  colors,
  t,
  isDark,
  sportId,
  sportName,
  deviceTimezone,
  onSlotBooked,
  preferredFacilityId,
  editMatch,
}) => {
  const {
    setValue,
    control,
    formState: { errors },
  } = form;

  // Use useWatch for reliable reactivity when form values change from parent components
  const locationType = useWatch({ control, name: 'locationType' });
  const locationName = useWatch({ control, name: 'locationName' });
  const locationAddress = useWatch({ control, name: 'locationAddress' });

  // Local state for search and selected facility
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFacility, setSelectedFacility] = useState<FacilitySearchResult | null>(null);
  const [bookedCourtNumber, setBookedCourtNumber] = useState<number | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const facilitySearchRef = useRef<View>(null);
  const placeSearchRef = useRef<View>(null);

  // Track which field is focused for keyboard handling
  const [focusedField, setFocusedField] = useState<'facility' | 'place' | 'address' | null>(null);

  // Listen for keyboard events and scroll to focused field
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const keyboardShowListener = Keyboard.addListener(showEvent, () => {
      // Scroll to the focused field when keyboard shows
      if (focusedField && scrollViewRef.current) {
        // Use a timeout to ensure the keyboard is fully shown
        setTimeout(() => {
          // Scroll positions based on which field is focused
          const scrollPositions = {
            facility: 200, // Facility search is near top
            place: 200, // Place search is similar position
            address: 400, // Address field is lower in the form
          };
          const scrollY = scrollPositions[focusedField] || 200;
          scrollViewRef.current?.scrollTo({ y: scrollY, animated: true });
        }, 100);
      }
    });

    const keyboardHideListener = Keyboard.addListener(hideEvent, () => {
      setFocusedField(null);
    });

    return () => {
      keyboardShowListener.remove();
      keyboardHideListener.remove();
    };
  }, [focusedField]);

  // Local state for custom location search
  const [placeSearchQuery, setPlaceSearchQuery] = useState('');
  const [hasSelectedPlace, setHasSelectedPlace] = useState(false);

  // Booking confirmation state
  const [pendingBookingSlot, setPendingBookingSlot] = useState<{
    facility: FacilitySearchResult;
    slot: FormattedSlot;
    selectedCourt?: CourtOption;
  } | null>(null);
  // Booking confirmation modal visibility (shown when returning from external booking)
  const [showBookingConfirmation, setShowBookingConfirmation] = useState(false);
  // Court selection state (when multiple courts available at same time)
  const [courtSelectionData, setCourtSelectionData] = useState<{
    facility: FacilitySearchResult;
    slot: FormattedSlot;
  } | null>(null);

  // Get effective user location (respects user's home/current preference)
  const {
    location,
    isLoading: locationLoading,
    locationMode,
    setLocationMode,
    hasHomeLocation,
    hasBothLocationOptions,
  } = useEffectiveLocation();
  const locationError = !location && !locationLoading ? 'no_location' : null;

  // Home location label for LocationSelector display
  const { homeLocation } = useUserHomeLocation();
  const { player } = usePlayer();
  const homeLocationLabel = player?.address
    ? [player.address.split(',')[0].trim(), player.city].filter(Boolean).join(', ')
    : homeLocation?.postalCode || homeLocation?.formattedAddress?.split(',')[0];

  // Track if edit mode initialization has been done
  const hasInitializedFromEdit = useRef(false);

  // Initialize local state from editMatch when in edit mode
  useEffect(() => {
    // Only run once and only when editMatch is provided
    if (hasInitializedFromEdit.current || !editMatch) {
      return;
    }

    hasInitializedFromEdit.current = true;

    // Initialize facility state if locationType is 'facility' and we have facility data
    if (editMatch.location_type === 'facility' && editMatch.facility) {
      const facility = editMatch.facility;
      // Convert Facility to FacilitySearchResult format
      const facilitySearchResult: FacilitySearchResult = {
        id: facility.id,
        name: facility.name,
        city: facility.city,
        address: facility.address,
        distance_meters: null, // Not available in edit mode
        data_provider_id: facility.data_provider_id,
        data_provider_type: null, // Would need to be fetched from data_provider table
        booking_url_template: null, // Would need to be fetched from data_provider table
        external_provider_id: facility.external_provider_id,
        timezone: facility.timezone,
      };
      setSelectedFacility(facilitySearchResult);

      // Initialize court number if a court is linked to this match
      if (editMatch.court) {
        // Use court_number from the court record, or parse from name as fallback
        const courtNum =
          editMatch.court.court_number ?? parseCourtNumber(editMatch.court.name ?? '');
        setBookedCourtNumber(courtNum);
      }
    }

    // Initialize custom location state if locationType is 'custom' and we have location data
    if (editMatch.location_type === 'custom' && editMatch.location_name) {
      setHasSelectedPlace(true);
    }
  }, [editMatch]);

  // Handle court booking success - called when booking sheet completes
  const handleCourtBookingSuccess = useCallback(
    (
      facility: FacilitySearchResult,
      slot: FormattedSlot,
      data: { facilityId: string; courtId: string; courtNumber: number | null }
    ) => {
      // Update form with facility
      setValue('facilityId', data.facilityId);
      setValue('courtId', data.courtId);
      setValue('courtStatus', 'booked');
      setSelectedFacility(facility);
      setBookedCourtNumber(data.courtNumber);

      // Extract slot data for auto-filling date/time/duration
      const matchDate = formatDateLocal(slot.datetime);
      const startTime = formatTime24(slot.datetime);
      const endTime = formatTime24(slot.endDateTime);
      const durationMins = calculateDurationMinutes(slot.datetime, slot.endDateTime);
      const facilityTimezone = facility.timezone || deviceTimezone;

      // Call parent callback with booking data
      onSlotBooked?.({
        matchDate,
        startTime,
        endTime,
        duration: mapDurationToFormValue(durationMins),
        customDurationMinutes: durationMins,
        timezone: facilityTimezone,
      });

      // Also set location name/address for display
      setValue('locationName', facility.name, { shouldDirty: true });
      const fullAddress = [facility.address, facility.city].filter(Boolean).join(', ');
      setValue('locationAddress', fullAddress || undefined, { shouldDirty: true });

      successHaptic();
    },
    [setValue, deviceTimezone, onSlotBooked]
  );

  // Handle slot press - different behavior for local vs external slots
  const handleSlotPress = useCallback(
    async (facility: FacilitySearchResult, slot: FormattedSlot) => {
      // === LOCAL SLOT: Open court booking sheet ===
      if (slot.isLocalSlot) {
        lightHaptic();

        try {
          // Fetch full facility details needed for booking sheet
          const facilityDetails = await getFacilityWithDetails({
            facilityId: facility.id,
            sportId: sportId || '',
            latitude: location?.latitude,
            longitude: location?.longitude,
          });

          if (!facilityDetails) {
            console.warn('[WhereStep] Failed to fetch facility details');
            return;
          }

          // Open court booking sheet with full facility data
          SheetManager.show('court-booking', {
            payload: {
              facility: facilityDetails,
              slot,
              courts: facilityDetails.courts,
              onSuccess: (data: {
                facilityId: string;
                courtId: string;
                courtNumber: number | null;
              }) => handleCourtBookingSuccess(facility, slot, data),
            },
          });
        } catch (error) {
          console.error('[WhereStep] Error fetching facility details:', error);
        }
        return;
      }

      // === EXTERNAL SLOT: Open external booking URL ===
      if (!slot.bookingUrl) return;

      // If multiple courts available, show selection modal
      if (slot.courtOptions.length > 1) {
        setCourtSelectionData({ facility, slot });
        SheetManager.show('court-selection', {
          payload: {
            courts: slot.courtOptions ?? [],
            timeLabel: slot.time ?? '',
            onSelect: (court: unknown) => handleCourtSelect(court as CourtOption, facility, slot),
            onCancel: handleCourtSelectionCancel,
          },
        });
        return;
      }

      // Single court or no options - open booking URL directly
      const bookingUrl = slot.courtOptions[0]?.bookingUrl || slot.bookingUrl;
      const selectedCourt = slot.courtOptions[0];

      // Store the pending booking info
      setPendingBookingSlot({ facility, slot, selectedCourt });

      // Open external booking URL
      try {
        await Linking.openURL(bookingUrl);
      } catch (error) {
        console.error('Failed to open booking URL:', error);
        setPendingBookingSlot(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sportId, location, handleCourtBookingSuccess]
  );

  // Handle court selection from modal (external slots only - local slots use court-booking sheet)
  // Takes facility/slot directly to avoid stale closure over courtSelectionData state
  const handleCourtSelect = useCallback(
    async (court: CourtOption, facility: FacilitySearchResult, slot: FormattedSlot) => {
      // External slots: Open booking URL
      if (!court.bookingUrl) {
        setCourtSelectionData(null);
        return;
      }

      // Store the pending booking info with selected court
      setPendingBookingSlot({ facility, slot, selectedCourt: court });

      // Open the selected court's booking URL
      try {
        await Linking.openURL(court.bookingUrl);
      } catch (error) {
        console.error('Failed to open booking URL:', error);
        setPendingBookingSlot(null);
      }

      setCourtSelectionData(null);
    },
    []
  );

  // Handle court selection cancel
  const handleCourtSelectionCancel = useCallback(() => {
    setCourtSelectionData(null);
  }, []);

  // Handle booking confirmation
  const handleBookingConfirm = useCallback(async () => {
    if (pendingBookingSlot) {
      const { facility, slot, selectedCourt } = pendingBookingSlot;

      // Update form with the booked facility
      setValue('facilityId', facility.id);
      setValue('courtStatus', 'booked');
      setSelectedFacility(facility);

      // Get the external court ID and name from selectedCourt (if user chose a specific court)
      // or fall back to the slot's values
      const externalCourtId = selectedCourt?.externalCourtId || slot.externalCourtId;
      const courtName = selectedCourt?.courtName || `Court ${slot.facilityScheduleId}`;

      // Link the court to the match by getting/creating a local court record
      if (externalCourtId) {
        try {
          const { court } = await getOrCreateCourt({
            facilityId: facility.id,
            externalProviderId: externalCourtId,
            courtName,
          });
          setValue('courtId', court.id);

          // Store the court number to display in the selected facility card
          // Use the court number from the database if available, otherwise parse from name
          const courtNum = court.court_number ?? parseCourtNumber(courtName);
          setBookedCourtNumber(courtNum);
        } catch (error) {
          // Log error but don't block the booking confirmation
          // The match can still be created without a specific court link
          console.warn('[WhereStep] Failed to get/create court:', error);

          // Still try to show the court number from the name
          setBookedCourtNumber(parseCourtNumber(courtName));
        }
      }

      // Extract slot data for auto-filling date/time/duration in WhenStep
      const slotDate = slot.datetime;
      const matchDate = formatDateLocal(slotDate);
      const startTime = formatTime24(slotDate);
      const endTime = formatTime24(slot.endDateTime);
      const durationMins = calculateDurationMinutes(slot.datetime, slot.endDateTime);

      // Use facility timezone if available, otherwise use device timezone
      const facilityTimezone = facility.timezone || deviceTimezone;

      // Call parent callback with booking data
      onSlotBooked?.({
        matchDate,
        startTime,
        endTime,
        duration: mapDurationToFormValue(durationMins),
        customDurationMinutes: durationMins,
        timezone: facilityTimezone,
      });

      successHaptic();
    }
    setPendingBookingSlot(null);
    setShowBookingConfirmation(false);
  }, [pendingBookingSlot, setValue, deviceTimezone, onSlotBooked]);

  // Handle booking cancel
  const handleBookingCancel = useCallback(() => {
    setPendingBookingSlot(null);
    setShowBookingConfirmation(false);
  }, []);

  // Listen for app returning to foreground after external booking
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active' && pendingBookingSlot) {
        setShowBookingConfirmation(true);
      }
    });

    return () => subscription.remove();
  }, [pendingBookingSlot, handleBookingConfirm, handleBookingCancel]);

  // Track previous sportId to only reset on actual sport changes (not initial mount)
  const prevSportIdRef = useRef<string | undefined>(sportId);

  // Reset state when sportId changes (when switching sports)
  // Skip initial mount to allow edit mode initialization to persist
  useEffect(() => {
    // Skip if this is the initial mount (sportId hasn't changed yet)
    if (prevSportIdRef.current === sportId) {
      return;
    }
    prevSportIdRef.current = sportId;

    setSelectedFacility(null);
    setBookedCourtNumber(null);
    setSearchQuery('');
    setPlaceSearchQuery('');
    setHasSelectedPlace(false);
    setPendingBookingSlot(null);
    setCourtSelectionData(null);
  }, [sportId]);

  // Sync hasSelectedPlace when resuming a draft with custom location
  useEffect(() => {
    if (locationType === 'custom' && locationName && !hasSelectedPlace) {
      setHasSelectedPlace(true);
    }
  }, [locationType, locationName, hasSelectedPlace]);

  // Facility search hook
  const {
    facilities: searchFacilities,
    isLoading: facilitiesLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error: facilitiesError,
  } = useFacilitySearch({
    sportIds: sportId ? [sportId] : undefined,
    latitude: location?.latitude,
    longitude: location?.longitude,
    searchQuery,
    enabled: locationType === 'facility' && !selectedFacility,
  });

  // Preferred facility hook - fetch the player's preferred facility
  const { preferredFacility } = usePreferredFacility({
    preferredFacilityId,
    sportId,
    latitude: location?.latitude,
    longitude: location?.longitude,
    enabled: locationType === 'facility' && !selectedFacility && !!preferredFacilityId,
  });

  // Merge facilities list with preferred facility first, deduplicating
  const facilities = React.useMemo(() => {
    if (!preferredFacility) {
      return searchFacilities;
    }

    // Filter out the preferred facility from search results to avoid duplicates
    const filteredFacilities = searchFacilities.filter(f => f.id !== preferredFacility.id);

    // Return preferred facility first, followed by other facilities
    return [preferredFacility, ...filteredFacilities];
  }, [preferredFacility, searchFacilities]);

  // Places autocomplete hook for custom location search
  const {
    predictions: placePredictions,
    isLoading: placesLoading,
    error: placesError,
    clearPredictions,
    getPlaceDetails,
  } = usePlacesAutocomplete({
    searchQuery: placeSearchQuery,
    enabled: locationType === 'custom' && !hasSelectedPlace,
  });

  // State for fetching place details
  const [, setIsFetchingPlaceDetails] = useState(false);

  // Handle facility selection
  const handleSelectFacility = useCallback(
    (facility: FacilitySearchResult) => {
      successHaptic();
      setSelectedFacility(facility);
      setValue('facilityId', facility.id, { shouldValidate: true, shouldDirty: true });
      // Also set location name and address for display purposes
      setValue('locationName', facility.name, { shouldDirty: true });
      // Combine address and city for locationAddress
      const fullAddress = [facility.address, facility.city].filter(Boolean).join(', ');
      setValue('locationAddress', fullAddress || undefined, { shouldDirty: true });
      // Update timezone to facility's timezone when set, otherwise keep device timezone
      const facilityTimezone = facility.timezone || deviceTimezone;
      setValue('timezone', facilityTimezone, { shouldDirty: true });
    },
    [setValue, deviceTimezone]
  );

  // Handle clearing selected facility
  const handleClearFacility = useCallback(() => {
    setSelectedFacility(null);
    setBookedCourtNumber(null);
    setValue('facilityId', undefined, { shouldValidate: true, shouldDirty: true });
    setValue('courtId', undefined, { shouldDirty: true });
    setValue('locationName', undefined, { shouldDirty: true });
    setValue('locationAddress', undefined, { shouldDirty: true });
    setSearchQuery('');
  }, [setValue]);

  // Handle place selection from autocomplete
  const handleSelectPlace = useCallback(
    async (place: PlacePrediction) => {
      successHaptic();
      setHasSelectedPlace(true);
      setPlaceSearchQuery('');
      clearPredictions();

      // Set form values immediately with available data
      setValue('locationName', place.name, { shouldValidate: true, shouldDirty: true });
      setValue('locationAddress', place.address || undefined, { shouldDirty: true });

      // Fetch place details to get coordinates and timezone
      setIsFetchingPlaceDetails(true);
      try {
        const details = await getPlaceDetails(place.placeId);
        if (details) {
          // Update address if we got a better one from details
          if (details.address) {
            setValue('locationAddress', details.address, { shouldDirty: true });
          }
          // Store coordinates
          setValue('customLatitude', details.latitude, { shouldDirty: true });
          setValue('customLongitude', details.longitude, { shouldDirty: true });
          // Update timezone to place's timezone (from Google Time Zone API) or device timezone
          const placeTimezone = details.timezone || deviceTimezone;
          setValue('timezone', placeTimezone, { shouldDirty: true });
        }
      } catch (error) {
        console.error('Failed to fetch place details:', error);
        // Continue without coordinates - the match can still be created
      } finally {
        setIsFetchingPlaceDetails(false);
      }
    },
    [setValue, clearPredictions, getPlaceDetails, deviceTimezone]
  );

  // Handle clearing selected place
  const handleClearPlace = useCallback(() => {
    setHasSelectedPlace(false);
    setValue('locationName', undefined, { shouldValidate: true, shouldDirty: true });
    setValue('locationAddress', undefined, { shouldDirty: true });
    setValue('customLatitude', undefined, { shouldDirty: true });
    setValue('customLongitude', undefined, { shouldDirty: true });
    setPlaceSearchQuery('');
    clearPredictions();
  }, [setValue, clearPredictions]);

  // Handle location type changes - clear data from the PREVIOUS location type
  const handleLocationTypeChange = useCallback(
    (newLocationType: 'facility' | 'custom' | 'tbd') => {
      if (locationType === newLocationType) {
        return;
      }

      lightHaptic();
      setValue('locationType', newLocationType, { shouldDirty: true });

      // Clear all location-related data when switching types
      // Use empty strings for string fields - emptyToNull in the service layer converts them to null for the database
      setSelectedFacility(null);
      setValue('facilityId', '', { shouldDirty: true });
      setValue('courtId', '', { shouldDirty: true });
      setValue('courtStatus', 'to_book', { shouldDirty: true });
      setValue('locationName', '', { shouldDirty: true });
      setValue('locationAddress', '', { shouldDirty: true });
      setValue('customLatitude', undefined, { shouldDirty: true });
      setValue('customLongitude', undefined, { shouldDirty: true });
      setValue('isCourtFree', true, { shouldDirty: true });
      setValue('costSplitType', 'equal', { shouldDirty: true });
      setValue('estimatedCost', 0, { shouldDirty: true });

      // Reset UI state
      setSearchQuery('');
      setPlaceSearchQuery('');
      setHasSelectedPlace(false);
      clearPredictions();
    },
    [setValue, clearPredictions, locationType]
  );

  // Handle infinite scroll via ScrollView
  const handleScroll = useCallback(
    (event: {
      nativeEvent: {
        layoutMeasurement: { height: number };
        contentOffset: { y: number };
        contentSize: { height: number };
      };
    }) => {
      const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
      const paddingToBottom = 200; // Trigger load more when 200px from bottom
      const isCloseToBottom =
        layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;

      if (isCloseToBottom && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  // Combined loading state: show loading only when actually fetching data
  const isLoadingFacilities = facilitiesLoading;

  // Render empty state
  const renderEmptyState = useCallback(() => {
    if (isLoadingFacilities || locationLoading) {
      return (
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color={colors.buttonActive} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {locationLoading
              ? t('matchCreation.fields.gettingLocation')
              : t('matchCreation.fields.searchingFacilities')}
          </Text>
        </View>
      );
    }

    if (facilitiesError) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={32} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('matchCreation.fields.failedToLoadFacilities')}
          </Text>
        </View>
      );
    }

    if (searchQuery && facilities.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={32} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('matchCreation.fields.noFacilitiesFound', { query: searchQuery })}
          </Text>
        </View>
      );
    }

    if (!searchQuery && facilities.length === 0 && !isFetching) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="business-outline" size={32} color={colors.textMuted} />
          <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
            {t('matchCreation.fields.noFacilitiesAvailable')}
          </Text>
        </View>
      );
    }

    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLoadingFacilities,
    locationLoading,
    facilitiesError,
    searchQuery,
    facilities.length,
    isFetching,
    colors,
    t,
  ]);

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={[
        styles.contentContainer,
        locationType === 'custom' && styles.contentContainerWithKeyboard,
      ]}
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={400}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* Step title */}
      <View style={styles.stepHeader}>
        <Text size="lg" weight="bold" color={colors.text}>
          {t('matchCreation.step1Title')}
        </Text>
        <Text size="sm" color={colors.textMuted}>
          {t('matchCreation.step1Description')}
        </Text>
      </View>

      {/* Location type selection */}
      <View style={styles.fieldGroup}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('matchCreation.fields.locationType')}
        </Text>

        <View style={styles.locationCards}>
          <LocationTypeCard
            icon="business-outline"
            title={t('matchCreation.fields.locationTypeFacility')}
            description={t('matchCreation.fields.locationTypeFacilityDescription')}
            selected={locationType === 'facility'}
            onPress={() => handleLocationTypeChange('facility')}
            colors={colors}
          />

          <LocationTypeCard
            icon="location-outline"
            title={t('matchCreation.fields.locationTypeCustom')}
            description={t('matchCreation.fields.locationTypeCustomDescription')}
            selected={locationType === 'custom'}
            onPress={() => handleLocationTypeChange('custom')}
            colors={colors}
          />

          <LocationTypeCard
            icon="help-circle-outline"
            title={t('matchCreation.fields.locationTypeTbd')}
            description={t('matchCreation.fields.locationTypeTbdDescription')}
            selected={locationType === 'tbd'}
            onPress={() => handleLocationTypeChange('tbd')}
            colors={colors}
          />
        </View>
      </View>

      {/* Facility selection (when locationType === 'facility') */}
      {locationType === 'facility' && (
        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
            {t('matchCreation.fields.facility')}
          </Text>

          {/* Show selected facility or search UI */}
          {selectedFacility ? (
            <SelectedFacility
              facility={selectedFacility}
              onClear={handleClearFacility}
              colors={colors}
              bookedCourtNumber={bookedCourtNumber}
              t={t}
            />
          ) : (
            <>
              {/* Search input with location selector */}
              <View ref={facilitySearchRef} style={styles.searchRow}>
                <View style={styles.searchBarFlex}>
                  <SearchBar
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder={t('matchCreation.fields.facilityPlaceholder')}
                    colors={colors}
                    InputComponent={BottomSheetTextInput}
                    onFocus={() => setFocusedField('facility')}
                    containerStyle={styles.compactSearchContainer}
                  />
                </View>
                {hasBothLocationOptions && (
                  <LocationSelector
                    selectedMode={locationMode}
                    onSelectMode={setLocationMode}
                    hasHomeLocation={hasHomeLocation}
                    homeLocationLabel={homeLocationLabel}
                    isDark={isDark}
                    t={t}
                  />
                )}
              </View>

              {/* Facility list */}
              {facilities.length > 0 ? (
                <View style={styles.facilityListContainer}>
                  {facilities.map(facility => (
                    <FacilityItem
                      key={facility.id}
                      facility={facility}
                      onSelect={handleSelectFacility}
                      onSlotPress={handleSlotPress}
                      colors={colors}
                      t={t}
                      isDark={isDark}
                      isPreferred={facility.id === preferredFacilityId}
                      sportName={sportName}
                    />
                  ))}
                  {isFetchingNextPage && (
                    <View style={styles.footerLoader}>
                      <ActivityIndicator size="small" color={colors.buttonActive} />
                    </View>
                  )}
                </View>
              ) : (
                renderEmptyState()
              )}
            </>
          )}
        </View>
      )}

      {/* Custom location input (when locationType === 'custom') */}
      {locationType === 'custom' && (
        <View style={styles.fieldGroup}>
          <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
            {t('matchCreation.fields.searchLocation')}
          </Text>

          {/* Show selected place or search UI */}
          {hasSelectedPlace && locationName ? (
            <SelectedPlace
              name={locationName}
              address={locationAddress}
              onClear={handleClearPlace}
              colors={colors}
            />
          ) : (
            <>
              {/* Search input */}
              <View ref={placeSearchRef}>
                <SearchBar
                  value={placeSearchQuery}
                  onChangeText={text => {
                    setPlaceSearchQuery(text);
                    if (!text) clearPredictions();
                  }}
                  placeholder={t('matchCreation.fields.searchLocationPlaceholder')}
                  colors={colors}
                  InputComponent={BottomSheetTextInput}
                  onFocus={() => setFocusedField('place')}
                  borderColor={errors.locationName ? '#ef4444' : undefined}
                />
              </View>
              {errors.locationName && (
                <Text size="xs" color="#ef4444" style={styles.errorText}>
                  {errors.locationName.message}
                </Text>
              )}

              {/* Loading state */}
              {placesLoading && (
                <View style={styles.emptyState}>
                  <ActivityIndicator size="small" color={colors.buttonActive} />
                  <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
                    {t('matchCreation.fields.searchingPlaces')}
                  </Text>
                </View>
              )}

              {/* Error state */}
              {placesError && !placesLoading && (
                <View style={styles.emptyState}>
                  <Ionicons name="alert-circle-outline" size={32} color={colors.textMuted} />
                  <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
                    {t('matchCreation.fields.failedToSearchPlaces')}
                  </Text>
                </View>
              )}

              {/* Place predictions list */}
              {placePredictions.length > 0 && !placesLoading && (
                <View style={styles.facilityListContainer}>
                  {placePredictions.map(place => (
                    <PlaceItem
                      key={place.placeId}
                      place={place}
                      onSelect={handleSelectPlace}
                      colors={colors}
                    />
                  ))}
                </View>
              )}

              {/* No results state */}
              {placeSearchQuery.length >= 2 &&
                placePredictions.length === 0 &&
                !placesLoading &&
                !placesError && (
                  <View style={styles.emptyState}>
                    <Ionicons name="search-outline" size={32} color={colors.textMuted} />
                    <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
                      {t('matchCreation.fields.noPlacesFound')}
                    </Text>
                  </View>
                )}

              {/* Manual entry hint */}
              {placeSearchQuery.length === 0 && (
                <View style={styles.hintContainer}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                  <Text size="xs" color={colors.textMuted}>
                    {t('matchCreation.fields.searchLocationHint')}
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* TBD info message */}
      {locationType === 'tbd' && (
        <View
          style={[
            styles.infoBox,
            { backgroundColor: `${colors.buttonActive}10`, borderColor: colors.buttonActive },
          ]}
        >
          <Ionicons name="information-circle-outline" size={20} color={colors.buttonActive} />
          <Text size="sm" color={colors.textSecondary} style={styles.infoText}>
            {t('matchCreation.fields.tbdLocationInfo')}
          </Text>
        </View>
      )}

      {/* Booking confirmation modal (shown when returning from external booking site) */}
      <ConfirmationModal
        visible={showBookingConfirmation}
        onClose={handleBookingCancel}
        onConfirm={handleBookingConfirm}
        title={t('matchCreation.booking.bookingConfirmTitle')}
        message={t('matchCreation.booking.bookingConfirmMessage')}
        confirmLabel={t('matchCreation.booking.iBookedThisCourt')}
        cancelLabel={t('matchCreation.booking.notYet')}
      />
    </ScrollView>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: spacingPixels[4],
    paddingBottom: spacingPixels[16], // Base padding for scrolling
  },
  contentContainerWithKeyboard: {
    paddingBottom: spacingPixels[32], // Extra padding when custom location is selected to allow scrolling above keyboard
  },
  stepHeader: {
    marginBottom: spacingPixels[6],
  },
  fieldGroup: {
    marginBottom: spacingPixels[5],
  },
  label: {
    marginBottom: spacingPixels[2],
  },
  locationCards: {
    gap: spacingPixels[3],
  },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  locationIconContainer: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationTextContainer: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
  },
  searchBarFlex: {
    flex: 1,
  },
  compactSearchContainer: {
    paddingVertical: spacingPixels[2],
  },
  facilityListContainer: {
    marginTop: spacingPixels[3],
  },
  facilityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacingPixels[3],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    marginBottom: spacingPixels[2],
  },
  facilityItemContent: {
    flex: 1,
  },
  facilityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  facilityNameContainer: {
    flex: 1,
    marginRight: spacingPixels[2],
  },
  facilityNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
  },
  preferredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
  },
  slotsScrollView: {
    marginTop: spacingPixels[2],
    marginHorizontal: -spacingPixels[3], // Extend to card edges
  },
  slotsScrollContent: {
    paddingHorizontal: spacingPixels[3],
    gap: spacingPixels[4],
  },
  dateGroup: {
    gap: spacingPixels[1],
  },
  dateLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 10,
  },
  dateSlotsRow: {
    flexDirection: 'row',
    gap: spacingPixels[1.5],
  },
  slotsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingPixels[2],
    marginTop: spacingPixels[2],
  },
  slotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  courtCountBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacingPixels[0.5],
  },
  courtCountText: {
    fontSize: 10,
    lineHeight: 12,
    includeFontPadding: false,
  },
  emptySlots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[1],
    marginTop: spacingPixels[2],
    paddingVertical: spacingPixels[1],
  },
  placeItemIcon: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[2],
  },
  distanceBadge: {
    marginLeft: spacingPixels[2],
  },
  selectedFacility: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
  },
  selectedFacilityContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[3],
  },
  selectedFacilityText: {
    flex: 1,
  },
  selectedFacilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    flexWrap: 'wrap',
  },
  courtNumberBadge: {
    paddingHorizontal: spacingPixels[2],
    paddingVertical: spacingPixels[0.5],
    borderRadius: radiusPixels.full,
    marginTop: spacingPixels[1],
    alignSelf: 'flex-start',
  },
  textInput: {
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    fontSize: 16,
  },
  errorText: {
    marginTop: spacingPixels[1],
  },
  infoBox: {
    flexDirection: 'row',
    padding: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    borderWidth: 1,
    gap: spacingPixels[3],
  },
  infoText: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacingPixels[6],
    gap: spacingPixels[2],
  },
  emptyStateText: {
    textAlign: 'center',
  },
  footerLoader: {
    alignItems: 'center',
    paddingVertical: spacingPixels[4],
  },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[1],
  },
});

export default WhereStep;
