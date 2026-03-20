/**
 * MessageActionsSheet Component
 * Bottom sheet for message actions (react, reply, edit, delete, copy)
 * Includes integrated emoji picker for reactions
 */

import React, { memo, useCallback, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import ActionSheet, { SheetManager, SheetProps } from 'react-native-actions-sheet';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@rallia/shared-components';
import { useThemeStyles, useTranslation } from '../../../hooks';
import {
  spacingPixels,
  fontSizePixels,
  primary,
  neutral,
  status,
  radiusPixels,
} from '@rallia/design-system';
import { EmojiReactionPicker } from './EmojiReactionPicker';

type ActionItem = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
  ownOnly?: boolean;
};

function MessageActionsSheetComponent({ payload }: SheetProps<'message-actions'>) {
  const message = payload?.message ?? null;
  const isOwnMessage = payload?.isOwnMessage ?? false;
  const onReply = payload?.onReply;
  const onEdit = payload?.onEdit;
  const onDelete = payload?.onDelete;
  const onReact = payload?.onReact;
  const messageY = payload?.messageY;

  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const handleClose = useCallback(() => {
    setShowEmojiPicker(false);
    SheetManager.hide('message-actions');
  }, []);

  const handleCopy = useCallback(async () => {
    if (message?.content) {
      await Clipboard.setStringAsync(message.content);
    }
    handleClose();
  }, [message, handleClose]);

  const handleReply = useCallback(() => {
    onReply?.();
    handleClose();
  }, [onReply, handleClose]);

  const handleEdit = useCallback(() => {
    onEdit?.();
    handleClose();
  }, [onEdit, handleClose]);

  const handleDelete = useCallback(() => {
    onDelete?.();
    handleClose();
  }, [onDelete, handleClose]);

  const handleShowEmojiPicker = useCallback(() => {
    setShowEmojiPicker(true);
    // Don't hide the sheet - just show emoji picker on top
    // The sheet content will be hidden when showEmojiPicker is true
  }, []);

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      setShowEmojiPicker(false);
      onReact?.(emoji);
      // Close the sheet after selecting an emoji
      SheetManager.hide('message-actions');
    },
    [onReact]
  );

  const handleCloseEmojiPicker = useCallback(() => {
    setShowEmojiPicker(false);
    // Close the entire sheet when emoji picker is dismissed
    SheetManager.hide('message-actions');
  }, []);

  const actions: ActionItem[] = [
    {
      id: 'react',
      label: t('chat.messageActions.addReaction'),
      icon: 'happy-outline',
      onPress: handleShowEmojiPicker,
    },
    {
      id: 'reply',
      label: t('chat.messageActions.reply'),
      icon: 'arrow-undo',
      onPress: handleReply,
    },
    {
      id: 'copy',
      label: t('chat.messageActions.copy'),
      icon: 'copy',
      onPress: handleCopy,
    },
    {
      id: 'edit',
      label: t('chat.messageActions.edit'),
      icon: 'pencil',
      onPress: handleEdit,
      ownOnly: true,
    },
    {
      id: 'delete',
      label: t('chat.messageActions.delete'),
      icon: 'trash',
      onPress: handleDelete,
      destructive: true,
      ownOnly: true,
    },
  ];

  // Filter actions based on ownership
  const visibleActions = actions.filter(action => !action.ownOnly || isOwnMessage);

  if (!message) return null;

  return (
    <>
      <ActionSheet
        gestureEnabled={!showEmojiPicker}
        containerStyle={[
          styles.sheetBackground,
          { backgroundColor: isDark ? colors.card : '#FFFFFF' },
          // Hide sheet content when emoji picker is shown
          showEmojiPicker && { height: 0, opacity: 0 },
        ]}
        indicatorStyle={[
          styles.handleIndicator,
          { backgroundColor: colors.border },
          showEmojiPicker && { opacity: 0 },
        ]}
      >
        <View style={styles.sheet}>
          {/* Message Preview */}
          <View style={[styles.preview, { borderBottomColor: colors.border }]}>
            <Text style={[styles.previewText, { color: colors.textMuted }]} numberOfLines={2}>
              {message.content}
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
              style={[
                styles.cancelButton,
                { backgroundColor: isDark ? neutral[800] : neutral[100] },
              ]}
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

      {/* Emoji Reaction Picker - shown when "Add Reaction" is tapped */}
      <EmojiReactionPicker
        visible={showEmojiPicker}
        onSelect={handleEmojiSelect}
        onClose={handleCloseEmojiPicker}
        anchorY={messageY}
        isOwnMessage={isOwnMessage}
      />
    </>
  );
}

export const MessageActionsActionSheet = memo(MessageActionsSheetComponent);

// Keep old export for backwards compatibility during migration
export const MessageActionsSheet = MessageActionsActionSheet;

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
  preview: {
    paddingHorizontal: spacingPixels[4],
    paddingBottom: spacingPixels[3],
    marginBottom: spacingPixels[2],
    borderBottomWidth: 1,
  },
  previewText: {
    fontSize: fontSizePixels.sm,
    fontStyle: 'italic',
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
