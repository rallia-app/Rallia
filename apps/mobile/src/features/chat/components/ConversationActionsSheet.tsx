/**
 * ConversationActionsSheet Component
 * Bottom sheet for conversation actions (pin, mute, archive, delete)
 */

import React, { memo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@rallia/shared-components';
import { isGroupConversationType } from '@rallia/shared-services';
import { useThemeStyles, useTranslation } from '../../../hooks';
import {
  spacingPixels,
  fontSizePixels,
  primary,
  neutral,
  status,
  radiusPixels,
} from '@rallia/design-system';

function ConversationActionsSheetComponent({ payload }: SheetProps<'conversation-actions'>) {
  const conversation = payload?.conversation ?? null;
  const onTogglePin = payload?.onTogglePin;
  const onToggleMute = payload?.onToggleMute;
  const onToggleArchive = payload?.onToggleArchive;
  const onLeave = payload?.onLeave;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();

  const handleClose = useCallback(() => {
    SheetManager.hide('conversation-actions');
  }, []);

  if (!conversation) return null;

  const isPinned = conversation.is_pinned ?? false;
  const isMuted = conversation.is_muted ?? false;
  const isArchived = conversation.is_archived ?? false;
  const isGroup = isGroupConversationType(conversation.conversation_type);

  // Get conversation name for display
  const conversationName =
    conversation.conversation_type === 'direct' && conversation.other_participant
      ? `${conversation.other_participant.first_name}${conversation.other_participant.last_name ? ' ' + conversation.other_participant.last_name : ''}`
      : conversation.title || t('chat.actions.conversation');

  type ActionItem = {
    id: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    destructive?: boolean;
    show?: boolean;
  };

  const actions: ActionItem[] = [
    {
      id: 'pin',
      label: isPinned ? t('chat.actions.unpin') : t('chat.actions.pin'),
      icon: isPinned ? 'pin-outline' : 'pin',
      onPress: () => {
        onTogglePin?.();
        handleClose();
      },
    },
    {
      id: 'mute',
      label: isMuted ? t('chat.actions.unmute') : t('chat.actions.mute'),
      icon: isMuted ? 'notifications' : 'notifications-off',
      onPress: () => {
        onToggleMute?.();
        handleClose();
      },
    },
    {
      id: 'archive',
      label: isArchived ? t('chat.actions.unarchive') : t('chat.actions.archive'),
      icon: isArchived ? 'archive-outline' : 'archive',
      onPress: () => {
        onToggleArchive?.();
        handleClose();
      },
    },
    {
      id: 'leave',
      label: t('chat.actions.leaveGroup'),
      icon: 'exit',
      onPress: () => {
        onLeave?.();
        handleClose();
      },
      destructive: true,
      show: isGroup && !!onLeave,
    },
  ];

  const visibleActions = actions.filter(action => action.show !== false);

  return (
    <ActionSheet
      gestureEnabled
      containerStyle={[
        styles.sheetBackground,
        { backgroundColor: isDark ? colors.card : '#FFFFFF' },
      ]}
      indicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
    >
      <View style={styles.sheet}>
        {/* Conversation Name Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerText, { color: colors.text }]} numberOfLines={1}>
            {conversationName}
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          {visibleActions.map((action, index) => (
            <TouchableOpacity
              key={action.id}
              style={[
                styles.actionItem,
                index < visibleActions.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                },
              ]}
              onPress={action.onPress}
              activeOpacity={0.7}
            >
              <Ionicons
                name={action.icon}
                size={22}
                color={action.destructive ? status.error.DEFAULT : primary[500]}
                style={styles.actionIcon}
              />
              <Text
                style={[
                  styles.actionLabel,
                  { color: action.destructive ? status.error.DEFAULT : colors.text },
                ]}
              >
                {action.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Sticky Footer - Cancel */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.cancelButton, { backgroundColor: isDark ? neutral[800] : neutral[100] }]}
            onPress={handleClose}
            activeOpacity={0.7}
          >
            <Text size="lg" weight="semibold" color={colors.text}>
              {t('common.cancel')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ActionSheet>
  );
}

export const ConversationActionsActionSheet = memo(ConversationActionsSheetComponent);

// Keep old export for backwards compatibility during migration
export const ConversationActionsSheet = ConversationActionsActionSheet;

const styles = StyleSheet.create({
  sheetBackground: {
    borderTopLeftRadius: radiusPixels['2xl'],
    borderTopRightRadius: radiusPixels['2xl'],
  },
  handleIndicator: {
    width: spacingPixels[10],
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  sheet: {
    paddingTop: spacingPixels[4],
  },
  header: {
    paddingHorizontal: spacingPixels[5],
    paddingBottom: spacingPixels[3],
    marginBottom: spacingPixels[2],
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  headerText: {
    fontSize: fontSizePixels.lg,
    fontWeight: '600',
  },
  actionsContainer: {
    paddingHorizontal: spacingPixels[4],
    marginBottom: spacingPixels[3],
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[3],
  },
  actionIcon: {
    marginRight: spacingPixels[3],
    width: 24,
  },
  actionLabel: {
    fontSize: fontSizePixels.base,
  },
  footer: {
    paddingTop: spacingPixels[4],
    paddingBottom: spacingPixels[4],
    borderTopWidth: 1,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacingPixels[4],
    paddingVertical: spacingPixels[4],
    borderRadius: radiusPixels.lg,
    gap: spacingPixels[2],
  },
});
