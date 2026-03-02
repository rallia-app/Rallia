/**
 * MatchFiltersBar Component
 * A horizontally scrollable row of filter chips for match filtering.
 * Uses compact dropdown-based filters similar to PlayerFiltersBar.
 */

import React, { useCallback, useState, useMemo, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Text, LocationSelector, type LocationMode } from '@rallia/shared-components';
import { useTheme, DISTANCE_OPTIONS, MATCH_TIER_OPTIONS } from '@rallia/shared-hooks';
import { useThemeStyles, useTranslation } from '../../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
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
import type {
  FormatFilter,
  MatchTypeFilter,
  DateRangeFilter,
  TimeOfDayFilter,
  SkillLevelFilter,
  GenderFilter,
  CostFilter,
  JoinModeFilter,
  DistanceFilter,
  DurationFilter,
  CourtStatusFilter,
  MatchTierFilter,
  SpecificDateFilter,
} from '@rallia/shared-hooks';

// =============================================================================
// TYPES & OPTIONS
// =============================================================================

interface MatchFiltersBarProps {
  format: FormatFilter;
  matchType: MatchTypeFilter;
  dateRange: DateRangeFilter;
  timeOfDay: TimeOfDayFilter;
  skillLevel: SkillLevelFilter;
  gender: GenderFilter;
  cost: CostFilter;
  joinMode: JoinModeFilter;
  distance: DistanceFilter;
  duration: DurationFilter;
  courtStatus: CourtStatusFilter;
  matchTier: MatchTierFilter;
  specificDate: SpecificDateFilter;
  onFormatChange: (format: FormatFilter) => void;
  onMatchTypeChange: (matchType: MatchTypeFilter) => void;
  onDateRangeChange: (dateRange: DateRangeFilter) => void;
  onTimeOfDayChange: (timeOfDay: TimeOfDayFilter) => void;
  onSkillLevelChange: (skillLevel: SkillLevelFilter) => void;
  onGenderChange: (gender: GenderFilter) => void;
  onCostChange: (cost: CostFilter) => void;
  onJoinModeChange: (joinMode: JoinModeFilter) => void;
  onDistanceChange: (distance: DistanceFilter) => void;
  onDurationChange: (duration: DurationFilter) => void;
  onCourtStatusChange: (courtStatus: CourtStatusFilter) => void;
  onMatchTierChange: (matchTier: MatchTierFilter) => void;
  onSpecificDateChange: (specificDate: SpecificDateFilter) => void;
  onReset?: () => void;
  hasActiveFilters?: boolean;
  showLocationSelector?: boolean;
  locationMode?: LocationMode;
  onLocationModeChange?: (mode: LocationMode) => void;
  hasHomeLocation?: boolean;
  homeLocationLabel?: string;
}

// Filter option definitions
const FORMAT_OPTIONS: FormatFilter[] = ['all', 'singles', 'doubles'];
const MATCH_TYPE_OPTIONS: MatchTypeFilter[] = ['all', 'casual', 'competitive'];
const TIME_OF_DAY_OPTIONS: TimeOfDayFilter[] = ['all', 'morning', 'afternoon', 'evening'];
const SKILL_LEVEL_OPTIONS: SkillLevelFilter[] = ['all', 'beginner', 'intermediate', 'advanced'];
const GENDER_OPTIONS: GenderFilter[] = ['all', 'male', 'female', 'other'];
const COST_OPTIONS: CostFilter[] = ['all', 'free', 'paid'];
const JOIN_MODE_OPTIONS: JoinModeFilter[] = ['all', 'direct', 'request'];
const DURATION_OPTIONS_LIST: DurationFilter[] = ['all', '30', '60', '90', '120+'];
const COURT_STATUS_OPTIONS: CourtStatusFilter[] = ['all', 'reserved', 'to_reserve'];

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
          <Ionicons name="chevron-down" size={12} color={textColor} style={styles.chipChevron} />
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
                    <Ionicons name="checkmark-circle" size={22} color={colors.checkmark} />
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

export default function MatchFiltersBar({
  format,
  matchType,
  dateRange,
  timeOfDay,
  skillLevel,
  gender,
  cost,
  joinMode,
  distance,
  duration,
  courtStatus,
  matchTier,
  specificDate,
  onFormatChange,
  onMatchTypeChange,
  onDateRangeChange,
  onTimeOfDayChange,
  onSkillLevelChange,
  onGenderChange,
  onCostChange,
  onJoinModeChange,
  onDistanceChange,
  onDurationChange,
  onCourtStatusChange,
  onMatchTierChange,
  onSpecificDateChange,
  onReset,
  hasActiveFilters = false,
  showLocationSelector = false,
  locationMode,
  onLocationModeChange,
  hasHomeLocation = false,
  homeLocationLabel,
}: MatchFiltersBarProps) {
  const { theme } = useTheme();
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  // Dropdown visibility states
  const [showFormatDropdown, setShowFormatDropdown] = useState(false);
  const [showMatchTypeDropdown, setShowMatchTypeDropdown] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [showSkillDropdown, setShowSkillDropdown] = useState(false);
  const [showGenderDropdown, setShowGenderDropdown] = useState(false);
  const [showCostDropdown, setShowCostDropdown] = useState(false);
  const [showJoinModeDropdown, setShowJoinModeDropdown] = useState(false);
  const [showDistanceDropdown, setShowDistanceDropdown] = useState(false);
  const [showDurationDropdown, setShowDurationDropdown] = useState(false);
  const [showCourtStatusDropdown, setShowCourtStatusDropdown] = useState(false);
  const [showMatchTierDropdown, setShowMatchTierDropdown] = useState(false);

  // Date picker state
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(() => {
    if (specificDate) {
      return new Date(specificDate + 'T00:00:00');
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  });

  const getTodayAtMidnight = useCallback(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }, []);

  // =============================================================================
  // LABEL GETTERS
  // =============================================================================

  const getFilterLabel = useCallback(
    (filterType: string, value: string): string => {
      const key = `publicMatches.filters.${filterType}.${value}` as TranslationKey;
      return t(key);
    },
    [t]
  );

  const getFormatLabel = useCallback(
    (v: FormatFilter) => getFilterLabel('format', v),
    [getFilterLabel]
  );
  const getMatchTypeLabel = useCallback(
    (v: MatchTypeFilter) => getFilterLabel('matchType', v),
    [getFilterLabel]
  );
  const getDateRangeLabel = useCallback(
    (v: DateRangeFilter) => getFilterLabel('dateRange', v),
    [getFilterLabel]
  );
  const getTimeOfDayLabel = useCallback(
    (v: TimeOfDayFilter) => getFilterLabel('timeOfDay', v),
    [getFilterLabel]
  );
  const getSkillLevelLabel = useCallback(
    (v: SkillLevelFilter) => getFilterLabel('skillLevel', v),
    [getFilterLabel]
  );
  const getGenderLabel = useCallback(
    (v: GenderFilter) => getFilterLabel('gender', v),
    [getFilterLabel]
  );
  const getCostLabel = useCallback((v: CostFilter) => getFilterLabel('cost', v), [getFilterLabel]);
  const getJoinModeLabel = useCallback(
    (v: JoinModeFilter) => getFilterLabel('joinMode', v),
    [getFilterLabel]
  );
  const getDurationLabel = useCallback(
    (v: DurationFilter) => t(`publicMatches.filters.duration.${v}`),
    [t]
  );
  const getCourtStatusLabel = useCallback(
    (v: CourtStatusFilter) => t(`publicMatches.filters.courtStatus.${v}`),
    [t]
  );
  const getMatchTierLabel = useCallback(
    (v: MatchTierFilter) => t(`publicMatches.filters.tier.${v}` as TranslationKey),
    [t]
  );
  const getDistanceLabel = useCallback(
    (v: DistanceFilter) => {
      if (v === 'all') return t('publicMatches.filters.distance.all');
      return `${v} km`;
    },
    [t]
  );

  // Icon getters for dropdowns
  const getTimeOfDayIcon = useCallback((v: TimeOfDayFilter) => {
    const icons: Record<TimeOfDayFilter, keyof typeof Ionicons.glyphMap | undefined> = {
      all: undefined,
      morning: 'sunny-outline',
      afternoon: 'partly-sunny-outline',
      evening: 'moon-outline',
    };
    return icons[v];
  }, []);

  const getMatchTierIcon = useCallback((v: MatchTierFilter) => {
    const icons: Record<MatchTierFilter, keyof typeof Ionicons.glyphMap | undefined> = {
      all: undefined,
      mostWanted: 'flame-outline',
      covetedPlayers: 'star-outline',
      courtBooked: 'checkmark-circle-outline',
    };
    return icons[v];
  }, []);

  const getCostIcon = useCallback((v: CostFilter) => {
    const icons: Record<CostFilter, keyof typeof Ionicons.glyphMap | undefined> = {
      all: undefined,
      free: 'checkmark-circle-outline',
      paid: 'cash-outline',
    };
    return icons[v];
  }, []);

  // =============================================================================
  // DISPLAY VALUES
  // =============================================================================

  const formatDisplay =
    format === 'all' ? t('publicMatches.filters.format.label') : getFormatLabel(format);
  const matchTypeDisplay =
    matchType === 'all' ? t('publicMatches.filters.matchType.label') : getMatchTypeLabel(matchType);
  const timeOfDayDisplay =
    timeOfDay === 'all' ? t('publicMatches.filters.timeOfDay.label') : getTimeOfDayLabel(timeOfDay);
  const skillLevelDisplay =
    skillLevel === 'all'
      ? t('publicMatches.filters.skillLevel.label')
      : getSkillLevelLabel(skillLevel);
  const genderDisplay =
    gender === 'all' ? t('publicMatches.filters.gender.label') : getGenderLabel(gender);
  const costDisplay = cost === 'all' ? t('publicMatches.filters.cost.label') : getCostLabel(cost);
  const joinModeDisplay =
    joinMode === 'all' ? t('publicMatches.filters.joinMode.label') : getJoinModeLabel(joinMode);
  const distanceDisplay =
    distance === 'all' ? t('publicMatches.filters.distance.label') : `${distance} km`;
  const durationDisplay =
    duration === 'all' ? t('publicMatches.filters.duration.label') : getDurationLabel(duration);
  const courtStatusDisplay =
    courtStatus === 'all'
      ? t('publicMatches.filters.courtStatus.label')
      : getCourtStatusLabel(courtStatus);
  const matchTierDisplay =
    matchTier === 'all' ? t('publicMatches.filters.tier.label') : getMatchTierLabel(matchTier);

  // Date display - combines dateRange and specificDate
  const getDateDisplay = useCallback(() => {
    if (specificDate) {
      const d = new Date(specificDate + 'T00:00:00');
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    if (dateRange === 'all') {
      return t('publicMatches.filters.dateRange.label');
    }
    return getDateRangeLabel(dateRange);
  }, [specificDate, dateRange, t, getDateRangeLabel]);

  // =============================================================================
  // DATE PICKER HANDLERS
  // =============================================================================

  const handleDateChipPress = useCallback(() => {
    // Open date dropdown to choose between ranges or pick specific date
    setShowDateDropdown(true);
  }, []);

  const handleDateRangeSelect = useCallback(
    (value: DateRangeFilter | 'pick_date') => {
      if (value === 'pick_date') {
        // Open the date picker
        setTempDate(() => {
          if (specificDate) {
            return new Date(specificDate + 'T00:00:00');
          }
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          return tomorrow;
        });
        setShowDatePicker(true);
      } else {
        onDateRangeChange(value);
        if (specificDate !== null) {
          onSpecificDateChange(null);
        }
      }
    },
    [specificDate, onDateRangeChange, onSpecificDateChange]
  );

  const handleDateChange = useCallback(
    (_event: unknown, selectedDate?: Date) => {
      if (Platform.OS === 'android') {
        setShowDatePicker(false);
        if (selectedDate) {
          const isoDate = selectedDate.toISOString().split('T')[0];
          onSpecificDateChange(isoDate);
          selectionHaptic();
        }
      } else if (selectedDate) {
        setTempDate(selectedDate);
      }
    },
    [onSpecificDateChange]
  );

  const handleDateCancel = useCallback(() => {
    setShowDatePicker(false);
  }, []);

  const handleDateDone = useCallback(() => {
    setShowDatePicker(false);
    const isoDate = tempDate.toISOString().split('T')[0];
    onSpecificDateChange(isoDate);
    selectionHaptic();
  }, [tempDate, onSpecificDateChange]);

  // =============================================================================
  // RESET HANDLER
  // =============================================================================

  const handleReset = useCallback(() => {
    lightHaptic();
    onReset?.();
  }, [onReset]);

  // =============================================================================
  // DATE OPTIONS (including pick specific date)
  // =============================================================================

  const dateOptions: (DateRangeFilter | 'pick_date')[] = [
    'all',
    'today',
    'week',
    'weekend',
    'pick_date',
  ];

  const getDateOptionLabel = useCallback(
    (v: DateRangeFilter | 'pick_date') => {
      if (v === 'pick_date') {
        return specificDate
          ? t('publicMatches.filters.specificDate.clear')
          : t('publicMatches.filters.specificDate.pick');
      }
      return getDateRangeLabel(v as DateRangeFilter);
    },
    [t, getDateRangeLabel, specificDate]
  );

  const getDateOptionIcon = useCallback((v: DateRangeFilter | 'pick_date') => {
    if (v === 'pick_date') return 'calendar-outline' as keyof typeof Ionicons.glyphMap;
    return undefined;
  }, []);

  // Current date selection for the dropdown
  const currentDateSelection = specificDate ? 'pick_date' : dateRange;

  // =============================================================================
  // SORTED FILTER CHIPS — active filters float to front
  // =============================================================================

  const filterChips = useMemo(() => {
    const chips: {
      key: string;
      value: string;
      isActive: boolean;
      onPress: () => void;
      icon?: keyof typeof Ionicons.glyphMap;
    }[] = [
      {
        key: 'matchTier',
        value: matchTierDisplay,
        isActive: matchTier !== 'all',
        onPress: () => setShowMatchTierDropdown(true),
        icon: getMatchTierIcon(matchTier),
      },
      {
        key: 'date',
        value: getDateDisplay(),
        isActive: dateRange !== 'all' || specificDate !== null,
        onPress: handleDateChipPress,
        icon: specificDate ? 'calendar' : undefined,
      },
      {
        key: 'timeOfDay',
        value: timeOfDayDisplay,
        isActive: timeOfDay !== 'all',
        onPress: () => setShowTimeDropdown(true),
        icon: getTimeOfDayIcon(timeOfDay),
      },
      {
        key: 'format',
        value: formatDisplay,
        isActive: format !== 'all',
        onPress: () => setShowFormatDropdown(true),
      },
      {
        key: 'matchType',
        value: matchTypeDisplay,
        isActive: matchType !== 'all',
        onPress: () => setShowMatchTypeDropdown(true),
      },
      {
        key: 'duration',
        value: durationDisplay,
        isActive: duration !== 'all',
        onPress: () => setShowDurationDropdown(true),
        icon: duration !== 'all' ? 'timer-outline' : undefined,
      },
      {
        key: 'distance',
        value: distanceDisplay,
        isActive: distance !== 'all',
        onPress: () => setShowDistanceDropdown(true),
      },
      {
        key: 'skillLevel',
        value: skillLevelDisplay,
        isActive: skillLevel !== 'all',
        onPress: () => setShowSkillDropdown(true),
      },
      {
        key: 'gender',
        value: genderDisplay,
        isActive: gender !== 'all',
        onPress: () => setShowGenderDropdown(true),
      },
      {
        key: 'cost',
        value: costDisplay,
        isActive: cost !== 'all',
        onPress: () => setShowCostDropdown(true),
        icon: getCostIcon(cost),
      },
      {
        key: 'courtStatus',
        value: courtStatusDisplay,
        isActive: courtStatus !== 'all',
        onPress: () => setShowCourtStatusDropdown(true),
      },
      {
        key: 'joinMode',
        value: joinModeDisplay,
        isActive: joinMode !== 'all',
        onPress: () => setShowJoinModeDropdown(true),
      },
    ];

    // Stable sort: active filters first, preserve relative order within each group
    return [...chips].sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return 0;
    });
  }, [
    getDateDisplay,
    dateRange,
    specificDate,
    handleDateChipPress,
    timeOfDayDisplay,
    timeOfDay,
    getTimeOfDayIcon,
    formatDisplay,
    format,
    matchTypeDisplay,
    matchType,
    durationDisplay,
    duration,
    distanceDisplay,
    distance,
    skillLevelDisplay,
    skillLevel,
    genderDisplay,
    gender,
    costDisplay,
    cost,
    getCostIcon,
    courtStatusDisplay,
    courtStatus,
    matchTierDisplay,
    matchTier,
    getMatchTierIcon,
    joinModeDisplay,
    joinMode,
  ]);

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

        {/* Reset Button — shown after location selector, before filter chips */}
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
              {t('publicMatches.filters.reset')}
            </Text>
          </TouchableOpacity>
        )}

        {/* Filter Chips — sorted with active filters first */}
        {filterChips.map(chip => (
          <FilterChip
            key={chip.key}
            value={chip.value}
            isActive={chip.isActive}
            onPress={chip.onPress}
            isDark={isDark}
            icon={chip.icon}
          />
        ))}
      </ScrollView>

      {/* =================================================================== */}
      {/* DROPDOWN MODALS */}
      {/* =================================================================== */}

      {/* Date Dropdown (includes pick specific date option) */}
      <FilterDropdown
        visible={showDateDropdown}
        title={t('publicMatches.filters.dateRange.label')}
        options={dateOptions}
        selectedValue={currentDateSelection}
        onSelect={handleDateRangeSelect}
        onClose={() => setShowDateDropdown(false)}
        isDark={isDark}
        getLabel={getDateOptionLabel}
        getIcon={getDateOptionIcon}
      />

      {/* Time of Day Dropdown */}
      <FilterDropdown
        visible={showTimeDropdown}
        title={t('publicMatches.filters.timeOfDay.label')}
        options={TIME_OF_DAY_OPTIONS}
        selectedValue={timeOfDay}
        onSelect={onTimeOfDayChange}
        onClose={() => setShowTimeDropdown(false)}
        isDark={isDark}
        getLabel={getTimeOfDayLabel}
        getIcon={getTimeOfDayIcon}
      />

      {/* Format Dropdown */}
      <FilterDropdown
        visible={showFormatDropdown}
        title={t('publicMatches.filters.format.label')}
        options={FORMAT_OPTIONS}
        selectedValue={format}
        onSelect={onFormatChange}
        onClose={() => setShowFormatDropdown(false)}
        isDark={isDark}
        getLabel={getFormatLabel}
      />

      {/* Match Type Dropdown */}
      <FilterDropdown
        visible={showMatchTypeDropdown}
        title={t('publicMatches.filters.matchType.label')}
        options={MATCH_TYPE_OPTIONS}
        selectedValue={matchType}
        onSelect={onMatchTypeChange}
        onClose={() => setShowMatchTypeDropdown(false)}
        isDark={isDark}
        getLabel={getMatchTypeLabel}
      />

      {/* Duration Dropdown */}
      <FilterDropdown
        visible={showDurationDropdown}
        title={t('publicMatches.filters.duration.label')}
        options={DURATION_OPTIONS_LIST}
        selectedValue={duration}
        onSelect={onDurationChange}
        onClose={() => setShowDurationDropdown(false)}
        isDark={isDark}
        getLabel={getDurationLabel}
      />

      {/* Distance Dropdown */}
      <FilterDropdown
        visible={showDistanceDropdown}
        title={t('publicMatches.filters.distance.label')}
        options={DISTANCE_OPTIONS as DistanceFilter[]}
        selectedValue={distance}
        onSelect={onDistanceChange}
        onClose={() => setShowDistanceDropdown(false)}
        isDark={isDark}
        getLabel={getDistanceLabel}
      />

      {/* Skill Level Dropdown */}
      <FilterDropdown
        visible={showSkillDropdown}
        title={t('publicMatches.filters.skillLevel.label')}
        options={SKILL_LEVEL_OPTIONS}
        selectedValue={skillLevel}
        onSelect={onSkillLevelChange}
        onClose={() => setShowSkillDropdown(false)}
        isDark={isDark}
        getLabel={getSkillLevelLabel}
      />

      {/* Gender Dropdown */}
      <FilterDropdown
        visible={showGenderDropdown}
        title={t('publicMatches.filters.gender.label')}
        options={GENDER_OPTIONS}
        selectedValue={gender}
        onSelect={onGenderChange}
        onClose={() => setShowGenderDropdown(false)}
        isDark={isDark}
        getLabel={getGenderLabel}
      />

      {/* Cost Dropdown */}
      <FilterDropdown
        visible={showCostDropdown}
        title={t('publicMatches.filters.cost.label')}
        options={COST_OPTIONS}
        selectedValue={cost}
        onSelect={onCostChange}
        onClose={() => setShowCostDropdown(false)}
        isDark={isDark}
        getLabel={getCostLabel}
        getIcon={getCostIcon}
      />

      {/* Court Status Dropdown */}
      <FilterDropdown
        visible={showCourtStatusDropdown}
        title={t('publicMatches.filters.courtStatus.label')}
        options={COURT_STATUS_OPTIONS}
        selectedValue={courtStatus}
        onSelect={onCourtStatusChange}
        onClose={() => setShowCourtStatusDropdown(false)}
        isDark={isDark}
        getLabel={getCourtStatusLabel}
      />

      {/* Match Tier Dropdown */}
      <FilterDropdown
        visible={showMatchTierDropdown}
        title={t('publicMatches.filters.tier.label')}
        options={MATCH_TIER_OPTIONS as MatchTierFilter[]}
        selectedValue={matchTier}
        onSelect={onMatchTierChange}
        onClose={() => setShowMatchTierDropdown(false)}
        isDark={isDark}
        getLabel={getMatchTierLabel}
        getIcon={getMatchTierIcon}
      />

      {/* Join Mode Dropdown */}
      <FilterDropdown
        visible={showJoinModeDropdown}
        title={t('publicMatches.filters.joinMode.label')}
        options={JOIN_MODE_OPTIONS}
        selectedValue={joinMode}
        onSelect={onJoinModeChange}
        onClose={() => setShowJoinModeDropdown(false)}
        isDark={isDark}
        getLabel={getJoinModeLabel}
      />

      {/* =================================================================== */}
      {/* DATE PICKER MODALS */}
      {/* =================================================================== */}

      {/* Android Date Picker */}
      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          onChange={handleDateChange}
          minimumDate={getTodayAtMidnight()}
        />
      )}

      {/* iOS Date Picker Modal */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showDatePicker}
          transparent
          animationType="fade"
          onRequestClose={handleDateCancel}
        >
          <TouchableOpacity
            style={styles.datePickerOverlay}
            activeOpacity={1}
            onPress={handleDateCancel}
          >
            <View
              style={[styles.datePickerModal, { backgroundColor: colors.cardBackground }]}
              onStartShouldSetResponder={() => true}
            >
              <View style={[styles.datePickerHeader, { borderBottomColor: colors.border }]}>
                <TouchableOpacity onPress={handleDateCancel} style={styles.datePickerHeaderButton}>
                  <Text size="base" color={colors.textMuted}>
                    {t('common.cancel')}
                  </Text>
                </TouchableOpacity>
                <Text size="base" weight="semibold" color={colors.text}>
                  {t('publicMatches.filters.specificDate.label')}
                </Text>
                <TouchableOpacity onPress={handleDateDone} style={styles.datePickerHeaderButton}>
                  <Text size="base" weight="semibold" color={primary[500]}>
                    {t('common.done')}
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                onChange={handleDateChange}
                minimumDate={getTodayAtMidnight()}
                themeVariant={isDark ? 'dark' : 'light'}
                style={styles.iosPicker}
              />
            </View>
          </TouchableOpacity>
        </Modal>
      )}
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
  // Date picker modal styles
  datePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  datePickerModal: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
    paddingBottom: spacingPixels[8],
  },
  datePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
    paddingHorizontal: spacingPixels[4],
    borderBottomWidth: 1,
  },
  datePickerHeaderButton: {
    paddingVertical: spacingPixels[1],
    paddingHorizontal: spacingPixels[2],
  },
  iosPicker: {
    height: 200,
  },
});
