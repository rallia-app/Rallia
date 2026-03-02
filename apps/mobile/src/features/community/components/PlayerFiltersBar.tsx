/**
 * PlayerFiltersBar Component
 * A horizontally scrollable row of filter chips for player filtering.
 * Follows the same pattern as SportSelector with compact toggle chips and dropdown modals.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Modal, Animated } from 'react-native';
import { Text, LocationSelector, type LocationMode } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import { useTranslation, type TranslationKey } from '../../../hooks';
import {
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  secondary,
  duration,
  lightTheme,
  darkTheme,
} from '@rallia/design-system';
import { Ionicons } from '@expo/vector-icons';
import { lightHaptic, selectionHaptic } from '../../../utils/haptics';

// =============================================================================
// TYPES
// =============================================================================

export type GenderFilter = 'all' | 'male' | 'female' | 'other';
export type AvailabilityFilter = 'all' | 'morning' | 'afternoon' | 'evening';
export type DayFilter = 'all' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export type PlayStyleFilter =
  | 'all'
  | 'counterpuncher'
  | 'aggressive_baseliner'
  | 'serve_and_volley'
  | 'all_court';

// NTRP values for Tennis (1.0 to 7.0 in 0.5 increments)
export type NtrpFilter =
  | 'all'
  | '1.0'
  | '1.5'
  | '2.0'
  | '2.5'
  | '3.0'
  | '3.5'
  | '4.0'
  | '4.5'
  | '5.0'
  | '5.5'
  | '6.0'
  | '6.5'
  | '7.0';

// DUPR values for Pickleball (2.0 to 8.0 in 0.5 increments)
export type DuprFilter =
  | 'all'
  | '2.0'
  | '2.5'
  | '3.0'
  | '3.5'
  | '4.0'
  | '4.5'
  | '5.0'
  | '5.5'
  | '6.0'
  | '6.5'
  | '7.0'
  | '7.5'
  | '8.0';

// Distance in km (5km increments up to 50km)
export type DistanceFilter = 'all' | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50;

// Sort options
export type SortOption =
  | 'name_asc'
  | 'name_desc'
  | 'rating_high'
  | 'rating_low'
  | 'distance'
  | 'recently_active';

export interface PlayerFilters {
  favorites: boolean;
  blocked: boolean;
  gender: GenderFilter;
  skillLevel: NtrpFilter | DuprFilter;
  maxDistance: DistanceFilter;
  availability: AvailabilityFilter;
  day: DayFilter;
  playStyle: PlayStyleFilter;
  sortBy: SortOption;
}

export const DEFAULT_PLAYER_FILTERS: PlayerFilters = {
  favorites: false,
  blocked: false,
  gender: 'all',
  skillLevel: 'all',
  maxDistance: 'all',
  availability: 'all',
  day: 'all',
  playStyle: 'all',
  sortBy: 'name_asc',
};

// =============================================================================
// FILTER OPTIONS
// =============================================================================

const GENDER_OPTIONS: GenderFilter[] = ['all', 'male', 'female', 'other'];
const AVAILABILITY_OPTIONS: AvailabilityFilter[] = ['all', 'morning', 'afternoon', 'evening'];
const DAY_OPTIONS: DayFilter[] = ['all', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const PLAY_STYLE_OPTIONS: PlayStyleFilter[] = [
  'all',
  'counterpuncher',
  'aggressive_baseliner',
  'serve_and_volley',
  'all_court',
];
const NTRP_OPTIONS: NtrpFilter[] = [
  'all',
  '1.0',
  '1.5',
  '2.0',
  '2.5',
  '3.0',
  '3.5',
  '4.0',
  '4.5',
  '5.0',
  '5.5',
  '6.0',
  '6.5',
  '7.0',
];
const DUPR_OPTIONS: DuprFilter[] = [
  'all',
  '2.0',
  '2.5',
  '3.0',
  '3.5',
  '4.0',
  '4.5',
  '5.0',
  '5.5',
  '6.0',
  '6.5',
  '7.0',
  '7.5',
  '8.0',
];
const DISTANCE_OPTIONS: DistanceFilter[] = ['all', 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const SORT_OPTIONS: SortOption[] = [
  'name_asc',
  'name_desc',
  'rating_high',
  'rating_low',
  'distance',
  'recently_active',
];

// Label key mappings for translation
const SORT_LABEL_KEYS: Record<SortOption, TranslationKey> = {
  name_asc: 'playerDirectory.filters.sortNameAsc',
  name_desc: 'playerDirectory.filters.sortNameDesc',
  rating_high: 'playerDirectory.filters.sortRatingHigh',
  rating_low: 'playerDirectory.filters.sortRatingLow',
  distance: 'playerDirectory.filters.sortDistanceNearest',
  recently_active: 'playerDirectory.filters.sortRecentlyActive',
};

const GENDER_LABEL_KEYS: Record<GenderFilter, TranslationKey> = {
  all: 'playerDirectory.filters.genderAll',
  male: 'playerDirectory.filters.genderMen',
  female: 'playerDirectory.filters.genderWomen',
  other: 'playerDirectory.filters.genderOther',
};

const AVAILABILITY_LABEL_KEYS: Record<AvailabilityFilter, TranslationKey> = {
  all: 'playerDirectory.filters.availabilityAll',
  morning: 'playerDirectory.filters.availabilityMorning',
  afternoon: 'playerDirectory.filters.availabilityAfternoon',
  evening: 'playerDirectory.filters.availabilityEvening',
};

const DAY_LABEL_KEYS: Record<DayFilter, string> = {
  all: 'playerDirectory.filters.dayAll',
  monday: 'playerDirectory.filters.dayMonday',
  tuesday: 'playerDirectory.filters.dayTuesday',
  wednesday: 'playerDirectory.filters.dayWednesday',
  thursday: 'playerDirectory.filters.dayThursday',
  friday: 'playerDirectory.filters.dayFriday',
  saturday: 'playerDirectory.filters.daySaturday',
  sunday: 'playerDirectory.filters.daySunday',
};

const PLAY_STYLE_LABEL_KEYS: Record<PlayStyleFilter, TranslationKey> = {
  all: 'playerDirectory.filters.playStyleAll',
  counterpuncher: 'playerDirectory.filters.playStyleCounterpuncher',
  aggressive_baseliner: 'playerDirectory.filters.playStyleAggressive',
  serve_and_volley: 'playerDirectory.filters.playStyleServeAndVolley',
  all_court: 'playerDirectory.filters.playStyleAllCourt',
};

// =============================================================================
// FILTER CHIP COMPONENT (SportSelector style)
// =============================================================================

interface FilterChipProps {
  label: string;
  value: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
  hasDropdown?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

function FilterChip({
  label,
  value,
  isActive,
  onPress,
  isDark,
  hasDropdown = true,
  icon,
}: FilterChipProps) {
  // Animation value - using useMemo for stable instance
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
          {value === 'all' ? label : value}
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
// DROPDOWN MODAL COMPONENT (SportSelector style)
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
}: FilterDropdownProps<T>) {
  // Animation values - using useMemo for stable instances
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
          duration: duration.fast,
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
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
            bounces={options.length > 6}
          >
            {options.map((option, index) => {
              const isSelected = selectedValue === option;
              const isLast = index === options.length - 1;

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
                  <Text
                    size="base"
                    weight={isSelected ? 'semibold' : 'regular'}
                    color={isSelected ? colors.itemTextSelected : colors.itemText}
                  >
                    {getLabel(option)}
                  </Text>
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

interface PlayerFiltersBarProps {
  filters: PlayerFilters;
  sportName?: string; // 'Tennis' or 'Pickleball' to determine rating system
  maxTravelDistance?: number; // User's max travel distance preference (from onboarding)
  onFiltersChange: (filters: PlayerFilters) => void;
  onReset?: () => void;
  isAuthenticated?: boolean; // Whether the user is signed in (hides favorites/blocked filters for guests)
  showLocationSelector?: boolean;
  locationMode?: LocationMode;
  onLocationModeChange?: (mode: LocationMode) => void;
  hasHomeLocation?: boolean;
  homeLocationLabel?: string;
}

export function PlayerFiltersBar({
  filters,
  sportName = 'Tennis',
  onFiltersChange,
  onReset,
  isAuthenticated = false,
  showLocationSelector,
  locationMode,
  onLocationModeChange,
  hasHomeLocation,
  homeLocationLabel,
}: PlayerFiltersBarProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  // Dropdown visibility states
  const [showGenderDropdown, setShowGenderDropdown] = useState(false);
  const [showSkillDropdown, setShowSkillDropdown] = useState(false);
  const [showDistanceDropdown, setShowDistanceDropdown] = useState(false);
  const [showAvailabilityDropdown, setShowAvailabilityDropdown] = useState(false);
  const [showDayDropdown, setShowDayDropdown] = useState(false);
  const [showStyleDropdown, setShowStyleDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // Determine which skill options to use based on sport
  const isTennis = sportName?.toLowerCase().includes('tennis');
  const skillOptions = isTennis ? NTRP_OPTIONS : DUPR_OPTIONS;
  const skillLabel = isTennis ? 'NTRP' : 'DUPR';

  // Distance options - show all options (5km to 50km in 5km increments)
  // Users can filter to see players willing to travel at least X km
  const availableDistanceOptions = DISTANCE_OPTIONS;

  // Check if any filter is active (excluding default sort)
  const hasActiveFilters = useMemo(() => {
    return (
      filters.favorites ||
      filters.blocked ||
      filters.gender !== 'all' ||
      filters.skillLevel !== 'all' ||
      filters.maxDistance !== 'all' ||
      filters.availability !== 'all' ||
      filters.day !== 'all' ||
      filters.playStyle !== 'all' ||
      (filters.sortBy && filters.sortBy !== 'name_asc')
    );
  }, [filters]);

  // Handlers
  const handleFavoritesToggle = useCallback(() => {
    selectionHaptic();
    // Turn off blocked filter when enabling favorites
    onFiltersChange({
      ...filters,
      favorites: !filters.favorites,
      blocked: filters.favorites ? filters.blocked : false,
    });
  }, [filters, onFiltersChange]);

  const handleBlockedToggle = useCallback(() => {
    selectionHaptic();
    // Turn off favorites filter when enabling blocked
    onFiltersChange({
      ...filters,
      blocked: !filters.blocked,
      favorites: filters.blocked ? filters.favorites : false,
    });
  }, [filters, onFiltersChange]);

  const handleGenderChange = useCallback(
    (value: GenderFilter) => {
      onFiltersChange({ ...filters, gender: value });
    },
    [filters, onFiltersChange]
  );

  const handleSkillChange = useCallback(
    (value: NtrpFilter | DuprFilter) => {
      onFiltersChange({ ...filters, skillLevel: value });
    },
    [filters, onFiltersChange]
  );

  const handleDistanceChange = useCallback(
    (value: DistanceFilter) => {
      onFiltersChange({ ...filters, maxDistance: value });
    },
    [filters, onFiltersChange]
  );

  const handleAvailabilityChange = useCallback(
    (value: AvailabilityFilter) => {
      onFiltersChange({ ...filters, availability: value });
    },
    [filters, onFiltersChange]
  );

  const handleDayChange = useCallback(
    (value: DayFilter) => {
      onFiltersChange({ ...filters, day: value });
    },
    [filters, onFiltersChange]
  );

  const handleStyleChange = useCallback(
    (value: PlayStyleFilter) => {
      onFiltersChange({ ...filters, playStyle: value });
    },
    [filters, onFiltersChange]
  );

  const handleSortChange = useCallback(
    (value: SortOption) => {
      onFiltersChange({ ...filters, sortBy: value });
    },
    [filters, onFiltersChange]
  );

  const handleReset = useCallback(() => {
    lightHaptic();
    onReset?.();
  }, [onReset]);

  // Label getters using translations
  const getGenderLabel = useCallback((v: GenderFilter) => t(GENDER_LABEL_KEYS[v]), [t]);
  const getSkillLabel = useCallback(
    (v: string) => (v === 'all' ? t('playerDirectory.filters.genderAll') : `${v}+`),
    [t]
  );
  const getDistanceLabel = useCallback(
    (v: DistanceFilter) => (v === 'all' ? t('playerDirectory.filters.distanceAll') : `${v} km`),
    [t]
  );
  const getAvailabilityLabel = useCallback(
    (v: AvailabilityFilter) => t(AVAILABILITY_LABEL_KEYS[v]),
    [t]
  );
  const getDayLabel = useCallback((v: DayFilter) => t(DAY_LABEL_KEYS[v] as any), [t]);
  const getStyleLabel = useCallback((v: PlayStyleFilter) => t(PLAY_STYLE_LABEL_KEYS[v]), [t]);
  const getSortLabel = useCallback((v: SortOption) => t(SORT_LABEL_KEYS[v]), [t]);

  // Display values for chips
  const genderDisplay =
    filters.gender === 'all'
      ? t('playerDirectory.filters.gender')
      : t(GENDER_LABEL_KEYS[filters.gender]);
  const skillDisplay = filters.skillLevel === 'all' ? skillLabel : `${filters.skillLevel}+`;
  const distanceDisplay =
    filters.maxDistance === 'all'
      ? t('playerDirectory.filters.distance')
      : `${filters.maxDistance} km`;
  const availabilityDisplay =
    filters.availability === 'all'
      ? t('playerDirectory.filters.availability')
      : t(AVAILABILITY_LABEL_KEYS[filters.availability]);
  const dayDisplay =
    filters.day === 'all'
      ? t('playerDirectory.filters.day' as any)
      : t(DAY_LABEL_KEYS[filters.day] as any);
  const styleDisplay =
    filters.playStyle === 'all'
      ? t('playerDirectory.filters.playStyle')
      : t(PLAY_STYLE_LABEL_KEYS[filters.playStyle]);
  const sortDisplay = t(SORT_LABEL_KEYS[filters.sortBy || 'name_asc']);

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

        {/* Favorites Toggle - Only show for authenticated users */}
        {isAuthenticated && (
          <FilterChip
            label={t('playerDirectory.filters.favorites')}
            value={t('playerDirectory.filters.favorites')}
            isActive={filters.favorites}
            onPress={handleFavoritesToggle}
            isDark={isDark}
            hasDropdown={false}
            icon={filters.favorites ? 'heart' : 'heart-outline'}
          />
        )}

        {/* Gender Filter */}
        <FilterChip
          label={t('playerDirectory.filters.gender')}
          value={genderDisplay}
          isActive={filters.gender !== 'all'}
          onPress={() => setShowGenderDropdown(true)}
          isDark={isDark}
        />

        {/* Skill Level Filter (NTRP/DUPR) */}
        <FilterChip
          label={skillLabel}
          value={skillDisplay}
          isActive={filters.skillLevel !== 'all'}
          onPress={() => setShowSkillDropdown(true)}
          isDark={isDark}
        />

        {/* Distance Filter */}
        <FilterChip
          label={t('playerDirectory.filters.distance')}
          value={distanceDisplay}
          isActive={filters.maxDistance !== 'all'}
          onPress={() => setShowDistanceDropdown(true)}
          isDark={isDark}
        />

        {/* Availability Filter */}
        <FilterChip
          label={t('playerDirectory.filters.availability')}
          value={availabilityDisplay}
          isActive={filters.availability !== 'all'}
          onPress={() => setShowAvailabilityDropdown(true)}
          isDark={isDark}
          icon={
            filters.availability === 'morning'
              ? 'sunny-outline'
              : filters.availability === 'afternoon'
                ? 'partly-sunny-outline'
                : filters.availability === 'evening'
                  ? 'moon-outline'
                  : undefined
          }
        />

        {/* Day Filter */}
        <FilterChip
          label={t('playerDirectory.filters.day' as any)}
          value={dayDisplay}
          isActive={filters.day !== 'all'}
          onPress={() => setShowDayDropdown(true)}
          isDark={isDark}
          icon="calendar-outline"
        />

        {/* Play Style Filter */}
        <FilterChip
          label={t('playerDirectory.filters.playStyle')}
          value={styleDisplay}
          isActive={filters.playStyle !== 'all'}
          onPress={() => setShowStyleDropdown(true)}
          isDark={isDark}
        />

        {/* Blocked Toggle - Only show for authenticated users */}
        {isAuthenticated && (
          <FilterChip
            label={t('playerDirectory.filters.blocked')}
            value={t('playerDirectory.filters.blocked')}
            isActive={filters.blocked}
            onPress={handleBlockedToggle}
            isDark={isDark}
            hasDropdown={false}
            icon={filters.blocked ? 'ban' : 'ban-outline'}
          />
        )}

        {/* Sort Option */}
        <FilterChip
          label={t('playerDirectory.filters.sortBy')}
          value={sortDisplay}
          isActive={filters.sortBy !== 'name_asc'}
          onPress={() => setShowSortDropdown(true)}
          isDark={isDark}
          icon="swap-vertical-outline"
        />

        {/* Reset Button - only show when filters are active */}
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
              {t('playerDirectory.filters.reset')}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Dropdown Modals */}
      <FilterDropdown
        visible={showGenderDropdown}
        title={t('playerDirectory.filters.selectGender')}
        options={GENDER_OPTIONS}
        selectedValue={filters.gender}
        onSelect={handleGenderChange}
        onClose={() => setShowGenderDropdown(false)}
        isDark={isDark}
        getLabel={getGenderLabel}
      />

      <FilterDropdown
        visible={showSkillDropdown}
        title={t('playerDirectory.filters.selectSkillLevel')}
        options={skillOptions as (NtrpFilter | DuprFilter)[]}
        selectedValue={filters.skillLevel}
        onSelect={handleSkillChange}
        onClose={() => setShowSkillDropdown(false)}
        isDark={isDark}
        getLabel={getSkillLabel}
      />

      <FilterDropdown
        visible={showDistanceDropdown}
        title={t('playerDirectory.filters.selectMaxDistance')}
        options={availableDistanceOptions}
        selectedValue={filters.maxDistance}
        onSelect={handleDistanceChange}
        onClose={() => setShowDistanceDropdown(false)}
        isDark={isDark}
        getLabel={getDistanceLabel}
      />

      <FilterDropdown
        visible={showAvailabilityDropdown}
        title={t('playerDirectory.filters.selectAvailability')}
        options={AVAILABILITY_OPTIONS}
        selectedValue={filters.availability}
        onSelect={handleAvailabilityChange}
        onClose={() => setShowAvailabilityDropdown(false)}
        isDark={isDark}
        getLabel={getAvailabilityLabel}
      />

      <FilterDropdown
        visible={showDayDropdown}
        title={t('playerDirectory.filters.selectDay' as any)}
        options={DAY_OPTIONS}
        selectedValue={filters.day}
        onSelect={handleDayChange}
        onClose={() => setShowDayDropdown(false)}
        isDark={isDark}
        getLabel={getDayLabel}
      />

      <FilterDropdown
        visible={showStyleDropdown}
        title={t('playerDirectory.filters.selectPlayStyle')}
        options={PLAY_STYLE_OPTIONS}
        selectedValue={filters.playStyle}
        onSelect={handleStyleChange}
        onClose={() => setShowStyleDropdown(false)}
        isDark={isDark}
        getLabel={getStyleLabel}
      />

      <FilterDropdown
        visible={showSortDropdown}
        title={t('playerDirectory.filters.sortPlayersBy')}
        options={SORT_OPTIONS}
        selectedValue={filters.sortBy || 'name_asc'}
        onSelect={handleSortChange}
        onClose={() => setShowSortDropdown(false)}
        isDark={isDark}
        getLabel={getSortLabel}
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
  scrollView: {
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
});

export default PlayerFiltersBar;
