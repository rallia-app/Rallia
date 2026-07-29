/**
 * MessageInput Component
 * Text input for sending messages with reply functionality
 */

import React, { useState, useCallback, useRef, memo } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, fontSizePixels, primary, neutral } from '@rallia/design-system';
import type { MessageWithSender } from '@rallia/shared-services';

import { useThemeStyles, useTranslation } from '#/hooks';

interface MessageInputProps {
  onSend: (message: string, replyToMessageId?: string) => void;
  placeholder?: string;
  disabled?: boolean;
  replyToMessage?: MessageWithSender | null;
  onCancelReply?: () => void;
  /** When true, bottom padding is reduced to avoid gap above keyboard (safe area already accounted for by system). */
  keyboardVisible?: boolean;
}

function MessageInputComponent({
  onSend,
  placeholder = 'Type your message',
  disabled = false,
  replyToMessage,
  onCancelReply,
  keyboardVisible = false,
}: MessageInputProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const inputRef = useRef<TextInput>(null);

  const handleSend = useCallback(() => {
    const trimmedMessage = message.trim();
    if (trimmedMessage && !disabled) {
      onSend(trimmedMessage, replyToMessage?.id);
      setMessage('');
      onCancelReply?.();
      // Keep keyboard open after sending
      inputRef.current?.focus();
    }
  }, [message, onSend, disabled, replyToMessage, onCancelReply]);

  const canSend = message.trim().length > 0 && !disabled;

  // Get reply preview sender name
  const replySenderName = replyToMessage?.sender?.profile
    ? `${replyToMessage.sender.profile.first_name || 'Unknown'}`
    : 'Unknown';

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? colors.background : '#FFFFFF',
          borderTopColor: colors.border,
          paddingBottom: keyboardVisible ? spacingPixels[2] : spacingPixels[8],
        },
      ]}
    >
      {/* Reply Banner */}
      {replyToMessage && (
        <View
          style={[styles.replyBanner, { backgroundColor: isDark ? colors.card : neutral[100] }]}
        >
          <View style={[styles.replyIndicator, { backgroundColor: primary[500] }]} />
          <View style={styles.replyContent}>
            <Text style={[styles.replySenderName, { color: primary[500] }]}>
              {t('chat.input.replyingTo', { name: replySenderName })}
            </Text>
            <Text style={[styles.replyPreview, { color: colors.textMuted }]} numberOfLines={1}>
              {replyToMessage.content}
            </Text>
          </View>
          <TouchableOpacity onPress={onCancelReply} style={styles.cancelReplyButton}>
            <Ionicons name="close-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputRow}>
        <View
          style={[styles.inputContainer, { backgroundColor: isDark ? colors.card : '#F0F0F0' }]}
        >
          <TextInput
            ref={inputRef}
            style={[
              styles.input,
              { color: colors.text },
              Platform.OS === 'android' && { textAlignVertical: 'center' },
            ]}
            value={message}
            onChangeText={setMessage}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={2000}
            editable={!disabled}
            returnKeyType="default"
          />

          {/* Send button */}
          <TouchableOpacity
            style={[styles.sendButton, canSend && { backgroundColor: primary[500] }]}
            onPress={handleSend}
            disabled={!canSend}
          >
            <Ionicons
              name="paper-plane-outline"
              size={18}
              color={canSend ? '#FFFFFF' : colors.textMuted}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export const MessageInput = memo(MessageInputComponent);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacingPixels[4],
    paddingTop: spacingPixels[2],
    paddingBottom: spacingPixels[6],
    borderTopWidth: 1,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2],
    paddingHorizontal: spacingPixels[3],
    marginBottom: spacingPixels[2],
    borderRadius: 8,
  },
  replyIndicator: {
    width: 3,
    height: '100%',
    minHeight: 32,
    borderRadius: 2,
    marginRight: spacingPixels[2],
  },
  replyContent: {
    flex: 1,
  },
  replySenderName: {
    fontSize: fontSizePixels.xs,
    fontWeight: '600',
    marginBottom: 2,
  },
  replyPreview: {
    fontSize: fontSizePixels.sm,
  },
  cancelReplyButton: {
    padding: spacingPixels[1],
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacingPixels[2],
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    paddingLeft: spacingPixels[4],
    paddingRight: spacingPixels[1],
    paddingVertical: spacingPixels[1],
    minHeight: 44,
  },
  input: {
    flex: 1,
    fontSize: fontSizePixels.base,
    maxHeight: 100,
    paddingVertical: Platform.OS === 'ios' ? spacingPixels[1.5] : spacingPixels[1],
    paddingHorizontal: 0,
    lineHeight: 20,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    marginLeft: spacingPixels[2],
  },
});
