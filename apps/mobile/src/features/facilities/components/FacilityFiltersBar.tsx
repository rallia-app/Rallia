/**
 * FacilityFiltersBar Component
 * A horizontally scrollable row of filter chips for facility filtering.
 * Uses compact dropdown-based filters matching MatchFiltersBar style.
 */

import React, { useCallback, useState, useMemo, useEffect } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Modal, Animated } from 'react-native';
import { Text, LocationSelector, type LocationMode } from '@rallia/shared-components';
import {
  useTheme,
  type FacilityFilters,
  type FacilityDistanceFilter,
  type FacilityTypeFilter,
  type SurfaceTypeFilter,
  type CourtTypeFilter,
  type LightingFilter,
  type MembershipFilter,
} from '@rallia/shared-hooks';
import { useTranslation } from '../../../hooks';
import {
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  secondary,
  duration as animDuration,
  lightTheme,
  darkTheme,
} from '@rallia/design-system';
import { Ionicons } from '@expo/vector-icons';
import { selectionHaptic, lightHaptic } from '../../../utils/haptics';

// =============================================================================
// FILTER OPTIONS
// =============================================================================

const DISTANCE_OPTIONS: FacilityDistanceFilter[] = ['all', 5, 10, 15, 25, 50];
const FACILITY_TYPES: ('all' | FacilityTypeFilter)[] = [
  'all',
  'park',
  'club',
  'indoor_center',
  'municipal',
  'community_center',
  'university',
  'school',
  'private',
  'other',
];
const SURFACE_TYPES: ('all' | SurfaceTypeFilter)[] = [
  'all',
  'hard',
  'clay',
  'grass',
  'synthetic',
  'carpet',
];
const COURT_TYPES: ('all' | CourtTypeFilter)[] = ['all', 'indoor', 'outdoor'];
const LIGHTING_OPTIONS: LightingFilter[] = ['all', 'with_lights', 'no_lights'];
const MEMBERSHIP_OPTIONS: MembershipFilter[] = ['all', 'public', 'members_only'];

// =============================================================================
// FILTER CHIP COMPONENT
// =============================================================================

interface FilterChipProps {
  value: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
  hasDropdown?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

function FilterChip({
  value,
  isActive,
  onPress,
  isDark,
  hasDropdown = true,
  icon,
}: FilterChipProps) {
  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const bgColor = isActive ? primary[500] : isDark ? neutral[800] : neutral[100];
  const borderColor = isActive ? primary[400] : isDark ? neutral[700] : neutral[200];
  const textColor = isActive ? '#ffffff' : isDark ? neutral[300] : neutral[600];

  const handlePress = () => {
    lightHaptic();
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 50,
        useNativeDriver: true,
      }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.chip,
          {
            backgroundColor: bgColor,
            borderColor: borderColor,
          },
        ]}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        {icon && <Ionicons name={icon} size={14} color={textColor} style={styles.chipIcon} />}
        <Text size="xs" weight={isActive ? 'semibold' : 'medium'} color={textColor}>
          {value}
        </Text>
        {hasDropdown && (
          <Ionicons
            name="chevron-down-outline"
            size={12}
            color={textColor}
            style={styles.chipChevron}
          />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// =============================================================================
// FILTER DROPDOWN MODAL COMPONENT
// =============================================================================

interface FilterDropdownProps<T extends string | number> {
  visible: boolean;
  title: string;
  options: T[];
  selectedValue: T;
  onSelect: (value: T) => void;
  onClose: () => void;
  isDark: boolean;
  getLabel: (value: T) => string;
  getIcon?: (value: T) => keyof typeof Ionicons.glyphMap | undefined;
}

function FilterDropdown<T extends string | number>({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
  isDark,
  getLabel,
  getIcon,
}: FilterDropdownProps<T>) {
  const fadeAnim = useMemo(() => new Animated.Value(0), []);
  const scaleAnim = useMemo(() => new Animated.Value(0.9), []);

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = {
    dropdownBg: themeColors.card,
    dropdownBorder: themeColors.border,
    itemText: themeColors.foreground,
    itemTextSelected: primary[500],
    itemBg: 'transparent',
    itemBgSelected: isDark ? `${primary[500]}20` : `${primary[500]}10`,
    itemBorder: themeColors.border,
    overlayBg: 'rgba(0, 0, 0, 0.5)',
    checkmark: primary[500],
  };

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: animDuration.fast,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 100,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.9);
    }
  }, [visible, fadeAnim, scaleAnim]);

  const handleSelect = (value: T) => {
    selectionHaptic();
    onSelect(value);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[
            styles.overlayBackground,
            {
              opacity: fadeAnim,
              backgroundColor: colors.overlayBg,
            },
          ]}
        />
        <Animated.View
          style={[
            styles.dropdownContainer,
            {
              backgroundColor: colors.dropdownBg,
              borderColor: colors.dropdownBorder,
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Header */}
          <View style={[styles.dropdownHeader, { borderBottomColor: colors.itemBorder }]}>
            <Text size="base" weight="semibold" color={themeColors.foreground}>
              {title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-outline" size={22} color={themeColors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Options list */}
          <ScrollView
            style={styles.dropdownScrollView}
            showsVerticalScrollIndicator={false}
            bounces={options.length > 6}
          >
            {options.map((option, index) => {
              const isSelected = selectedValue === option;
              const isLast = index === options.length - 1;
              const optionIcon = getIcon?.(option);

              return (
                <TouchableOpacity
                  key={String(option)}
                  style={[
                    styles.dropdownItem,
                    {
                      backgroundColor: isSelected ? colors.itemBgSelected : colors.itemBg,
                      borderBottomColor: isLast ? 'transparent' : colors.itemBorder,
                    },
                  ]}
                  onPress={() => handleSelect(option)}
                  activeOpacity={0.7}
                >
                  <View style={styles.dropdownItemContent}>
                    {optionIcon && (
                      <Ionicons
                        name={optionIcon}
                        size={18}
                        color={isSelected ? colors.itemTextSelected : colors.itemText}
                        style={styles.dropdownItemIcon}
                      />
                    )}
                    <Text
                      size="base"
                      weight={isSelected ? 'semibold' : 'regular'}
                      color={isSelected ? colors.itemTextSelected : colors.itemText}
                    >
                      {getLabel(option)}
                    </Text>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle-outline" size={22} color={colors.checkmark} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

interface FacilityFiltersBarProps {
  filters: FacilityFilters;
  onFiltersChange: (filters: FacilityFilters) => void;
  onReset?: () => void;
  hasActiveFilters?: boolean;
  showLocationSelector?: boolean;
  locationMode?: LocationMode;
  onLocationModeChange?: (mode: LocationMode) => void;
  hasHomeLocation?: boolean;
  homeLocationLabel?: string;
}

export default function FacilityFiltersBar({
  filters,
  onFiltersChange,
  onReset,
  hasActiveFilters = false,
  showLocationSelector = false,
  locationMode,
  onLocationModeChange,
  hasHomeLocation = false,
  homeLocationLabel,
}: FacilityFiltersBarProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  // Dropdown visibility states
  const [showDistanceDropdown, setShowDistanceDropdown] = useState(false);
  const [showFacilityTypeDropdown, setShowFacilityTypeDropdown] = useState(false);
  const [showSurfaceTypeDropdown, setShowSurfaceTypeDropdown] = useState(false);
  const [showCourtTypeDropdown, setShowCourtTypeDropdown] = useState(false);
  const [showLightingDropdown, setShowLightingDropdown] = useState(false);
  const [showMembershipDropdown, setShowMembershipDropdown] = useState(false);

  // =============================================================================
  // LABEL GETTERS
  // =============================================================================

  const getDistanceLabel = useCallback(
    (v: FacilityDistanceFilter) => {
      if (v === 'all') return t('facilitiesTab.filters.distance.all');
      return `${v} km`;
    },
    [t]
  );

  const getFacilityTypeLabel = useCallback(
    (v: 'all' | FacilityTypeFilter) => {
      return t(`facilitiesTab.filters.facilityType.${v}`);
    },
    [t]
  );

  const getSurfaceTypeLabel = useCallback(
    (v: 'all' | SurfaceTypeFilter) => {
      return t(`facilitiesTab.filters.surfaceType.${v}`);
    },
    [t]
  );

  const getCourtTypeLabel = useCallback(
    (v: 'all' | CourtTypeFilter) => {
      return t(`facilitiesTab.filters.courtType.${v}`);
    },
    [t]
  );

  const getLightingLabel = useCallback(
    (v: LightingFilter) => {
      return t(`facilitiesTab.filters.lighting.${v}`);
    },
    [t]
  );

  const getMembershipLabel = useCallback(
    (v: MembershipFilter) => {
      return t(`facilitiesTab.filters.membership.${v}`);
    },
    [t]
  );

  // Icon getters for dropdowns
  const getCourtTypeIcon = useCallback((v: 'all' | CourtTypeFilter) => {
    const icons: Record<'all' | CourtTypeFilter, keyof typeof Ionicons.glyphMap | undefined> = {
      all: undefined,
      indoor: 'home-outline',
      outdoor: 'sunny-outline',
    };
    return icons[v];
  }, []);

  const getLightingIcon = useCallback((v: LightingFilter) => {
    const icons: Record<LightingFilter, keyof typeof Ionicons.glyphMap | undefined> = {
      all: undefined,
      with_lights: 'bulb-outline',
      no_lights: 'moon-outline',
    };
    return icons[v];
  }, []);

  const getMembershipIcon = useCallback((v: MembershipFilter) => {
    const icons: Record<MembershipFilter, keyof typeof Ionicons.glyphMap | undefined> = {
      all: undefined,
      public: 'globe-outline',
      members_only: 'key-outline',
    };
    return icons[v];
  }, []);

  // =============================================================================
  // DISPLAY VALUES
  // =============================================================================

  const distanceDisplay =
    filters.distance === 'all'
      ? t('facilitiesTab.filters.distance.label')
      : `${filters.distance} km`;
  const facilityTypeDisplay =
    filters.facilityType === 'all'
      ? t('facilitiesTab.filters.facilityType.label')
      : getFacilityTypeLabel(filters.facilityType);
  const surfaceTypeDisplay =
    filters.surfaceType === 'all'
      ? t('facilitiesTab.filters.surfaceType.label')
      : getSurfaceTypeLabel(filters.surfaceType);
  const courtTypeDisplay =
    filters.courtType === 'all'
      ? t('facilitiesTab.filters.courtType.label')
      : getCourtTypeLabel(filters.courtType);
  const lightingDisplay =
    filters.lighting === 'all'
      ? t('facilitiesTab.filters.lighting.label')
      : getLightingLabel(filters.lighting);
  const membershipDisplay =
    filters.membership === 'all'
      ? t('facilitiesTab.filters.membership.label')
      : getMembershipLabel(filters.membership);

  // =============================================================================
  // HANDLERS
  // =============================================================================

  const handleDistanceChange = useCallback(
    (value: FacilityDistanceFilter) => {
      onFiltersChange({ ...filters, distance: value });
    },
    [filters, onFiltersChange]
  );

  const handleFacilityTypeChange = useCallback(
    (value: 'all' | FacilityTypeFilter) => {
      onFiltersChange({ ...filters, facilityType: value });
    },
    [filters, onFiltersChange]
  );

  const handleSurfaceTypeChange = useCallback(
    (value: 'all' | SurfaceTypeFilter) => {
      onFiltersChange({ ...filters, surfaceType: value });
    },
    [filters, onFiltersChange]
  );

  const handleCourtTypeChange = useCallback(
    (value: 'all' | CourtTypeFilter) => {
      onFiltersChange({ ...filters, courtType: value });
    },
    [filters, onFiltersChange]
  );

  const handleLightingChange = useCallback(
    (value: LightingFilter) => {
      onFiltersChange({ ...filters, lighting: value });
    },
    [filters, onFiltersChange]
  );

  const handleMembershipChange = useCallback(
    (value: MembershipFilter) => {
      onFiltersChange({ ...filters, membership: value });
    },
    [filters, onFiltersChange]
  );

  const handleReset = useCallback(() => {
    lightHaptic();
    onReset?.();
  }, [onReset]);

  const handleHasAvailabilitiesToggle = useCallback(() => {
    onFiltersChange({ ...filters, hasAvailabilities: !filters.hasAvailabilities });
  }, [filters, onFiltersChange]);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Location Selector - if both GPS and home are available */}
        {showLocationSelector && hasHomeLocation && onLocationModeChange && locationMode && (
          <View style={styles.locationSelectorWrapper}>
            <LocationSelector
              selectedMode={locationMode}
              onSelectMode={onLocationModeChange}
              hasHomeLocation={hasHomeLocation}
              homeLocationLabel={homeLocationLabel}
              isDark={isDark}
              t={t as (key: string) => string}
            />
          </View>
        )}

        {/* Distance Filter */}
        <FilterChip
          value={distanceDisplay}
          isActive={filters.distance !== 'all'}
          onPress={() => setShowDistanceDropdown(true)}
          isDark={isDark}
          icon={filters.distance !== 'all' ? 'navigate-outline' : undefined}
        />

        {/* Has Availabilities Toggle (bookable facilities) */}
        <FilterChip
          value={t('facilitiesTab.filters.hasAvailabilities.label')}
          isActive={filters.hasAvailabilities}
          onPress={handleHasAvailabilitiesToggle}
          isDark={isDark}
          hasDropdown={false}
          icon="calendar-outline"
        />

        {/* Court Type Filter */}
        <FilterChip
          value={courtTypeDisplay}
          isActive={filters.courtType !== 'all'}
          onPress={() => setShowCourtTypeDropdown(true)}
          isDark={isDark}
          icon={getCourtTypeIcon(filters.courtType)}
        />

        {/* Surface Type Filter */}
        <FilterChip
          value={surfaceTypeDisplay}
          isActive={filters.surfaceType !== 'all'}
          onPress={() => setShowSurfaceTypeDropdown(true)}
          isDark={isDark}
        />

        {/* Facility Type Filter */}
        <FilterChip
          value={facilityTypeDisplay}
          isActive={filters.facilityType !== 'all'}
          onPress={() => setShowFacilityTypeDropdown(true)}
          isDark={isDark}
          icon={filters.facilityType !== 'all' ? 'business-outline' : undefined}
        />

        {/* Lighting Filter */}
        <FilterChip
          value={lightingDisplay}
          isActive={filters.lighting !== 'all'}
          onPress={() => setShowLightingDropdown(true)}
          isDark={isDark}
          icon={getLightingIcon(filters.lighting)}
        />

        {/* Membership Filter */}
        <FilterChip
          value={membershipDisplay}
          isActive={filters.membership !== 'all'}
          onPress={() => setShowMembershipDropdown(true)}
          isDark={isDark}
          icon={getMembershipIcon(filters.membership)}
        />

        {/* Reset Button */}
        {hasActiveFilters && onReset && (
          <TouchableOpacity
            style={[
              styles.resetChip,
              {
                backgroundColor: isDark ? secondary[900] + '40' : secondary[50],
                borderColor: isDark ? secondary[700] : secondary[200],
              },
            ]}
            onPress={handleReset}
            activeOpacity={0.85}
          >
            <Ionicons
              name="close-circle"
              size={14}
              color={isDark ? secondary[400] : secondary[600]}
            />
            <Text size="xs" weight="semibold" color={isDark ? secondary[400] : secondary[600]}>
              {t('facilitiesTab.filters.reset')}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* =================================================================== */}
      {/* DROPDOWN MODALS */}
      {/* =================================================================== */}

      {/* Distance Dropdown */}
      <FilterDropdown
        visible={showDistanceDropdown}
        title={t('facilitiesTab.filters.distance.label')}
        options={DISTANCE_OPTIONS}
        selectedValue={filters.distance}
        onSelect={handleDistanceChange}
        onClose={() => setShowDistanceDropdown(false)}
        isDark={isDark}
        getLabel={getDistanceLabel}
      />

      {/* Facility Type Dropdown */}
      <FilterDropdown
        visible={showFacilityTypeDropdown}
        title={t('facilitiesTab.filters.facilityType.label')}
        options={FACILITY_TYPES}
        selectedValue={filters.facilityType}
        onSelect={handleFacilityTypeChange}
        onClose={() => setShowFacilityTypeDropdown(false)}
        isDark={isDark}
        getLabel={getFacilityTypeLabel}
      />

      {/* Surface Type Dropdown */}
      <FilterDropdown
        visible={showSurfaceTypeDropdown}
        title={t('facilitiesTab.filters.surfaceType.label')}
        options={SURFACE_TYPES}
        selectedValue={filters.surfaceType}
        onSelect={handleSurfaceTypeChange}
        onClose={() => setShowSurfaceTypeDropdown(false)}
        isDark={isDark}
        getLabel={getSurfaceTypeLabel}
      />

      {/* Court Type Dropdown */}
      <FilterDropdown
        visible={showCourtTypeDropdown}
        title={t('facilitiesTab.filters.courtType.label')}
        options={COURT_TYPES}
        selectedValue={filters.courtType}
        onSelect={handleCourtTypeChange}
        onClose={() => setShowCourtTypeDropdown(false)}
        isDark={isDark}
        getLabel={getCourtTypeLabel}
        getIcon={getCourtTypeIcon}
      />

      {/* Lighting Dropdown */}
      <FilterDropdown
        visible={showLightingDropdown}
        title={t('facilitiesTab.filters.lighting.label')}
        options={LIGHTING_OPTIONS}
        selectedValue={filters.lighting}
        onSelect={handleLightingChange}
        onClose={() => setShowLightingDropdown(false)}
        isDark={isDark}
        getLabel={getLightingLabel}
        getIcon={getLightingIcon}
      />

      {/* Membership Dropdown */}
      <FilterDropdown
        visible={showMembershipDropdown}
        title={t('facilitiesTab.filters.membership.label')}
        options={MEMBERSHIP_OPTIONS}
        selectedValue={filters.membership}
        onSelect={handleMembershipChange}
        onClose={() => setShowMembershipDropdown(false)}
        isDark={isDark}
        getLabel={getMembershipLabel}
        getIcon={getMembershipIcon}
      />
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacingPixels[2],
  },
  scrollContent: {
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
    alignItems: 'center',
  },
  locationSelectorWrapper: {
    marginRight: spacingPixels[1],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  chipIcon: {
    marginRight: 2,
  },
  chipChevron: {
    marginLeft: 2,
  },
  resetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[2],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  dropdownContainer: {
    width: '80%',
    maxWidth: 320,
    maxHeight: '60%',
    borderRadius: radiusPixels.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: 1,
  },
  dropdownScrollView: {
    maxHeight: 300,
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropdownItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownItemIcon: {
    marginRight: spacingPixels[2],
  },
});
