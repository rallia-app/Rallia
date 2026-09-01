/**
 * ConversationFilterChips Component
 * Horizontally scrollable filter chips for the chat inbox.
 * Single-select — tapping another chip switches filter; tapping "All" clears.
 * Mixes chat-type filters (server-side via RPC) and status filters (client-side).
 * The "Archived" chip is a navigation shortcut — it calls onArchivedPress instead of toggling.
 */

import { useCallback } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SelectableChip } from '@rallia/shared-components';
import type { ChatInboxFilter } from '@rallia/shared-types';
import type { TranslationKey } from '@rallia/shared-translations';
import { spacingPixels, base } from '@rallia/design-system';
import { Ionicons } from '@expo/vector-icons';

import { useThemeStyles, useTranslation } from '#/hooks';
import { lightHaptic } from '#/utils/haptics';
import { SportIcon } from '#/components/SportIcon';

// =============================================================================
// TYPES
// =============================================================================

interface ConversationFilterChipsProps {
  filter: ChatInboxFilter;
  onFilterChange: (filter: ChatInboxFilter) => void;
  unreadCount?: number;
}

interface FilterOption {
  value: ChatInboxFilter;
  labelKey: TranslationKey;
  icon?: keyof typeof Ionicons.glyphMap;
  useSportIcon?: boolean;
}

// =============================================================================
// FILTER OPTIONS (ordered by relevance/value)
// =============================================================================

const FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', labelKey: 'chat.filters.all' },
  { value: 'unread', labelKey: 'chat.filters.unread', icon: 'mail-unread-outline' },
  { value: 'direct', labelKey: 'chat.filters.direct', icon: 'chatbubble-outline' },
  { value: 'match', labelKey: 'chat.filters.match', useSportIcon: true },
  { value: 'tournament', labelKey: 'chat.filters.tournament', icon: 'podium-outline' },
  { value: 'group_chat', labelKey: 'chat.filters.groupChat', icon: 'people-outline' },
  { value: 'community', labelKey: 'chat.filters.community', icon: 'earth-outline' },
  { value: 'pinned', labelKey: 'chat.filters.pinned', icon: 'pin-outline' },
  { value: 'favorites', labelKey: 'chat.filters.favorites', icon: 'heart-outline' },
  { value: 'muted', labelKey: 'chat.filters.muted', icon: 'volume-mute-outline' },
  { value: 'blocked', labelKey: 'chat.filters.blocked', icon: 'ban-outline' },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ConversationFilterChips({
  filter,
  onFilterChange,
  unreadCount,
}: ConversationFilterChipsProps) {
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const getLabel = useCallback((labelKey: TranslationKey): string => t(labelKey), [t]);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {FILTER_OPTIONS.map(option => {
          const isActive = filter === option.value;
          const iconColor = isActive ? base.white : colors.textMuted;
          const showIcon = option.value !== 'all';

          const handlePress = () => {
            void lightHaptic();
            // Single-select: tapping the active chip clears to 'all'
            if (isActive && option.value !== 'all') {
              onFilterChange('all');
              return;
            }
            onFilterChange(option.value);
          };

          return (
            <SelectableChip
              key={option.value}
              label={getLabel(option.labelKey)}
              selected={isActive}
              onPress={handlePress}
              animateOnPress
              badge={option.value === 'unread' ? unreadCount : undefined}
              icon={
                showIcon && option.useSportIcon ? (
                  <SportIcon sportName="tennis" size={14} color={iconColor} />
                ) : showIcon && option.icon ? (
                  <Ionicons name={option.icon} size={14} color={iconColor} />
                ) : undefined
              }
            />
          );
        })}
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
});
