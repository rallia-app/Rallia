/**
 * ModerationFiltersBar Component
 * A horizontally scrollable row of filter chips for moderation report filtering.
 * Follows the same pattern as PlayerFiltersBar with compact toggle chips and dropdown modals.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  TextInput,
} from 'react-native';
import { SelectableChip, Text } from '@rallia/shared-components';
import {
  useTheme,
  type ReportStatus,
  type ReportType,
  type ReportPriority,
} from '@rallia/shared-hooks';
import {
  base,
  spacingPixels,
  radiusPixels,
  primary,
  neutral,
  duration,
  lightTheme,
  darkTheme,
} from '@rallia/design-system';
import { Ionicons } from '@expo/vector-icons';

import { useThemeStyles, useTranslation, type TranslationKey } from '#/hooks';
import { lightHaptic, selectionHaptic } from '#/utils/haptics';

// =============================================================================
// TYPES
// =============================================================================

export interface ModerationFilters {
  status: ReportStatus | '';
  reportType: ReportType | '';
  priority: ReportPriority | '';
  searchQuery: string;
}

export const DEFAULT_MODERATION_FILTERS: ModerationFilters = {
  status: '',
  reportType: '',
  priority: '',
  searchQuery: '',
};

// =============================================================================
// FILTER OPTIONS
// =============================================================================

const STATUS_OPTIONS: (ReportStatus | '')[] = [
  '',
  'pending',
  'under_review',
  'dismissed',
  'action_taken',
  'escalated',
];
const REPORT_TYPE_OPTIONS: (ReportType | '')[] = [
  '',
  'harassment',
  'cheating',
  'inappropriate_content',
  'spam',
  'impersonation',
  'no_show',
  'unsportsmanlike',
  'other',
];
const PRIORITY_OPTIONS: (ReportPriority | '')[] = ['', 'urgent', 'high', 'normal', 'low'];

// Label key mappings for translation
const STATUS_LABEL_KEYS: Record<ReportStatus | '', TranslationKey> = {
  '': 'common.all',
  pending: 'admin.moderation.status.pending',
  under_review: 'admin.moderation.status.under_review',
  dismissed: 'admin.moderation.status.dismissed',
  action_taken: 'admin.moderation.status.action_taken',
  escalated: 'admin.moderation.status.escalated',
};

const REPORT_TYPE_LABEL_KEYS: Record<ReportType | '', TranslationKey> = {
  '': 'common.all',
  harassment: 'admin.moderation.reportType.harassment',
  cheating: 'admin.moderation.reportType.cheating',
  inappropriate_content: 'admin.moderation.reportType.inappropriate_content',
  spam: 'admin.moderation.reportType.spam',
  impersonation: 'admin.moderation.reportType.impersonation',
  no_show: 'admin.moderation.reportType.no_show',
  unsportsmanlike: 'admin.moderation.reportType.unsportsmanlike',
  other: 'admin.moderation.reportType.other',
};

const PRIORITY_LABEL_KEYS: Record<ReportPriority | '', TranslationKey> = {
  '': 'common.all',
  urgent: 'admin.moderation.priority.urgent',
  high: 'admin.moderation.priority.high',
  normal: 'admin.moderation.priority.normal',
  low: 'admin.moderation.priority.low',
};

// =============================================================================
// SEARCH CHIP COMPONENT
// =============================================================================

interface SearchChipProps {
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  isDark: boolean;
}

function SearchChip({ value, placeholder, onChangeText, onClear, isDark }: SearchChipProps) {
  const [isFocused, setIsFocused] = useState(false);
  const isActive = value.length > 0 || isFocused;

  const bgColor = isActive ? primary[500] : isDark ? neutral[800] : neutral[100];
  const borderColor = isActive ? primary[400] : isDark ? neutral[700] : neutral[200];
  const textColor = isActive ? '#ffffff' : isDark ? neutral[300] : neutral[600];
  const placeholderColor = isActive
    ? 'rgba(255,255,255,0.6)'
    : isDark
      ? neutral[500]
      : neutral[400];

  return (
    <View
      style={[
        styles.searchChip,
        {
          backgroundColor: bgColor,
          borderColor: borderColor,
        },
      ]}
    >
      <Ionicons name="search" size={14} color={textColor} />
      <TextInput
        style={[styles.searchInput, { color: textColor }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={placeholderColor}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close-circle" size={16} color={textColor} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// =============================================================================
// DROPDOWN MODAL COMPONENT
// =============================================================================

interface FilterDropdownProps<T extends string> {
  visible: boolean;
  title: string;
  options: T[];
  selectedValue: T;
  onSelect: (value: T) => void;
  onClose: () => void;
  isDark: boolean;
  getLabel: (value: T) => string;
}

function FilterDropdown<T extends string>({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
  isDark,
  getLabel,
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

              return (
                <TouchableOpacity
                  key={String(option) || 'all'}
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

interface ModerationFiltersBarProps {
  filters: ModerationFilters;
  onFiltersChange: (filters: ModerationFilters) => void;
  onReset?: () => void;
}

export function ModerationFiltersBar({
  filters,
  onFiltersChange,
  onReset,
}: ModerationFiltersBarProps) {
  const { theme } = useTheme();
  const { colors } = useThemeStyles();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  // Dropdown visibility states
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false);

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return (
      filters.status !== '' ||
      filters.reportType !== '' ||
      filters.priority !== '' ||
      filters.searchQuery.trim() !== ''
    );
  }, [filters]);

  // Handlers
  const handleStatusChange = useCallback(
    (value: ReportStatus | '') => {
      onFiltersChange({ ...filters, status: value });
    },
    [filters, onFiltersChange]
  );

  const handleTypeChange = useCallback(
    (value: ReportType | '') => {
      onFiltersChange({ ...filters, reportType: value });
    },
    [filters, onFiltersChange]
  );

  const handlePriorityChange = useCallback(
    (value: ReportPriority | '') => {
      onFiltersChange({ ...filters, priority: value });
    },
    [filters, onFiltersChange]
  );

  const handleSearchChange = useCallback(
    (text: string) => {
      onFiltersChange({ ...filters, searchQuery: text });
    },
    [filters, onFiltersChange]
  );

  const handleSearchClear = useCallback(() => {
    onFiltersChange({ ...filters, searchQuery: '' });
  }, [filters, onFiltersChange]);

  const handleReset = useCallback(() => {
    lightHaptic();
    onReset?.();
  }, [onReset]);

  // Label getters using translations
  const getStatusLabel = useCallback((v: ReportStatus | '') => t(STATUS_LABEL_KEYS[v]), [t]);
  const getTypeLabel = useCallback((v: ReportType | '') => t(REPORT_TYPE_LABEL_KEYS[v]), [t]);
  const getPriorityLabel = useCallback((v: ReportPriority | '') => t(PRIORITY_LABEL_KEYS[v]), [t]);

  // Display values for chips
  const statusDisplay =
    filters.status === ''
      ? t('admin.moderation.filterStatus')
      : t(STATUS_LABEL_KEYS[filters.status]);
  const typeDisplay =
    filters.reportType === ''
      ? t('admin.moderation.filterType')
      : t(REPORT_TYPE_LABEL_KEYS[filters.reportType]);
  const priorityDisplay =
    filters.priority === ''
      ? t('admin.moderation.filterPriority')
      : t(PRIORITY_LABEL_KEYS[filters.priority]);

  /** Chip icons track the label colour the chip renders at. */
  const chipTint = (selected: boolean) => (selected ? base.white : colors.textMuted);

  // Theme colors for reset chip
  const resetBgColor = isDark ? neutral[800] : neutral[100];
  const resetBorderColor = isDark ? neutral[700] : neutral[200];
  const resetTextColor = isDark ? neutral[300] : neutral[600];

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Search Input */}
        <SearchChip
          value={filters.searchQuery}
          placeholder={t('admin.moderation.searchPlaceholder')}
          onChangeText={handleSearchChange}
          onClear={handleSearchClear}
          isDark={isDark}
        />

        {/* Status Filter */}
        <SelectableChip
          label={statusDisplay}
          selected={filters.status !== ''}
          animateOnPress
          icon={<Ionicons name="flag-outline" size={14} color={chipTint(filters.status !== '')} />}
          trailingIcon={
            <Ionicons
              name="chevron-down-outline"
              size={12}
              color={chipTint(filters.status !== '')}
            />
          }
          onPress={() => {
            void lightHaptic();
            setShowStatusDropdown(true);
          }}
        />

        {/* Report Type Filter */}
        <SelectableChip
          label={typeDisplay}
          selected={filters.reportType !== ''}
          animateOnPress
          icon={
            <Ionicons
              name="warning-outline"
              size={14}
              color={chipTint(filters.reportType !== '')}
            />
          }
          trailingIcon={
            <Ionicons
              name="chevron-down-outline"
              size={12}
              color={chipTint(filters.reportType !== '')}
            />
          }
          onPress={() => {
            void lightHaptic();
            setShowTypeDropdown(true);
          }}
        />

        {/* Priority Filter */}
        <SelectableChip
          label={priorityDisplay}
          selected={filters.priority !== ''}
          animateOnPress
          icon={
            <Ionicons
              name="alert-circle-outline"
              size={14}
              color={chipTint(filters.priority !== '')}
            />
          }
          trailingIcon={
            <Ionicons
              name="chevron-down-outline"
              size={12}
              color={chipTint(filters.priority !== '')}
            />
          }
          onPress={() => {
            void lightHaptic();
            setShowPriorityDropdown(true);
          }}
        />

        {/* Reset Button - only show when filters are active */}
        {hasActiveFilters && (
          <TouchableOpacity
            style={[
              styles.resetChip,
              {
                backgroundColor: resetBgColor,
                borderColor: resetBorderColor,
              },
            ]}
            onPress={handleReset}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh-outline" size={14} color={resetTextColor} />
            <Text size="xs" weight="medium" color={resetTextColor}>
              {t('admin.moderation.clearFilters')}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Dropdown Modals */}
      <FilterDropdown
        visible={showStatusDropdown}
        title={t('admin.moderation.filterStatus')}
        options={STATUS_OPTIONS}
        selectedValue={filters.status}
        onSelect={handleStatusChange}
        onClose={() => setShowStatusDropdown(false)}
        isDark={isDark}
        getLabel={getStatusLabel}
      />

      <FilterDropdown
        visible={showTypeDropdown}
        title={t('admin.moderation.filterType')}
        options={REPORT_TYPE_OPTIONS}
        selectedValue={filters.reportType}
        onSelect={handleTypeChange}
        onClose={() => setShowTypeDropdown(false)}
        isDark={isDark}
        getLabel={getTypeLabel}
      />

      <FilterDropdown
        visible={showPriorityDropdown}
        title={t('admin.moderation.filterPriority')}
        options={PRIORITY_OPTIONS}
        selectedValue={filters.priority}
        onSelect={handlePriorityChange}
        onClose={() => setShowPriorityDropdown(false)}
        isDark={isDark}
        getLabel={getPriorityLabel}
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
  searchChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
    minWidth: 140,
    maxWidth: 200,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    paddingVertical: spacingPixels[1],
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

export default ModerationFiltersBar;
