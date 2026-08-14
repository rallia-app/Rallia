/**
 * EventFiltersBar
 *
 * Filter chips for the unified event list. Replaces the tournament and league
 * bars, which filtered the same things by different names on two screens.
 *
 * The format chip is what makes one list work: it narrows to the format the
 * reader wants instead of them having to pick a screen first. It cuts by the
 * three formats Rallia runs, not by which engine happens to run them, so a
 * knockout draw and a pools-then-knockout draw stop sharing one chip.
 * Everything else is stated in format-neutral terms, so a new format inherits
 * the bar by adding a row to EVENT_KINDS.
 */

import React, { useMemo, useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Modal, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
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
import { useTheme } from '@rallia/shared-hooks';
import type { EventFormat, EventPhase } from '@rallia/shared-services';

import { useTranslation, type TranslationKey } from '../../../hooks';
import { selectionHaptic, lightHaptic } from '../../../utils/haptics';
import { EVENT_KINDS, EVENT_FORMAT_LABEL_KEY } from '../eventKinds';

/** Which format's events to show. Mirrors EventFormat plus an "everything". */
export type EventFormatFilter = 'all' | EventFormat;
/** Lifecycle cut, in EventPhase terms. `closed` never appears in discovery. */
export type EventPhaseFilter = 'all' | Extract<EventPhase, 'joinable' | 'startingSoon' | 'running'>;

// Picker order is decision order (shortest commitment first); the filter keeps it.
const FORMAT_OPTIONS: EventFormatFilter[] = ['all', ...EVENT_KINDS.map(d => d.kind)];
const PHASE_OPTIONS: EventPhaseFilter[] = ['all', 'joinable', 'startingSoon', 'running'];

const PHASE_LABEL_KEYS: Record<Exclude<EventPhaseFilter, 'all'>, string> = {
  joinable: 'eventList.sections.joinable',
  startingSoon: 'eventList.sections.startingSoon',
  running: 'eventList.sections.running',
};

interface EventFiltersBarProps {
  format: EventFormatFilter;
  phase: EventPhaseFilter;
  /** Toggle: only events whose rating window includes the player's rating. */
  myRatingOnly: boolean;
  /** Hide the my-rating chip when the player has no rating for the sport. */
  showMyRatingFilter: boolean;
  openSpotsOnly: boolean;
  onFormatChange: (format: EventFormatFilter) => void;
  onPhaseChange: (phase: EventPhaseFilter) => void;
  onMyRatingChange: (myRatingOnly: boolean) => void;
  onOpenSpotsChange: (openSpotsOnly: boolean) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
}

// =============================================================================
// FILTER CHIP (mirrors MatchFiltersBar)
// =============================================================================

const FilterChip: React.FC<{
  value: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
  hasDropdown?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}> = ({ value, isActive, onPress, isDark, hasDropdown = true, icon }) => {
  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const bgColor = isActive ? primary[500] : isDark ? neutral[800] : neutral[100];
  const borderColor = isActive ? primary[400] : isDark ? neutral[700] : neutral[200];
  const textColor = isActive ? '#ffffff' : isDark ? neutral[300] : neutral[600];

  const handlePress = () => {
    void lightHaptic();
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 50, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[styles.chip, { backgroundColor: bgColor, borderColor }]}
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
};

// =============================================================================
// FILTER DROPDOWN MODAL (mirrors MatchFiltersBar)
// =============================================================================

function FilterDropdown<T extends string>({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
  isDark,
  getLabel,
}: {
  visible: boolean;
  title: string;
  options: T[];
  selectedValue: T;
  onSelect: (value: T) => void;
  onClose: () => void;
  isDark: boolean;
  getLabel: (value: T) => string;
}) {
  const fadeAnim = useMemo(() => new Animated.Value(0), []);
  const scaleAnim = useMemo(() => new Animated.Value(0.9), []);

  const themeColors = isDark ? darkTheme : lightTheme;
  const colors = {
    dropdownBg: themeColors.card,
    dropdownBorder: themeColors.border,
    itemText: themeColors.foreground,
    itemTextSelected: primary[500],
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
    void selectionHaptic();
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
            { opacity: fadeAnim, backgroundColor: colors.overlayBg },
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

          <ScrollView showsVerticalScrollIndicator={false} bounces={options.length > 6}>
            {options.map((option, index) => {
              const isSelected = selectedValue === option;
              const isLast = index === options.length - 1;
              return (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.dropdownItem,
                    {
                      backgroundColor: isSelected ? colors.itemBgSelected : 'transparent',
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

export const EventFiltersBar: React.FC<EventFiltersBarProps> = ({
  format,
  phase,
  myRatingOnly,
  showMyRatingFilter,
  openSpotsOnly,
  onFormatChange,
  onPhaseChange,
  onMyRatingChange,
  onOpenSpotsChange,
  onReset,
  hasActiveFilters,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  const [showFormatDropdown, setShowFormatDropdown] = useState(false);
  const [showPhaseDropdown, setShowPhaseDropdown] = useState(false);

  const getFormatLabel = (value: EventFormatFilter) =>
    value === 'all' ? t('eventList.filters.allFormats') : t(EVENT_FORMAT_LABEL_KEY[value]);

  const getPhaseLabel = (value: EventPhaseFilter) =>
    value === 'all'
      ? t('eventList.filters.allPhases')
      : t(PHASE_LABEL_KEYS[value] as TranslationKey);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {hasActiveFilters && (
          <TouchableOpacity
            style={[
              styles.resetChip,
              {
                backgroundColor: isDark ? secondary[900] + '40' : secondary[50],
                borderColor: isDark ? secondary[700] : secondary[200],
              },
            ]}
            onPress={() => {
              void lightHaptic();
              onReset();
            }}
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

        <FilterChip
          value={format === 'all' ? t('eventList.filters.format') : getFormatLabel(format)}
          isActive={format !== 'all'}
          onPress={() => setShowFormatDropdown(true)}
          isDark={isDark}
        />
        <FilterChip
          value={phase === 'all' ? t('eventList.filters.phase') : getPhaseLabel(phase)}
          isActive={phase !== 'all'}
          onPress={() => setShowPhaseDropdown(true)}
          isDark={isDark}
        />
        {showMyRatingFilter && (
          <FilterChip
            value={t('eventList.filters.myRating')}
            isActive={myRatingOnly}
            onPress={() => onMyRatingChange(!myRatingOnly)}
            isDark={isDark}
            hasDropdown={false}
            icon="analytics"
          />
        )}
        <FilterChip
          value={t('eventList.filters.openSpots')}
          isActive={openSpotsOnly}
          onPress={() => onOpenSpotsChange(!openSpotsOnly)}
          isDark={isDark}
          hasDropdown={false}
          icon="people-outline"
        />
      </ScrollView>

      <FilterDropdown
        visible={showFormatDropdown}
        title={t('eventList.filters.format')}
        options={FORMAT_OPTIONS}
        selectedValue={format}
        onSelect={onFormatChange}
        onClose={() => setShowFormatDropdown(false)}
        isDark={isDark}
        getLabel={getFormatLabel}
      />
      <FilterDropdown
        visible={showPhaseDropdown}
        title={t('eventList.filters.phase')}
        options={PHASE_OPTIONS}
        selectedValue={phase}
        onSelect={onPhaseChange}
        onClose={() => setShowPhaseDropdown(false)}
        isDark={isDark}
        getLabel={getPhaseLabel}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacingPixels[2],
  },
  scrollContent: {
    paddingHorizontal: spacingPixels[4],
    gap: spacingPixels[2],
    alignItems: 'center',
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
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

export default EventFiltersBar;
