/**
 * PlayerFiltersBar Component
 * A horizontally scrollable row of filter chips for player filtering.
 * Follows the same pattern as MatchFiltersBar with compact toggle chips and dropdown modals.
 */

import React, { useState, useCallback, useMemo, useEffect, memo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Modal, Animated } from 'react-native';
import { Text, LocationSelector, type LocationMode } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import type { RatingScoreOption } from '@rallia/shared-hooks';
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
// 6-block macro filter: 'am' covers early/morning/midday, 'pm' covers
// afternoon/evening/late. Granular 6-value filter is a follow-up — the
// current dropdown stays at 3 options to keep the chip density unchanged.
export type AvailabilityFilter = 'all' | 'am' | 'pm';
export type DayFilter =
  | 'all'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';
export type PlayStyleFilter =
  | 'all'
  | 'counterpuncher'
  | 'aggressive_baseliner'
  | 'serve_and_volley'
  | 'all_court';

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

// Reputation filter
export type ReputationFilter = 'all' | 'bronze' | 'silver' | 'gold' | 'platinum';

export interface PlayerFilters {
  favorites: boolean;
  blocked: boolean;
  gender: GenderFilter;
  rating: string[]; // rating score IDs (multi-select)
  reputation: ReputationFilter;
  certifiedOnly: boolean;
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
  rating: [],
  reputation: 'all',
  certifiedOnly: false,
  maxDistance: 'all',
  availability: 'all',
  day: 'all',
  playStyle: 'all',
  sortBy: 'distance',
};

// =============================================================================
// FILTER OPTIONS
// =============================================================================

const GENDER_OPTIONS: GenderFilter[] = ['all', 'male', 'female', 'other'];
const AVAILABILITY_OPTIONS: AvailabilityFilter[] = ['all', 'am', 'pm'];
const DAY_OPTIONS: DayFilter[] = [
  'all',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
const PLAY_STYLE_OPTIONS: PlayStyleFilter[] = [
  'all',
  'counterpuncher',
  'aggressive_baseliner',
  'serve_and_volley',
  'all_court',
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
const REPUTATION_OPTIONS: ReputationFilter[] = ['all', 'bronze', 'silver', 'gold', 'platinum'];

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
  am: 'playerDirectory.filters.availabilityAm',
  pm: 'playerDirectory.filters.availabilityPm',
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
// FILTER CHIP COMPONENT (text-only, no icons)
// =============================================================================

interface FilterChipProps {
  label: string;
  value: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
  hasDropdown?: boolean;
}

function FilterChip({
  label,
  value,
  isActive,
  onPress,
  isDark,
  hasDropdown = true,
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
// DROPDOWN MODAL COMPONENT (with optional icon support for dropdown rows)
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
// MULTI-SELECT FILTER DROPDOWN COMPONENT
// =============================================================================

interface MultiSelectFilterDropdownProps {
  visible: boolean;
  title: string;
  options: { id: string; label: string; sublabel?: string }[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
  isDark: boolean;
}

function MultiSelectFilterDropdown({
  visible,
  title,
  options,
  selectedIds,
  onToggle,
  onClearAll,
  onClose,
  isDark,
}: MultiSelectFilterDropdownProps) {
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

  const handleToggle = (id: string) => {
    selectionHaptic();
    onToggle(id);
  };

  const hasSelection = selectedIds.length > 0;

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
            <View style={styles.multiSelectHeaderActions}>
              {hasSelection && (
                <TouchableOpacity
                  onPress={() => {
                    lightHaptic();
                    onClearAll();
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.multiSelectClearButton}
                >
                  <Text size="sm" color={primary[500]}>
                    Clear
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close-outline" size={22} color={themeColors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Options list */}
          <ScrollView
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
            bounces={options.length > 6}
          >
            {options.map((option, index) => {
              const isSelected = selectedIds.includes(option.id);
              const isLast = index === options.length - 1;

              return (
                <TouchableOpacity
                  key={option.id}
                  style={[
                    styles.dropdownItem,
                    {
                      backgroundColor: isSelected ? colors.itemBgSelected : colors.itemBg,
                      borderBottomColor: isLast ? 'transparent' : colors.itemBorder,
                    },
                  ]}
                  onPress={() => handleToggle(option.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.dropdownItemContent}>
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={isSelected ? colors.checkmark : themeColors.mutedForeground}
                      style={styles.dropdownItemIcon}
                    />
                    <View>
                      <Text
                        size="base"
                        weight={isSelected ? 'semibold' : 'regular'}
                        color={isSelected ? colors.itemTextSelected : colors.itemText}
                      >
                        {option.label}
                      </Text>
                      {option.sublabel && (
                        <Text size="xs" color={themeColors.mutedForeground}>
                          {option.sublabel}
                        </Text>
                      )}
                    </View>
                  </View>
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
  sportName?: string;
  maxTravelDistance?: number;
  onFiltersChange: (filters: PlayerFilters) => void;
  onReset?: () => void;
  isAuthenticated?: boolean;
  showLocationSelector?: boolean;
  locationMode?: LocationMode;
  onLocationModeChange?: (mode: LocationMode) => void;
  hasHomeLocation?: boolean;
  homeLocationLabel?: string;
  ratingOptions?: RatingScoreOption[];
}

export const PlayerFiltersBar = memo(function PlayerFiltersBar({
  filters,
  onFiltersChange,
  onReset,
  isAuthenticated = false,
  showLocationSelector,
  locationMode,
  onLocationModeChange,
  hasHomeLocation,
  homeLocationLabel,
  ratingOptions = [],
}: PlayerFiltersBarProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  // Dropdown visibility states
  const [showGenderDropdown, setShowGenderDropdown] = useState(false);
  const [showDistanceDropdown, setShowDistanceDropdown] = useState(false);
  const [showAvailabilityDropdown, setShowAvailabilityDropdown] = useState(false);
  const [showDayDropdown, setShowDayDropdown] = useState(false);
  const [showStyleDropdown, setShowStyleDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showRatingDropdown, setShowRatingDropdown] = useState(false);
  const [showReputationDropdown, setShowReputationDropdown] = useState(false);

  // Check if any filter is active (excluding default sort)
  const hasActiveFilters = useMemo(() => {
    return (
      filters.favorites ||
      filters.blocked ||
      filters.gender !== 'all' ||
      filters.rating.length > 0 ||
      filters.reputation !== 'all' ||
      filters.certifiedOnly ||
      filters.maxDistance !== 'all' ||
      filters.availability !== 'all' ||
      filters.day !== 'all' ||
      filters.playStyle !== 'all' ||
      (filters.sortBy && filters.sortBy !== 'distance')
    );
  }, [filters]);

  // Handlers
  const handleFavoritesToggle = useCallback(() => {
    selectionHaptic();
    onFiltersChange({
      ...filters,
      favorites: !filters.favorites,
      blocked: filters.favorites ? filters.blocked : false,
    });
  }, [filters, onFiltersChange]);

  const handleBlockedToggle = useCallback(() => {
    selectionHaptic();
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

  const handleReputationChange = useCallback(
    (value: ReputationFilter) => {
      onFiltersChange({ ...filters, reputation: value });
    },
    [filters, onFiltersChange]
  );

  const handleRatingToggle = useCallback(
    (id: string) => {
      const newRating = filters.rating.includes(id)
        ? filters.rating.filter(r => r !== id)
        : [...filters.rating, id];
      onFiltersChange({ ...filters, rating: newRating });
    },
    [filters, onFiltersChange]
  );

  const handleRatingClearAll = useCallback(() => {
    onFiltersChange({ ...filters, rating: [] });
  }, [filters, onFiltersChange]);

  const handleCertifiedToggle = useCallback(() => {
    selectionHaptic();
    onFiltersChange({ ...filters, certifiedOnly: !filters.certifiedOnly });
  }, [filters, onFiltersChange]);

  const handleReset = useCallback(() => {
    lightHaptic();
    onReset?.();
  }, [onReset]);

  // Label getters using translations
  const getGenderLabel = useCallback((v: GenderFilter) => t(GENDER_LABEL_KEYS[v]), [t]);
  const getDistanceLabel = useCallback(
    (v: DistanceFilter) => (v === 'all' ? t('playerDirectory.filters.distanceAll') : `< ${v} km`),
    [t]
  );
  const getAvailabilityLabel = useCallback(
    (v: AvailabilityFilter) => t(AVAILABILITY_LABEL_KEYS[v]),
    [t]
  );
  const getDayLabel = useCallback((v: DayFilter) => t(DAY_LABEL_KEYS[v] as TranslationKey), [t]);
  const getStyleLabel = useCallback((v: PlayStyleFilter) => t(PLAY_STYLE_LABEL_KEYS[v]), [t]);
  const getSortLabel = useCallback((v: SortOption) => t(SORT_LABEL_KEYS[v]), [t]);
  const getReputationLabel = useCallback(
    (v: ReputationFilter) => t(`playerDirectory.filters.reputation.${v}` as TranslationKey),
    [t]
  );
  const getReputationIcon = useCallback((v: ReputationFilter) => {
    const icons: Record<ReputationFilter, keyof typeof Ionicons.glyphMap | undefined> = {
      all: undefined,
      bronze: 'shield-outline',
      silver: 'shield-outline',
      gold: 'shield',
      platinum: 'ribbon',
    };
    return icons[v];
  }, []);

  // Build rating dropdown options for multi-select
  const ratingDropdownOptions = useMemo(
    () =>
      ratingOptions.map(r => ({
        id: r.id,
        label: r.label,
        sublabel: r.skillLevel
          ? r.skillLevel.charAt(0).toUpperCase() + r.skillLevel.slice(1)
          : undefined,
      })),
    [ratingOptions]
  );

  // Display values for chips
  const genderDisplay =
    filters.gender === 'all'
      ? t('playerDirectory.filters.gender')
      : t(GENDER_LABEL_KEYS[filters.gender]);
  const distanceDisplay =
    filters.maxDistance === 'all'
      ? t('playerDirectory.filters.distance')
      : `< ${filters.maxDistance} km`;
  const availabilityDisplay =
    filters.availability === 'all'
      ? t('playerDirectory.filters.availability')
      : t(AVAILABILITY_LABEL_KEYS[filters.availability]);
  const dayDisplay =
    filters.day === 'all'
      ? t('playerDirectory.filters.day' as TranslationKey)
      : t(DAY_LABEL_KEYS[filters.day] as TranslationKey);
  const styleDisplay =
    filters.playStyle === 'all'
      ? t('playerDirectory.filters.playStyle')
      : t(PLAY_STYLE_LABEL_KEYS[filters.playStyle]);
  const sortDisplay = t(SORT_LABEL_KEYS[filters.sortBy || 'distance']);
  const reputationDisplay =
    filters.reputation === 'all'
      ? t('playerDirectory.filters.reputation.label' as TranslationKey)
      : t(`playerDirectory.filters.reputation.${filters.reputation}` as TranslationKey);
  const ratingDisplay = useMemo(() => {
    if (filters.rating.length === 0)
      return t('playerDirectory.filters.rating.label' as TranslationKey);
    if (filters.rating.length === 1) {
      const selected = ratingOptions.find(r => r.id === filters.rating[0]);
      return selected?.label ?? t('playerDirectory.filters.rating.label' as TranslationKey);
    }
    return t('playerDirectory.filters.rating.countActive' as TranslationKey, {
      count: filters.rating.length,
    });
  }, [filters.rating, ratingOptions, t]);

  // Define all filter chips configuration (no icons on chips)
  type FilterChipConfig = {
    key: string;
    label: string;
    value: string;
    isActive: boolean;
    onPress: () => void;
    hasDropdown?: boolean;
    show: boolean;
  };

  const filterChipConfigs: FilterChipConfig[] = useMemo(
    () => [
      // Favorites Toggle
      {
        key: 'favorites',
        label: t('playerDirectory.filters.favorites'),
        value: t('playerDirectory.filters.favorites'),
        isActive: filters.favorites,
        onPress: handleFavoritesToggle,
        hasDropdown: false,
        show: isAuthenticated,
      },
      // Rating Filter (multi-select)
      {
        key: 'rating',
        label: t('playerDirectory.filters.rating.label' as TranslationKey),
        value: ratingDisplay,
        isActive: filters.rating.length > 0,
        onPress: () => setShowRatingDropdown(true),
        show: true,
      },
      // Certified Toggle
      {
        key: 'certified',
        label: t('playerDirectory.filters.certified' as TranslationKey),
        value: t('playerDirectory.filters.certified' as TranslationKey),
        isActive: filters.certifiedOnly,
        onPress: handleCertifiedToggle,
        hasDropdown: false,
        show: true,
      },
      // Distance Filter
      {
        key: 'distance',
        label: t('playerDirectory.filters.distance'),
        value: distanceDisplay,
        isActive: filters.maxDistance !== 'all',
        onPress: () => setShowDistanceDropdown(true),
        show: true,
      },
      // Gender Filter
      {
        key: 'gender',
        label: t('playerDirectory.filters.gender'),
        value: genderDisplay,
        isActive: filters.gender !== 'all',
        onPress: () => setShowGenderDropdown(true),
        show: true,
      },
      // Availability Filter
      {
        key: 'availability',
        label: t('playerDirectory.filters.availability'),
        value: availabilityDisplay,
        isActive: filters.availability !== 'all',
        onPress: () => setShowAvailabilityDropdown(true),
        show: true,
      },
      // Day Filter
      {
        key: 'day',
        label: t('playerDirectory.filters.day' as TranslationKey),
        value: dayDisplay,
        isActive: filters.day !== 'all',
        onPress: () => setShowDayDropdown(true),
        show: true,
      },
      // Play Style Filter
      {
        key: 'playStyle',
        label: t('playerDirectory.filters.playStyle'),
        value: styleDisplay,
        isActive: filters.playStyle !== 'all',
        onPress: () => setShowStyleDropdown(true),
        show: true,
      },
      // Reputation Filter
      {
        key: 'reputation',
        label: t('playerDirectory.filters.reputation.label' as TranslationKey),
        value: reputationDisplay,
        isActive: filters.reputation !== 'all',
        onPress: () => setShowReputationDropdown(true),
        show: true,
      },
      // Sort Option
      {
        key: 'sort',
        label: t('playerDirectory.filters.sortBy'),
        value: sortDisplay,
        isActive: filters.sortBy !== 'distance',
        onPress: () => setShowSortDropdown(true),
        show: true,
      },
      // Blocked Toggle
      {
        key: 'blocked',
        label: t('playerDirectory.filters.blocked'),
        value: t('playerDirectory.filters.blocked'),
        isActive: filters.blocked,
        onPress: handleBlockedToggle,
        hasDropdown: false,
        show: isAuthenticated,
      },
    ],
    [
      t,
      filters,
      isAuthenticated,
      genderDisplay,
      distanceDisplay,
      availabilityDisplay,
      dayDisplay,
      styleDisplay,
      sortDisplay,
      ratingDisplay,
      reputationDisplay,
      handleFavoritesToggle,
      handleBlockedToggle,
      handleCertifiedToggle,
    ]
  );

  // Sort chips: active filters first when hasActiveFilters is true
  const sortedFilterChips = useMemo(() => {
    const visibleChips = filterChipConfigs.filter(chip => chip.show);
    if (!hasActiveFilters) {
      return visibleChips;
    }
    const activeChips = visibleChips.filter(chip => chip.isActive);
    const inactiveChips = visibleChips.filter(chip => !chip.isActive);
    return [...activeChips, ...inactiveChips];
  }, [filterChipConfigs, hasActiveFilters]);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Location Selector - always first if shown */}
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

        {/* Reset Button - show first when filters are active */}
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

        {/* Filter Chips - sorted with active filters first when filters are active */}
        {sortedFilterChips.map(chip => (
          <FilterChip
            key={chip.key}
            label={chip.label}
            value={chip.value}
            isActive={chip.isActive}
            onPress={chip.onPress}
            isDark={isDark}
            hasDropdown={chip.hasDropdown}
          />
        ))}
      </ScrollView>

      {/* Dropdown Modals */}

      {/* Rating Multi-Select Dropdown */}
      <MultiSelectFilterDropdown
        visible={showRatingDropdown}
        title={t('playerDirectory.filters.selectRating' as TranslationKey)}
        options={ratingDropdownOptions}
        selectedIds={filters.rating}
        onToggle={handleRatingToggle}
        onClearAll={handleRatingClearAll}
        onClose={() => setShowRatingDropdown(false)}
        isDark={isDark}
      />

      {/* Reputation Dropdown */}
      <FilterDropdown
        visible={showReputationDropdown}
        title={t('playerDirectory.filters.selectReputation' as TranslationKey)}
        options={REPUTATION_OPTIONS}
        selectedValue={filters.reputation}
        onSelect={handleReputationChange}
        onClose={() => setShowReputationDropdown(false)}
        isDark={isDark}
        getLabel={getReputationLabel}
        getIcon={getReputationIcon}
      />

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
        visible={showDistanceDropdown}
        title={t('playerDirectory.filters.selectMaxDistance')}
        options={DISTANCE_OPTIONS}
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
        title={t('playerDirectory.filters.selectDay' as TranslationKey)}
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
        selectedValue={filters.sortBy || 'distance'}
        onSelect={handleSortChange}
        onClose={() => setShowSortDropdown(false)}
        isDark={isDark}
        getLabel={getSortLabel}
      />
    </View>
  );
});

// Display name for debugging
PlayerFiltersBar.displayName = 'PlayerFiltersBar';

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
  dropdownItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownItemIcon: {
    marginRight: spacingPixels[2],
  },
  multiSelectHeaderActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacingPixels[3],
  },
  multiSelectClearButton: {
    paddingVertical: spacingPixels[1],
    paddingHorizontal: spacingPixels[1],
  },
});

export default PlayerFiltersBar;
