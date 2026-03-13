/**
 * ConversationItem Component
 * A single conversation row in the Inbox/Conversations list
 * Includes online status indicator for direct messages and pin/mute status
 */

import React, { memo } from 'react';
import { View, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import { spacingPixels, fontSizePixels, primary, neutral } from '@rallia/design-system';
import type { ConversationPreview } from '@rallia/shared-services';
import { SportIcon } from '../../../components/SportIcon';

interface ConversationItemProps {
  conversation: ConversationPreview;
  onPress: () => void;
  onLongPress?: () => void;
  isBlocked?: boolean;
}

// Format time for display
function formatTime(dateString: string | null): string {
  if (!dateString) return '';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else {
    return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  }
}

// Format last seen for display
function formatLastSeen(dateString: string | null | undefined): string {
  if (!dateString) return '';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

// Translation function type that accepts any key (for internal use)
type TranslateFn = (key: string, options?: Record<string, string | number | boolean>) => string;

// Map conversation type to a specific fallback icon
function getIconForType(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'direct':
      return 'person';
    case 'group_chat':
      return 'people';
    case 'player_group':
      return 'people-circle';
    case 'community':
      return 'earth';
    case 'club':
      return 'business';
    case 'announcement':
      return 'megaphone';
    default:
      return 'people';
  }
}

// Get conversation display info
function getConversationInfo(
  conversation: ConversationPreview,
  t: TranslateFn
): {
  name: string;
  avatar: string | null;
  iconName: keyof typeof Ionicons.glyphMap;
  useSportIcon: boolean;
  isOnline: boolean;
  lastSeen: string | null;
} {
  if (conversation.conversation_type === 'direct' && conversation.other_participant) {
    const participant = conversation.other_participant;
    const name = participant.last_name
      ? `${participant.first_name} ${participant.last_name}`
      : participant.first_name;
    return {
      name,
      avatar: participant.profile_picture_url,
      iconName: 'person',
      useSportIcon: false,
      isOnline: participant.is_online ?? false,
      lastSeen: participant.last_seen_at ?? null,
    };
  }

  // Group or other conversation types
  return {
    name: conversation.title || t('chat.conversation.groupChat'),
    avatar: conversation.cover_image_url || null,
    iconName: getIconForType(conversation.conversation_type),
    useSportIcon: conversation.conversation_type === 'match',
    isOnline: false,
    lastSeen: null,
  };
}

function ConversationItemComponent({
  conversation,
  onPress,
  onLongPress,
  isBlocked = false,
}: ConversationItemProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  // Cast t to TranslateFn for getConversationInfo which uses dynamic keys
  const { name, avatar, iconName, useSportIcon, isOnline, lastSeen } = getConversationInfo(
    conversation,
    t as TranslateFn
  );
  const hasUnread = conversation.unread_count > 0;
  const isPinned = conversation.is_pinned ?? false;
  const isMuted = conversation.is_muted ?? false;

  // Build preview message
  let previewText = '';
  let isBlockedPreview = false;

  if (isBlocked && conversation.conversation_type === 'direct') {
    // Show blocked message for direct chats where user has blocked the other person
    previewText = t('chat.conversation.blockedUser');
    isBlockedPreview = true;
  } else if (conversation.last_message_content) {
    if (conversation.conversation_type !== 'direct' && conversation.last_message_sender_name) {
      previewText = `${conversation.last_message_sender_name}: ${conversation.last_message_content}`;
    } else {
      previewText = conversation.last_message_content;
    }
  }

  return (
    <TouchableOpacity
      style={[
        styles.container,
        isPinned && {
          backgroundColor: isDark ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.05)',
        },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      {/* Avatar with Online Indicator */}
      <View style={styles.avatarContainer}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarPlaceholder, { backgroundColor: primary[100] }]}>
            {useSportIcon ? (
              <SportIcon sportName="tennis" size={24} color={primary[500]} />
            ) : (
              <Ionicons name={iconName} size={24} color={primary[500]} />
            )}
          </View>
        )}

        {/* Online Status Indicator */}
        {conversation.conversation_type === 'direct' && isOnline && (
          <View style={[styles.onlineIndicatorRing, { backgroundColor: colors.background }]}>
            <View style={styles.onlineIndicatorDot} />
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.nameRow}>
            {isPinned && (
              <Ionicons name="pin" size={14} color={primary[500]} style={styles.pinIcon} />
            )}
            <Text
              style={[styles.name, { color: colors.text, fontWeight: hasUnread ? '700' : '600' }]}
              numberOfLines={1}
            >
              {name}
            </Text>
          </View>
          <View style={styles.timeRow}>
            {isMuted && (
              <Ionicons
                name="notifications-off"
                size={14}
                color={neutral[400]}
                style={styles.muteIcon}
              />
            )}
            <Text style={[styles.time, { color: colors.textMuted }]}>
              {formatTime(conversation.last_message_at)}
            </Text>
          </View>
        </View>

        <View style={styles.bottomRow}>
          <Text
            style={[
              styles.preview,
              {
                color: isBlockedPreview ? '#EF4444' : hasUnread ? colors.text : colors.textMuted,
                fontWeight: hasUnread ? '500' : undefined,
                fontStyle: isBlockedPreview ? 'italic' : 'normal',
              },
            ]}
            numberOfLines={1}
          >
            {previewText ||
              (isOnline
                ? t('chat.conversation.online')
                : lastSeen
                  ? t('chat.conversation.lastSeen', { time: formatLastSeen(lastSeen) })
                  : t('chat.conversation.noMessages'))}
          </Text>

          {/* Unread badge */}
          {hasUnread && (
            <View style={[styles.unreadBadge, { backgroundColor: '#EF4444' }]}>
              <Text style={styles.unreadText}>
                {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export const ConversationItem = memo(ConversationItemComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[3],
    alignItems: 'center',
  },
  avatarContainer: {
    marginRight: spacingPixels[3],
    position: 'relative',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineIndicatorRing: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineIndicatorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22C55E',
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacingPixels[2],
  },
  pinIcon: {
    marginRight: spacingPixels[1],
  },
  name: {
    fontSize: fontSizePixels.base,
    flex: 1,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  muteIcon: {
    marginRight: spacingPixels[1],
  },
  time: {
    fontSize: fontSizePixels.sm,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  preview: {
    fontSize: fontSizePixels.sm,
    flex: 1,
    marginRight: spacingPixels[2],
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  unreadText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 20,
    includeFontPadding: false,
  },
});
