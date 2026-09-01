/**
 * Where Step
 *
 * Step 1 of the match creation wizard.
 * Handles location selection, court booking status, and court cost.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  AppState,
  Linking,
  TextInput,
} from 'react-native';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { UseFormReturn, useWatch } from 'react-hook-form';
import { Ionicons } from '@expo/vector-icons';
import { ScrollView as SheetScrollView, SheetManager } from 'react-native-actions-sheet';
import { Text, Callout, Badge, SelectableChip } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, status } from '@rallia/design-system';
import { lightHaptic, successHaptic } from '@rallia/shared-utils';
import {
  getOrCreateCourt,
  parseCourtNumber,
  getFacilityWithDetails,
} from '@rallia/shared-services';
import { usePlacesAutocomplete, usePlayer } from '@rallia/shared-hooks';
import type { FormattedSlot, CourtOption } from '@rallia/shared-hooks';
import type {
  MatchFormSchemaData,
  FacilitySearchResult,
  PlacePrediction,
  MatchWithDetails,
} from '@rallia/shared-types';

import { ConfirmationModal } from '#/components/ConfirmationModal';
import { runWhenIdle } from '#/utils/runWhenIdle';
import { useEffectiveLocation } from '#/hooks/useEffectiveLocation';
import { useUserHomeLocation } from '#/context';
import { SearchBar } from '#/components/SearchBar';
import { useKeyboardAwareSheetScroll } from '#/hooks/useKeyboardAwareSheetScroll';
import type { TranslationKey, TranslationOptions } from '#/hooks/useTranslation';
import * as Analytics from '#/services/analytics';

import { FacilitySearchSection } from './FacilitySearchSection';

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
  /** Pre-filled facility data from booking confirmation flow */
  initialBookingFacility?: {
    id: string;
    name: string;
    address?: string | null;
    city?: string | null;
    timezone?: string | null;
    courtNumber?: number | null;
  } | null;
}

interface LocationTypeChipProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** Shown as a pill on the chip, used to promote the facility option */
  badge?: string;
  selected: boolean;
  onPress: () => void;
  colors: WhereStepProps['colors'];
}

/** Description shown under the chips for the selected location type */
const LOCATION_TYPE_HINT_KEYS: Record<'facility' | 'custom' | 'tbd', TranslationKey> = {
  facility: 'matchCreation.fields.locationTypeFacilityDescription',
  custom: 'matchCreation.fields.locationTypeCustomDescription',
  tbd: 'matchCreation.fields.locationTypeTbdDescription',
};

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

// =============================================================================
// LOCATION TYPE CHIP
// =============================================================================

const LocationTypeChip: React.FC<LocationTypeChipProps> = ({
  icon,
  title,
  badge,
  selected,
  onPress,
  colors,
}) => (
  <SelectableChip
    variant="tinted"
    label={title}
    selected={selected}
    accentColor={colors.buttonActive}
    icon={
      <Ionicons name={icon} size={16} color={selected ? colors.buttonActive : colors.textMuted} />
    }
    trailingIcon={
      badge ? (
        <Badge size="sm" backgroundColor={colors.buttonActive} textColor={colors.buttonTextActive}>
          {badge}
        </Badge>
      ) : undefined
    }
    onPress={() => {
      lightHaptic();
      onPress();
    }}
  />
);

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
  initialBookingFacility,
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
  const courtStatus = useWatch({ control, name: 'courtStatus' });
  const facilityId = useWatch({ control, name: 'facilityId' });

  const { scrollProps, inputs } = useKeyboardAwareSheetScroll(['facilitySearch', 'placeSearch']);

  // A location is set once a facility is picked or a custom place is entered
  const hasLocationSpecified =
    (locationType === 'facility' && !!facilityId) || (locationType === 'custom' && !!locationName);

  useEffect(() => {
    if (hasLocationSpecified && !courtStatus) {
      setValue('courtStatus', 'to_book', { shouldDirty: false });
    }
  }, [hasLocationSpecified, courtStatus, setValue]);

  // Local state for search and selected facility
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFacility, setSelectedFacility] = useState<FacilitySearchResult | null>(null);
  // Nothing to reserve at a first-come facility, so the booking prompts below
  // would all be asking about something the player cannot do.
  const isFirstComeFacility =
    locationType === 'facility' && !!selectedFacility?.is_first_come_first_serve;
  const [bookedCourtNumber, setBookedCourtNumber] = useState<number | null>(null);

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

  // Initialize local state from booking confirmation flow (facility pre-filled by wizard)
  const hasInitializedFromBooking = useRef(false);
  useEffect(() => {
    if (hasInitializedFromBooking.current || !initialBookingFacility) {
      return;
    }
    hasInitializedFromBooking.current = true;

    const facilitySearchResult: FacilitySearchResult = {
      id: initialBookingFacility.id,
      name: initialBookingFacility.name,
      city: initialBookingFacility.city ?? null,
      address: initialBookingFacility.address ?? null,
      distance_meters: null,
      data_provider_id: null,
      data_provider_type: null,
      booking_url_template: null,
      external_provider_id: null,
      timezone: initialBookingFacility.timezone ?? null,
    };
    setSelectedFacility(facilitySearchResult);
    if (initialBookingFacility.courtNumber != null) {
      setBookedCourtNumber(initialBookingFacility.courtNumber);
    }
  }, [initialBookingFacility]);

  // Handle court booking success - called when booking sheet completes
  const handleCourtBookingSuccess = useCallback(
    (
      facility: FacilitySearchResult,
      slot: FormattedSlot,
      data: { facilityId: string; courtId: string; courtNumber: number | null }
    ) => {
      Analytics.courtBooked({
        facility_id: data.facilityId,
        sport_id: sportId ?? 'unknown',
        sport_name: sportName ?? 'unknown',
      });

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
      Analytics.bookingInitiated({
        facility_id: facility.id,
        sport_id: sportId ?? 'unknown',
        sport_name: sportName ?? 'unknown',
      });

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
        Analytics.bookingRedirected({
          facility_id: facility.id,
          sport_id: sportId ?? 'unknown',
          sport_name: sportName ?? 'unknown',
          is_match_linked: false,
          source: 'match_creation',
        });
      } catch (error) {
        console.error('Failed to open booking URL:', error);
        setPendingBookingSlot(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sportId, sportName, location, handleCourtBookingSuccess]
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
        Analytics.bookingRedirected({
          facility_id: facility.id,
          sport_id: sportId ?? 'unknown',
          sport_name: sportName ?? 'unknown',
          is_match_linked: false,
          source: 'match_creation',
        });
      } catch (error) {
        console.error('Failed to open booking URL:', error);
        setPendingBookingSlot(null);
      }

      setCourtSelectionData(null);
    },
    [sportId, sportName]
  );

  // Handle court selection cancel
  const handleCourtSelectionCancel = useCallback(() => {
    setCourtSelectionData(null);
  }, []);

  // Handle booking confirmation
  const handleBookingConfirm = useCallback(async () => {
    if (pendingBookingSlot) {
      const { facility, slot, selectedCourt } = pendingBookingSlot;

      Analytics.bookingConfirmed({
        facility_id: facility.id,
        sport_id: sportId ?? 'unknown',
        sport_name: sportName ?? 'unknown',
        is_match_linked: false,
      });

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
  }, [pendingBookingSlot, setValue, deviceTimezone, onSlotBooked, sportId, sportName]);

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

  // The facility search section registers its load-more here (see FacilitySearchSection)
  const loadMoreRef = useRef<(() => void) | null>(null);

  // Defer the data-heavy facility section one idle tick so the step's static
  // chrome mounts instantly when the wizard opens
  const [facilitySectionReady, setFacilitySectionReady] = useState(false);
  useEffect(() => {
    const handle = runWhenIdle(() => setFacilitySectionReady(true), { timeout: 300 });
    return () => handle.cancel();
  }, []);

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

      if (isCloseToBottom) {
        loadMoreRef.current?.();
      }
    },
    []
  );

  return (
    <SheetScrollView
      {...scrollProps}
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      onScroll={event => {
        scrollProps.onScroll(event);
        handleScroll(event);
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
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

      {/* Fill-rate nudge: booked courts fill about twice as often */}
      {locationType === 'facility' && courtStatus !== 'booked' && !isFirstComeFacility && (
        <View style={styles.fieldGroup}>
          <Callout tone="success" message={t('matchCreation.nudges.bookCourt')} />
        </View>
      )}

      {/* Location type selection */}
      <View style={styles.fieldGroup}>
        <Text size="sm" weight="semibold" color={colors.textSecondary} style={styles.label}>
          {t('matchCreation.fields.locationType')}
        </Text>

        <GestureScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.locationChips}
          nestedScrollEnabled
        >
          <LocationTypeChip
            icon="business-outline"
            title={t('matchCreation.fields.locationTypeFacilityShort')}
            badge={t('matchCreation.fields.locationTypeRecommended')}
            selected={locationType === 'facility'}
            onPress={() => handleLocationTypeChange('facility')}
            colors={colors}
          />
          <LocationTypeChip
            icon="location-outline"
            title={t('matchCreation.fields.locationTypeCustomShort')}
            selected={locationType === 'custom'}
            onPress={() => handleLocationTypeChange('custom')}
            colors={colors}
          />
          <LocationTypeChip
            icon="help-circle-outline"
            title={t('matchCreation.fields.locationTypeTbdShort')}
            selected={locationType === 'tbd'}
            onPress={() => handleLocationTypeChange('tbd')}
            colors={colors}
          />
        </GestureScrollView>
        <Text size="xs" color={colors.textMuted} style={styles.optionHint}>
          {t(LOCATION_TYPE_HINT_KEYS[locationType])}
        </Text>
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
          ) : facilitySectionReady ? (
            <FacilitySearchSection
              colors={colors}
              t={t}
              isDark={isDark}
              sportId={sportId}
              sportName={sportName}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              searchInput={inputs.facilitySearch}
              location={location}
              locationLoading={locationLoading}
              locationMode={locationMode}
              onSelectLocationMode={setLocationMode}
              hasHomeLocation={hasHomeLocation}
              hasBothLocationOptions={hasBothLocationOptions}
              homeLocationLabel={homeLocationLabel}
              playerId={player?.id ?? null}
              preferredFacilityId={preferredFacilityId}
              onSelectFacility={handleSelectFacility}
              onSlotPress={handleSlotPress}
              loadMoreRef={loadMoreRef}
            />
          ) : (
            <View style={styles.emptyState}>
              <ActivityIndicator size="small" color={colors.buttonActive} />
              <Text size="sm" color={colors.textMuted} style={styles.emptyStateText}>
                {t('matchCreation.fields.searchingFacilities')}
              </Text>
            </View>
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
              <View>
                <SearchBar
                  inputRef={inputs.placeSearch.ref}
                  onFocus={inputs.placeSearch.onFocus}
                  onBlur={inputs.placeSearch.onBlur}
                  value={placeSearchQuery}
                  onChangeText={text => {
                    setPlaceSearchQuery(text);
                    if (!text) clearPredictions();
                  }}
                  placeholder={t('matchCreation.fields.searchLocationPlaceholder')}
                  colors={colors}
                  InputComponent={TextInput}
                  borderColor={errors.locationName ? status.error.DEFAULT : undefined}
                />
              </View>
              {errors.locationName && (
                <Text size="xs" color={status.error.DEFAULT} style={styles.errorText}>
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
    </SheetScrollView>
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
    paddingBottom: spacingPixels[8],
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
  locationChips: {
    gap: spacingPixels[2],
    paddingRight: spacingPixels[1],
  },
  optionHint: {
    marginTop: spacingPixels[2],
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
  placeItemIcon: {
    width: 32,
    height: 32,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[2],
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
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingPixels[2],
    marginTop: spacingPixels[2],
    paddingHorizontal: spacingPixels[1],
  },
});

export default WhereStep;
