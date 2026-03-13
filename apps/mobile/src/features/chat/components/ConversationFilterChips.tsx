/**
 * ConversationFilterChips Component
 * Horizontally scrollable filter chips for the chat inbox.
 * Single-select behavior — tapping active chip deselects to 'all'.
 * "Unread" chip shows a badge with the count of unread conversations.
 */

import { useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { Text } from '@rallia/shared-components';
import { useTheme } from '@rallia/shared-hooks';
import type { ConversationFilter } from '@rallia/shared-hooks';
import { useTranslation } from '../../../hooks';
import type { TranslationKey } from '@rallia/shared-translations';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import { Ionicons } from '@expo/vector-icons';
import { lightHaptic } from '../../../utils/haptics';
import { SportIcon } from '../../../components/SportIcon';

// =============================================================================
// TYPES
// =============================================================================

interface ConversationFilterChipsProps {
  filter: ConversationFilter;
  onFilterToggle: (filter: ConversationFilter) => void;
  unreadCount?: number;
}

interface FilterOption {
  value: ConversationFilter;
  labelKey: TranslationKey;
  icon?: keyof typeof Ionicons.glyphMap;
  useSportIcon?: boolean;
}

// =============================================================================
// FILTER OPTIONS
// =============================================================================

const FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', labelKey: 'chat.filters.all' },
  { value: 'unread', labelKey: 'chat.filters.unread', icon: 'mail-unread-outline' },
  { value: 'direct', labelKey: 'chat.filters.direct', icon: 'chatbubble-outline' },
  { value: 'match', labelKey: 'chat.filters.match', useSportIcon: true },
  { value: 'group_chat', labelKey: 'chat.filters.groupChat', icon: 'people-outline' },
  { value: 'player_group', labelKey: 'chat.filters.playerGroup', icon: 'people-circle-outline' },
  { value: 'community', labelKey: 'chat.filters.community', icon: 'earth-outline' },
];

// =============================================================================
// FILTER CHIP COMPONENT
// =============================================================================

interface ChipProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  isDark: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  useSportIcon?: boolean;
  isFirst?: boolean;
  badge?: number;
}

function FilterChip({
  label,
  isActive,
  onPress,
  isDark,
  icon,
  useSportIcon,
  isFirst,
  badge,
}: ChipProps) {
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
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, isFirst && styles.firstChip]}>
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
        {useSportIcon && (
          <SportIcon sportName="tennis" size={14} color={textColor} style={styles.chipIcon} />
        )}
        {icon && <Ionicons name={icon} size={14} color={textColor} style={styles.chipIcon} />}
        <Text size="xs" weight={isActive ? 'semibold' : 'medium'} color={textColor}>
          {label}
        </Text>
        {badge !== undefined && badge > 0 && (
          <View style={[styles.badge, { backgroundColor: isActive ? '#ffffff' : primary[500] }]}>
            <Text style={[styles.badgeText, { color: isActive ? primary[500] : '#ffffff' }]}>
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ConversationFilterChips({
  filter,
  onFilterToggle,
  unreadCount,
}: ConversationFilterChipsProps) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme === 'dark';

  const getLabel = useCallback((labelKey: TranslationKey): string => t(labelKey), [t]);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {FILTER_OPTIONS.map((option, index) => (
          <FilterChip
            key={option.value}
            label={getLabel(option.labelKey)}
            isActive={filter === option.value}
            onPress={() => onFilterToggle(option.value)}
            isDark={isDark}
            icon={option.value !== 'all' ? option.icon : undefined}
            useSportIcon={option.useSportIcon}
            isFirst={index === 0}
            badge={option.value === 'unread' ? unreadCount : undefined}
          />
        ))}
      </ScrollView>
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
  firstChip: {
    marginLeft: 0,
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
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacingPixels[1],
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 12,
    ...(Platform.OS === 'android' && { textAlignVertical: 'center' as const }),
  },
});
