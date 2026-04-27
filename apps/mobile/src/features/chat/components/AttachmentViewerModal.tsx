/**
 * AttachmentViewerModal
 *
 * Fullscreen viewer for chat attachments. Supports image, video, and
 * document kinds:
 *  - Images render with `Image` (defer pinch-zoom to a follow-up).
 *  - Videos render with expo-video's `VideoView` and native controls.
 *  - Documents auto-route through the system share sheet on open.
 *
 * Top toolbar offers Save (image/video → photo library) and Share
 * (everything → system share sheet) using the chatAttachmentDownload helper.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StatusBar,
  Dimensions,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Text, useToast } from '@rallia/shared-components';
import { spacingPixels, radiusPixels } from '@rallia/design-system';
import { createChatAttachmentSignedUrl, type ChatAttachment } from '@rallia/shared-services';

import { useTranslation } from '../../../hooks';
import {
  downloadAttachmentToDevice,
  shareAttachmentViaSystemSheet,
} from '../../../services/chatAttachmentDownload';

interface AttachmentViewerModalProps {
  attachments: ChatAttachment[];
  startIndex: number;
  onClose: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export function AttachmentViewerModal({
  attachments,
  startIndex,
  onClose,
}: AttachmentViewerModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [busy, setBusy] = useState(false);
  const flatListRef = useRef<FlatList<ChatAttachment>>(null);

  const current = attachments[currentIndex];

  // For documents, we don't have an in-app viewer; route to share sheet on
  // open and immediately close the modal.
  useEffect(() => {
    if (!current) return;
    if (current.file.file_type === 'document' || current.file.file_type === 'audio') {
      void shareAttachmentViaSystemSheet(current);
      onClose();
    }
    // intentionally only on the first render with this attachment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const handleSave = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    const result = await downloadAttachmentToDevice(current);
    setBusy(false);
    if (result.ok) {
      toast.success(t('chat.attachment.savedToPhotos'));
    } else if (result.reason === 'permission') {
      toast.error(t('chat.attachment.permissionDenied'));
    } else {
      toast.error(t('chat.attachment.downloadFailed'));
    }
  }, [busy, current, t, toast]);

  const handleShare = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    const result = await shareAttachmentViaSystemSheet(current);
    setBusy(false);
    if (!result.ok && result.reason !== 'cancelled' && result.reason !== 'unsupported') {
      toast.error(t('chat.attachment.downloadFailed'));
    }
  }, [busy, current, t, toast]);

  const onMomentumEnd = useCallback((event: { nativeEvent: { contentOffset: { x: number } } }) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setCurrentIndex(index);
  }, []);

  const keyExtractor = useCallback((item: ChatAttachment) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: ChatAttachment }) => <AttachmentPage attachment={item} />,
    []
  );

  if (!current) return null;
  // Documents are handed off to the share sheet immediately; render nothing
  // visible while the modal lifecycle unwinds.
  if (current.file.file_type === 'document' || current.file.file_type === 'audio') {
    return null;
  }

  return (
    <Modal
      visible
      animationType="fade"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar hidden />
      <View style={styles.container}>
        {/* Top toolbar */}
        <View style={styles.toolbar}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.toolbarButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </TouchableOpacity>

          {attachments.length > 1 && (
            <Text size="sm" color="#FFFFFF" weight="semibold">
              {`${currentIndex + 1} / ${attachments.length}`}
            </Text>
          )}

          <View style={styles.toolbarRight}>
            <TouchableOpacity
              onPress={handleSave}
              style={styles.toolbarButton}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('chat.attachment.save')}
            >
              <Ionicons name="download-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleShare}
              style={styles.toolbarButton}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('chat.attachment.share')}
            >
              <Ionicons name="share-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        <FlatList
          ref={flatListRef}
          data={attachments}
          horizontal
          pagingEnabled
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          removeClippedSubviews
        />

        {busy && (
          <View style={styles.busyOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}
      </View>
    </Modal>
  );
}

// ============================================================================
// One page (image or video)
// ============================================================================

function AttachmentPage({ attachment }: { attachment: ChatAttachment }) {
  const file = attachment.file;
  const isVideo = file.file_type === 'video';
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const player = useVideoPlayer(isVideo ? resolvedUrl : null, p => {
    p.loop = false;
    p.muted = false;
  });

  useEffect(() => {
    let cancelled = false;
    setError(false);

    // Backblaze videos hit their public URL.
    if (isVideo && file.storage_key.startsWith('backblaze/')) {
      setResolvedUrl(file.url || null);
      return () => {
        cancelled = true;
      };
    }

    void createChatAttachmentSignedUrl(file.storage_key).then(url => {
      if (cancelled) return;
      const next = url ?? file.url ?? null;
      setResolvedUrl(next);
      if (!next) setError(true);
    });

    return () => {
      cancelled = true;
    };
  }, [file.storage_key, file.url, isVideo]);

  const dims = useMemo(() => ({ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }), []);

  if (error) {
    return (
      <View style={[styles.page, dims]}>
        <Text size="base" color="#FFFFFF">
          {/* simple inline label, not a full translation key — error states are rare */}
          Failed to load attachment
        </Text>
      </View>
    );
  }

  if (!resolvedUrl) {
    return (
      <View style={[styles.page, dims]}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  if (isVideo) {
    return (
      <View style={[styles.page, dims]}>
        <VideoView
          player={player}
          style={styles.videoView}
          contentFit="contain"
          nativeControls
          allowsPictureInPicture
        />
      </View>
    );
  }

  return (
    <View style={[styles.page, dims]}>
      <Image
        source={{ uri: resolvedUrl }}
        style={styles.fullImage}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  toolbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    paddingTop: spacingPixels[12],
    paddingHorizontal: spacingPixels[3],
    paddingBottom: spacingPixels[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolbarButton: {
    width: 44,
    height: 44,
    borderRadius: radiusPixels.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  videoView: {
    width: '100%',
    height: '80%',
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
});
