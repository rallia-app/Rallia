/**
 * ChatFiltersBar Component
 * A horizontally scrollable row of filter chips for chat filtering.
 * Follows the same pattern as PlayerFiltersBar with compact toggle chips.
 *
 * Filters:
 * - Blocked: Show only conversations with blocked users
 * - Unread: Show only conversations with unread messages
 * - Favorites: Show only conversations with favorite users
 * - Reset: Clear all active filters
 */

import React, { useMemo, useCallback, memo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral, secondary } from '@rallia/design-system';
import { useTheme } from '@rallia/shared-hooks';
import { lightHaptic, selectionHaptic } from '@rallia/shared-utils';

import { useTranslation, type TranslationKey } from '../../../hooks';

// =============================================================================
// TYPES
// =============================================================================

export interface ChatFilters {
  blocked: boolean;
  unread: boolean;
  favorites: boolean;
  archived: boolean;
  muted: boolean;
  pinned: boolean;
}

export const DEFAULT_CHAT_FILTERS: ChatFilters = {
  blocked: false,
  unread: false,
  favorites: false,
  archived: false,
  muted: false,
  pinned: false,
};

// =============================================================================
// FILTER CHIP COMPONENT
// =============================================================================

interface FilterChipProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

function FilterChip({ label, isActive, onPress, isDark, icon }: FilterChipProps) {
  // Animation value - using useMemo for stable instance
  const scaleAnim = useMemo(() => new Animated.Value(1), []);

  const bgColor = isActive ? primary[500] : isDark ? neutral[800] : neutral[100];
  const borderColor = isActive ? primary[400] : isDark ? neutral[700] : neutral[200];
  const textColor = isActive ? '#ffffff' : isDark ? neutral[300] : neutral[600];

  const handlePress = () => {
    void lightHaptic();
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
          {label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

interface ChatFiltersBarProps {
  filters: ChatFilters;
  onFiltersChange: (filters: ChatFilters) => void;
  onReset?: () => void;
}

export const ChatFiltersBar = memo(function ChatFiltersBar({
  filters,
  onFiltersChange,
  onReset,
}: ChatFiltersBarProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return (
      filters.blocked ||
      filters.unread ||
      filters.favorites ||
      filters.archived ||
      filters.muted ||
      filters.pinned
    );
  }, [filters]);

  // Handlers - only one filter can be active at a time (mutually exclusive)
  const handleBlockedToggle = useCallback(() => {
    void selectionHaptic();
    onFiltersChange({
      ...DEFAULT_CHAT_FILTERS,
      blocked: !filters.blocked,
    });
  }, [filters, onFiltersChange]);

  const handleUnreadToggle = useCallback(() => {
    void selectionHaptic();
    onFiltersChange({
      ...DEFAULT_CHAT_FILTERS,
      unread: !filters.unread,
    });
  }, [filters, onFiltersChange]);

  const handleFavoritesToggle = useCallback(() => {
    void selectionHaptic();
    onFiltersChange({
      ...DEFAULT_CHAT_FILTERS,
      favorites: !filters.favorites,
    });
  }, [filters, onFiltersChange]);

  const handleArchivedToggle = useCallback(() => {
    void selectionHaptic();
    onFiltersChange({
      ...DEFAULT_CHAT_FILTERS,
      archived: !filters.archived,
    });
  }, [filters, onFiltersChange]);

  const handleMutedToggle = useCallback(() => {
    void selectionHaptic();
    onFiltersChange({
      ...DEFAULT_CHAT_FILTERS,
      muted: !filters.muted,
    });
  }, [filters, onFiltersChange]);

  const handlePinnedToggle = useCallback(() => {
    void selectionHaptic();
    onFiltersChange({
      ...DEFAULT_CHAT_FILTERS,
      pinned: !filters.pinned,
    });
  }, [filters, onFiltersChange]);

  const handleReset = useCallback(() => {
    void lightHaptic();
    onReset?.();
  }, [onReset]);

  // Define filter chip configurations
  type FilterChipConfig = {
    key: string;
    label: string;
    isActive: boolean;
    onPress: () => void;
    icon: keyof typeof Ionicons.glyphMap;
  };

  const filterChipConfigs: FilterChipConfig[] = useMemo(
    () => [
      // Blocked Toggle
      {
        key: 'blocked',
        label: t('chat.filters.blocked' as TranslationKey),
        isActive: filters.blocked,
        onPress: handleBlockedToggle,
        icon: filters.blocked ? 'ban' : 'ban-outline',
      },
      // Unread Toggle
      {
        key: 'unread',
        label: t('chat.filters.unread' as TranslationKey),
        isActive: filters.unread,
        onPress: handleUnreadToggle,
        icon: filters.unread ? 'mail-unread' : 'mail-unread-outline',
      },
      // Favorites Toggle
      {
        key: 'favorites',
        label: t('chat.filters.favorites' as TranslationKey),
        isActive: filters.favorites,
        onPress: handleFavoritesToggle,
        icon: filters.favorites ? 'heart' : 'heart-outline',
      },
      // Archived Toggle
      {
        key: 'archived',
        label: t('chat.filters.archived' as TranslationKey),
        isActive: filters.archived,
        onPress: handleArchivedToggle,
        icon: filters.archived ? 'archive' : 'archive-outline',
      },
      // Muted Toggle
      {
        key: 'muted',
        label: t('chat.filters.muted' as TranslationKey),
        isActive: filters.muted,
        onPress: handleMutedToggle,
        icon: filters.muted ? 'volume-mute' : 'volume-mute-outline',
      },
      // Pinned Toggle
      {
        key: 'pinned',
        label: t('chat.filters.pinned' as TranslationKey),
        isActive: filters.pinned,
        onPress: handlePinnedToggle,
        icon: filters.pinned ? 'pin' : 'pin-outline',
      },
    ],
    [
      t,
      filters,
      handleBlockedToggle,
      handleUnreadToggle,
      handleFavoritesToggle,
      handleArchivedToggle,
      handleMutedToggle,
      handlePinnedToggle,
    ]
  );

  // Sort chips: active filters first when hasActiveFilters is true
  const sortedFilterChips = useMemo(() => {
    if (!hasActiveFilters) {
      return filterChipConfigs;
    }
    // Move active filters to the front, keep relative order within each group
    const activeChips = filterChipConfigs.filter(chip => chip.isActive);
    const inactiveChips = filterChipConfigs.filter(chip => !chip.isActive);
    return [...activeChips, ...inactiveChips];
  }, [filterChipConfigs, hasActiveFilters]);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
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
              {t('chat.filters.reset' as TranslationKey)}
            </Text>
          </TouchableOpacity>
        )}

        {/* Filter Chips - sorted with active filters first when filters are active */}
        {sortedFilterChips.map(chip => (
          <FilterChip
            key={chip.key}
            label={chip.label}
            isActive={chip.isActive}
            onPress={chip.onPress}
            isDark={isDark}
            icon={chip.icon}
          />
        ))}
      </ScrollView>
    </View>
  );
});

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
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
  chipIcon: {
    marginRight: 2,
  },
  resetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingPixels[3],
    paddingVertical: spacingPixels[1.5],
    borderRadius: radiusPixels.full,
    borderWidth: 1,
    gap: spacingPixels[1],
  },
});

export default ChatFiltersBar;
