/**
 * MessageInput Component
 * Text + attachments composer for sending messages.
 *
 * Picks build a local-only `pendingAttachments` list — no network until send.
 * On send, the raw local files are handed to the parent (which uploads them
 * via the optimistic `useSendMessageWithUploads` hook).
 */

import React, { useState, useCallback, useRef, memo, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Image,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { SheetManager } from 'react-native-actions-sheet';
import { Text, useToast } from '@rallia/shared-components';
import {
  spacingPixels,
  fontSizePixels,
  primary,
  neutral,
  radiusPixels,
} from '@rallia/design-system';
import type { MessageWithSender } from '@rallia/shared-services';
import type { LocalChatAttachment } from '@rallia/shared-hooks';

import { useThemeStyles, useTranslation } from '../../../hooks';
import {
  validateChatAttachmentFile,
  type ChatAttachmentKind,
  CHAT_ATTACHMENT_MAX_SIZE,
} from '../../../services/chatAttachmentUpload';
import { compressForChat } from '../../../services/mediaCompression';

const PHOTO_LIBRARY_LIMIT = 10;

interface PendingAttachment {
  localId: string;
  uri: string;
  thumbnailUri: string | null;
  kind: ChatAttachmentKind;
  mimeType: string;
  size: number;
  originalName: string;
  /** True while background compression is running for this pick. */
  compressing: boolean;
}

interface MessageInputProps {
  onSend: (message: string, replyToMessageId?: string, attachments?: LocalChatAttachment[]) => void;
  placeholder?: string;
  disabled?: boolean;
  replyToMessage?: MessageWithSender | null;
  onCancelReply?: () => void;
  onTypingChange?: (isTyping: boolean) => void;
  /** When true, bottom padding is reduced to avoid gap above keyboard. */
  keyboardVisible?: boolean;
}

function makeLocalId(): string {
  return `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function inferKindFromMime(mime: string): ChatAttachmentKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

function bytesToMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function MessageInputComponent({
  onSend,
  placeholder,
  disabled = false,
  replyToMessage,
  onCancelReply,
  onTypingChange,
  keyboardVisible = false,
}: MessageInputProps) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const inputRef = useRef<TextInput>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wasTypingRef = useRef(false);

  const computedPlaceholder = placeholder ?? t('chat.input.attach');

  // ============================================================================
  // Typing indicator
  // ============================================================================

  const handleTextChange = useCallback(
    (text: string) => {
      setMessage(text);
      if (!onTypingChange) return;

      const isTyping = text.length > 0;
      if (isTyping && !wasTypingRef.current) {
        onTypingChange(true);
        wasTypingRef.current = true;
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTyping) {
        typingTimeoutRef.current = setTimeout(() => {
          onTypingChange(false);
          wasTypingRef.current = false;
        }, 2000);
      } else {
        onTypingChange(false);
        wasTypingRef.current = false;
      }
    },
    [onTypingChange]
  );

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (wasTypingRef.current && onTypingChange) onTypingChange(false);
    };
  }, [onTypingChange]);

  // ============================================================================
  // Pending attachments — pick / remove (local only, no upload)
  // ============================================================================

  const addAttachment = useCallback(
    (
      base: Omit<PendingAttachment, 'localId' | 'thumbnailUri' | 'compressing'> & {
        thumbnailUri?: string | null;
      }
    ) => {
      const validation = validateChatAttachmentFile(base.originalName, base.size, base.kind);
      if (!validation.valid) {
        toast.error(
          validation.error?.includes('limit')
            ? t('chat.input.attachment.tooLarge', {
                name: base.originalName,
                size: bytesToMB(CHAT_ATTACHMENT_MAX_SIZE[base.kind]),
              })
            : (validation.error ?? t('chat.input.attachment.uploadFailed'))
        );
        return;
      }

      const willCompress = base.kind === 'image' || base.kind === 'video';
      const item: PendingAttachment = {
        localId: makeLocalId(),
        uri: base.uri,
        thumbnailUri: base.thumbnailUri ?? null,
        kind: base.kind,
        mimeType: base.mimeType,
        size: base.size,
        originalName: base.originalName,
        compressing: willCompress,
      };
      setPendingAttachments(prev => [...prev, item]);

      // Generate video thumbnail in the background for nicer previews.
      if (item.kind === 'video') {
        void VideoThumbnails.getThumbnailAsync(item.uri, { time: 500, quality: 0.6 })
          .then(({ uri: thumbUri }) => {
            setPendingAttachments(prev =>
              prev.map(a => (a.localId === item.localId ? { ...a, thumbnailUri: thumbUri } : a))
            );
          })
          .catch(() => undefined);
      }

      // Compress in the background. The chip stays visible the whole time;
      // remove still works mid-compression. If the user hits send before
      // compression finishes, the in-flight chip is just skipped.
      if (willCompress) {
        void compressForChat(item.kind, item.uri, item.mimeType, item.size)
          .then(result => {
            setPendingAttachments(prev =>
              prev.map(a =>
                a.localId === item.localId
                  ? {
                      ...a,
                      uri: result.uri,
                      size: result.size,
                      mimeType: result.mimeType,
                      compressing: false,
                    }
                  : a
              )
            );
          })
          .catch(() => {
            setPendingAttachments(prev =>
              prev.map(a => (a.localId === item.localId ? { ...a, compressing: false } : a))
            );
          });
      }
    },
    [t, toast]
  );

  const removeAttachment = useCallback((localId: string) => {
    setPendingAttachments(prev => prev.filter(a => a.localId !== localId));
  }, []);

  // ============================================================================
  // Picker callbacks
  // ============================================================================

  const ensureCameraPermissions = useCallback(async () => {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    return cam.status === ImagePicker.PermissionStatus.GRANTED;
  }, []);

  const handleTakePhoto = useCallback(async () => {
    const ok = await ensureCameraPermissions();
    if (!ok) {
      toast.error(t('errors.permissionsDenied'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    addAttachment({
      uri: asset.uri,
      kind: 'image',
      mimeType: asset.mimeType ?? 'image/jpeg',
      size: asset.fileSize ?? 0,
      originalName: asset.fileName ?? `photo-${Date.now()}.jpg`,
    });
  }, [addAttachment, ensureCameraPermissions, t, toast]);

  const handleRecordVideo = useCallback(async () => {
    const ok = await ensureCameraPermissions();
    if (!ok) {
      toast.error(t('errors.permissionsDenied'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: 60,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    addAttachment({
      uri: asset.uri,
      kind: 'video',
      mimeType: asset.mimeType ?? 'video/mp4',
      size: asset.fileSize ?? 0,
      originalName: asset.fileName ?? `video-${Date.now()}.mp4`,
    });
  }, [addAttachment, ensureCameraPermissions, t, toast]);

  const handlePickFromLibrary = useCallback(async () => {
    const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (lib.status !== ImagePicker.PermissionStatus.GRANTED) {
      toast.error(t('errors.permissionsDenied'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: PHOTO_LIBRARY_LIMIT,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    for (const asset of result.assets) {
      const isVideo = asset.type === 'video' || (asset.mimeType ?? '').startsWith('video/');
      addAttachment({
        uri: asset.uri,
        kind: isVideo ? 'video' : 'image',
        mimeType: asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
        size: asset.fileSize ?? 0,
        originalName: asset.fileName ?? `${isVideo ? 'video' : 'photo'}-${Date.now()}`,
      });
    }
  }, [addAttachment, t, toast]);

  const handlePickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      type: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'text/csv',
        'application/rtf',
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    for (const asset of result.assets) {
      addAttachment({
        uri: asset.uri,
        kind: inferKindFromMime(asset.mimeType ?? 'application/octet-stream'),
        mimeType: asset.mimeType ?? 'application/octet-stream',
        size: asset.size ?? 0,
        originalName: asset.name,
      });
    }
  }, [addAttachment]);

  const handleOpenAttachmentPicker = useCallback(() => {
    if (disabled) return;
    void SheetManager.show('attachment-picker', {
      payload: {
        onSelect: option => {
          if (option === 'photo') void handleTakePhoto();
          else if (option === 'video') void handleRecordVideo();
          else if (option === 'library') void handlePickFromLibrary();
          else void handlePickDocument();
        },
      },
    });
  }, [disabled, handlePickDocument, handlePickFromLibrary, handleRecordVideo, handleTakePhoto]);

  // ============================================================================
  // Send
  // ============================================================================

  const trimmedMessage = message.trim();
  const canSend = !disabled && (trimmedMessage.length > 0 || pendingAttachments.length > 0);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const content = trimmedMessage;
    const attachments: LocalChatAttachment[] = pendingAttachments.map(a => ({
      localId: a.localId,
      uri: a.uri,
      thumbnailUri: a.thumbnailUri,
      kind: a.kind,
      mimeType: a.mimeType,
      size: a.size,
      originalName: a.originalName,
    }));

    if (onTypingChange && wasTypingRef.current) {
      onTypingChange(false);
      wasTypingRef.current = false;
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    onSend(content, replyToMessage?.id, attachments.length > 0 ? attachments : undefined);
    setMessage('');
    setPendingAttachments([]);
    onCancelReply?.();
    // Only refocus if the user was actively typing — sending an attachment
    // alone shouldn't pop the keyboard up.
    if (content.length > 0) {
      inputRef.current?.focus();
    }
  }, [
    canSend,
    onCancelReply,
    onSend,
    onTypingChange,
    pendingAttachments,
    replyToMessage?.id,
    trimmedMessage,
  ]);

  // ============================================================================
  // Render
  // ============================================================================

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
              {replyToMessage.content ?? ''}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              onCancelReply?.();
            }}
            style={styles.cancelReplyButton}
          >
            <Ionicons name="close-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Pending attachments preview */}
      {pendingAttachments.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pendingRow}
        >
          {pendingAttachments.map(att => (
            <View key={att.localId} style={styles.pendingTile}>
              {att.kind === 'document' ? (
                <View
                  style={[
                    styles.pendingTileBg,
                    { backgroundColor: isDark ? colors.card : neutral[100] },
                  ]}
                >
                  <Ionicons name="document-text" size={28} color={primary[500]} />
                  <Text
                    size="xs"
                    color={colors.textMuted}
                    numberOfLines={1}
                    style={styles.pendingDocName}
                  >
                    {att.originalName}
                  </Text>
                </View>
              ) : att.thumbnailUri || att.kind === 'image' ? (
                <Image source={{ uri: att.thumbnailUri || att.uri }} style={styles.pendingThumb} />
              ) : (
                <View
                  style={[
                    styles.pendingTileBg,
                    { backgroundColor: isDark ? colors.card : neutral[200] },
                  ]}
                >
                  <Ionicons name="videocam" size={28} color={primary[500]} />
                </View>
              )}

              {att.kind === 'video' && !att.compressing && (
                <View style={styles.pendingPlayPill}>
                  <Ionicons name="play" size={14} color="#FFFFFF" />
                </View>
              )}

              {att.compressing && (
                <View style={styles.pendingOverlay}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              )}

              <TouchableOpacity
                style={styles.pendingClose}
                onPress={() => removeAttachment(att.localId)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('chat.input.attachment.remove')}
              >
                <Ionicons name="close" size={14} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.inputRow}>
        <TouchableOpacity
          onPress={handleOpenAttachmentPicker}
          disabled={disabled}
          style={[styles.attachButton, { backgroundColor: isDark ? colors.card : neutral[100] }]}
          accessibilityRole="button"
          accessibilityLabel={t('chat.input.attach')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="add" size={24} color={disabled ? colors.textMuted : primary[500]} />
        </TouchableOpacity>

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
            onChangeText={handleTextChange}
            placeholder={
              pendingAttachments.length > 0
                ? t('chat.input.attachmentPicker.title')
                : computedPlaceholder
            }
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={2000}
            editable={!disabled}
            returnKeyType="default"
          />

          <TouchableOpacity
            style={[styles.sendButton, canSend && { backgroundColor: primary[500] }]}
            onPress={handleSend}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={t('common.send')}
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

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacingPixels[3],
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
  pendingRow: {
    paddingBottom: spacingPixels[2],
    paddingRight: spacingPixels[2],
  },
  pendingTile: {
    width: 80,
    height: 80,
    borderRadius: radiusPixels.md,
    marginRight: spacingPixels[2],
    overflow: 'hidden',
    position: 'relative',
  },
  pendingTileBg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacingPixels[1],
  },
  pendingThumb: {
    width: '100%',
    height: '100%',
    backgroundColor: neutral[200],
  },
  pendingDocName: {
    marginTop: spacingPixels[1],
    textAlign: 'center',
  },
  pendingPlayPill: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  pendingClose: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  attachButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[2],
    marginBottom: 3,
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
