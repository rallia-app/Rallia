/**
 * MessageAttachments
 *
 * Renders attachments inside a chat bubble. Image/video tiles use a grid
 * layout (1 / 2 / 3 / 4 / 5+ patterns) and a tap opens AttachmentViewerModal.
 * Document attachments render as a tappable file row that hands off to the
 * system share sheet.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import { spacingPixels, radiusPixels, primary, neutral } from '@rallia/design-system';
import { createChatAttachmentSignedUrl, type ChatAttachment } from '@rallia/shared-services';

import { useThemeStyles, useTranslation } from '../../../hooks';

import { AttachmentViewerModal } from './AttachmentViewerModal';

interface MessageAttachmentsProps {
  attachments: ChatAttachment[];
  isOwnMessage: boolean;
}

const MAX_MEDIA_WIDTH = 240;
const MAX_VISIBLE_MEDIA = 4;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isMediaKind(kind: ChatAttachment['file']['file_type']): boolean {
  return kind === 'image' || kind === 'video';
}

export function MessageAttachments({ attachments, isOwnMessage }: MessageAttachmentsProps) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const mediaAttachments = useMemo(
    () => attachments.filter(a => isMediaKind(a.file.file_type)),
    [attachments]
  );
  const documentAttachments = useMemo(
    () => attachments.filter(a => !isMediaKind(a.file.file_type)),
    [attachments]
  );

  const openViewer = useCallback((index: number) => setViewerIndex(index), []);
  const closeViewer = useCallback(() => setViewerIndex(null), []);

  return (
    <View style={styles.container}>
      {mediaAttachments.length > 0 && (
        <MediaGrid attachments={mediaAttachments} onOpen={openViewer} />
      )}

      {documentAttachments.length > 0 && (
        <View style={mediaAttachments.length > 0 ? { marginTop: spacingPixels[2] } : undefined}>
          {documentAttachments.map(att => (
            <DocumentTile
              key={att.id}
              attachment={att}
              isOwnMessage={isOwnMessage}
              onOpen={() => openViewer(attachments.findIndex(a => a.id === att.id))}
            />
          ))}
        </View>
      )}

      {viewerIndex !== null && (
        <AttachmentViewerModal
          attachments={attachments}
          startIndex={viewerIndex}
          onClose={closeViewer}
        />
      )}
    </View>
  );
}

// ============================================================================
// Media grid
// ============================================================================

function MediaGrid({
  attachments,
  onOpen,
}: {
  attachments: ChatAttachment[];
  onOpen: (index: number) => void;
}) {
  const visible = attachments.slice(0, MAX_VISIBLE_MEDIA);
  const overflow = Math.max(0, attachments.length - MAX_VISIBLE_MEDIA);
  const count = visible.length;

  const renderTile = (att: ChatAttachment, index: number, sizeStyle: object) => (
    <TouchableOpacity
      key={att.id}
      activeOpacity={0.85}
      onPress={() => onOpen(index)}
      style={[styles.tileBase, sizeStyle]}
      accessibilityRole="imagebutton"
      accessibilityLabel={att.file.original_name || att.file.file_type}
    >
      <SignedThumbnail
        attachment={att}
        style={styles.tileImage}
        showVideoIcon={att.file.file_type === 'video'}
      />
      {index === MAX_VISIBLE_MEDIA - 1 && overflow > 0 && (
        <View style={styles.overflowOverlay}>
          <Text size="2xl" weight="semibold" color="#FFFFFF">
            +{overflow}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );

  if (count === 1) {
    return <View style={styles.singleWrap}>{renderTile(visible[0], 0, styles.tileSingle)}</View>;
  }

  if (count === 2) {
    return (
      <View style={styles.row}>
        {renderTile(visible[0], 0, styles.tileHalfLeft)}
        {renderTile(visible[1], 1, styles.tileHalfRight)}
      </View>
    );
  }

  if (count === 3) {
    return (
      <View style={styles.row}>
        {renderTile(visible[0], 0, styles.tileBigLeft)}
        <View style={styles.colRight}>
          {renderTile(visible[1], 1, styles.tileSmallTop)}
          {renderTile(visible[2], 2, styles.tileSmallBottom)}
        </View>
      </View>
    );
  }

  // 4 or more
  return (
    <View style={styles.gridWrap}>
      <View style={styles.row}>
        {renderTile(visible[0], 0, styles.tileQuadTopLeft)}
        {renderTile(visible[1], 1, styles.tileQuadTopRight)}
      </View>
      <View style={styles.row}>
        {renderTile(visible[2], 2, styles.tileQuadBottomLeft)}
        {renderTile(visible[3], 3, styles.tileQuadBottomRight)}
      </View>
    </View>
  );
}

// ============================================================================
// Signed thumbnail loader
// ============================================================================

function SignedThumbnail({
  attachment,
  style,
  showVideoIcon,
}: {
  attachment: ChatAttachment;
  style: object;
  showVideoIcon?: boolean;
}) {
  const file = attachment.file;
  const isVideo = file.file_type === 'video';
  const upload = attachment.__upload;
  const isOptimistic = upload != null;

  const initialKey = isVideo ? file.thumbnail_url || file.storage_key : file.storage_key;
  const [uri, setUri] = useState<string | null>(
    isOptimistic ? file.thumbnail_url || file.url : null
  );
  const [loading, setLoading] = useState(!isOptimistic);

  useEffect(() => {
    // Optimistic rows render the local URI directly — no signing needed.
    if (isOptimistic) {
      setUri(file.thumbnail_url || file.url);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Backblaze-hosted videos use the public URL directly; thumbnails for
    // those videos still live in Supabase, so prefer the thumbnail key.
    if (file.storage_key.startsWith('backblaze/') && !isVideo) {
      if (!cancelled) {
        setUri(file.url || null);
        setLoading(false);
      }
      return () => {
        cancelled = true;
      };
    }

    const keyToSign =
      isVideo && file.thumbnail_url ? extractStorageKey(file.thumbnail_url) : file.storage_key;

    if (!keyToSign) {
      // Fallback to whatever stored URL is on the row.
      if (!cancelled) {
        setUri(file.thumbnail_url || file.url || null);
        setLoading(false);
      }
      return () => {
        cancelled = true;
      };
    }

    void createChatAttachmentSignedUrl(keyToSign).then(signed => {
      if (cancelled) return;
      setUri(signed ?? file.thumbnail_url ?? file.url ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // intentionally only depends on the key/url, not the entire attachment object
  }, [file.storage_key, file.thumbnail_url, file.url, isVideo, initialKey, isOptimistic]);

  const showProgress = upload?.status === 'uploading' || upload?.status === 'pending';
  const showFailed = upload?.status === 'failed';

  return (
    <View style={[style, styles.tileFrame]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.tilePlaceholder]} />
      )}
      {loading && !isOptimistic && (
        <View style={styles.tileLoading}>
          <ActivityIndicator size="small" color="#FFFFFF" />
        </View>
      )}
      {showProgress && (
        <View style={styles.tileLoading}>
          <ActivityIndicator size="small" color="#FFFFFF" />
        </View>
      )}
      {showFailed && (
        <View style={styles.tileFailed}>
          <Ionicons name="alert-circle" size={22} color="#FFFFFF" />
        </View>
      )}
      {showVideoIcon && !showProgress && !showFailed && (
        <View style={styles.videoOverlay}>
          <View style={styles.playPill}>
            <Ionicons name="play" size={20} color="#FFFFFF" />
          </View>
        </View>
      )}
    </View>
  );
}

function extractStorageKey(url: string): string | null {
  // For URLs of the form: {supabaseUrl}/storage/v1/object/{bucket}/{path}
  const match = url.match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, bucket, path] = match;
  return `${bucket}/${path}`;
}

// ============================================================================
// Document tile
// ============================================================================

function DocumentTile({
  attachment,
  isOwnMessage,
  onOpen,
}: {
  attachment: ChatAttachment;
  isOwnMessage: boolean;
  onOpen: () => void;
}) {
  const { colors, isDark } = useThemeStyles();
  const { t } = useTranslation();
  const file = attachment.file;

  const iconColor = (() => {
    if (file.mime_type.includes('pdf')) return '#E53E3E';
    if (file.mime_type.includes('word') || file.mime_type.includes('msword')) return '#2B6CB0';
    if (file.mime_type.includes('sheet') || file.mime_type.includes('excel')) return '#2F855A';
    return primary[500];
  })();

  return (
    <Pressable
      onPress={onOpen}
      android_ripple={{ color: 'rgba(0,0,0,0.08)', borderless: false }}
      style={({ pressed }) => [
        styles.docTile,
        {
          backgroundColor: isOwnMessage
            ? 'rgba(255,255,255,0.18)'
            : isDark
              ? colors.card
              : neutral[100],
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${file.original_name}, ${formatFileSize(file.file_size)}`}
      accessibilityHint={t('chat.attachment.openDocument')}
    >
      <View style={[styles.docIconBox, { backgroundColor: isDark ? neutral[800] : '#FFFFFF' }]}>
        <Ionicons name="document-text" size={22} color={iconColor} />
      </View>
      <View style={styles.docMeta}>
        <Text
          size="sm"
          weight="semibold"
          color={isOwnMessage ? '#FFFFFF' : colors.text}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {file.original_name || t('chat.attachment.document')}
        </Text>
        <Text size="xs" color={isOwnMessage ? 'rgba(255,255,255,0.7)' : colors.textMuted}>
          {`${(file.mime_type.split('/').pop() || 'file').toUpperCase()} · ${formatFileSize(file.file_size)}`}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={isOwnMessage ? 'rgba(255,255,255,0.7)' : colors.textMuted}
      />
    </Pressable>
  );
}

// ============================================================================
// Styles
// ============================================================================

const TILE_GUTTER = 2;
const SMALL_HEIGHT = (MAX_MEDIA_WIDTH - TILE_GUTTER) / 2;

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  // Layouts
  singleWrap: {
    width: MAX_MEDIA_WIDTH,
    maxWidth: '100%',
  },
  row: {
    flexDirection: 'row',
    width: MAX_MEDIA_WIDTH,
    maxWidth: '100%',
  },
  colRight: {
    flexDirection: 'column',
    width: SMALL_HEIGHT,
    marginLeft: TILE_GUTTER,
  },
  gridWrap: {
    width: MAX_MEDIA_WIDTH,
    maxWidth: '100%',
  },
  // Tile sizes
  tileBase: {
    overflow: 'hidden',
    borderRadius: radiusPixels.lg,
    backgroundColor: neutral[200],
  },
  tileFrame: {
    overflow: 'hidden',
    borderRadius: radiusPixels.lg,
  },
  tileSingle: {
    width: '100%',
    aspectRatio: 4 / 3,
  },
  tileHalfLeft: {
    width: (MAX_MEDIA_WIDTH - TILE_GUTTER) / 2,
    aspectRatio: 1,
    marginRight: TILE_GUTTER,
  },
  tileHalfRight: {
    width: (MAX_MEDIA_WIDTH - TILE_GUTTER) / 2,
    aspectRatio: 1,
  },
  tileBigLeft: {
    width: MAX_MEDIA_WIDTH - SMALL_HEIGHT - TILE_GUTTER,
    height: MAX_MEDIA_WIDTH * 0.66,
  },
  tileSmallTop: {
    width: SMALL_HEIGHT,
    height: (MAX_MEDIA_WIDTH * 0.66 - TILE_GUTTER) / 2,
    marginBottom: TILE_GUTTER,
  },
  tileSmallBottom: {
    width: SMALL_HEIGHT,
    height: (MAX_MEDIA_WIDTH * 0.66 - TILE_GUTTER) / 2,
  },
  tileQuadTopLeft: {
    width: (MAX_MEDIA_WIDTH - TILE_GUTTER) / 2,
    height: (MAX_MEDIA_WIDTH - TILE_GUTTER) / 2,
    marginRight: TILE_GUTTER,
    marginBottom: TILE_GUTTER,
  },
  tileQuadTopRight: {
    width: (MAX_MEDIA_WIDTH - TILE_GUTTER) / 2,
    height: (MAX_MEDIA_WIDTH - TILE_GUTTER) / 2,
    marginBottom: TILE_GUTTER,
  },
  tileQuadBottomLeft: {
    width: (MAX_MEDIA_WIDTH - TILE_GUTTER) / 2,
    height: (MAX_MEDIA_WIDTH - TILE_GUTTER) / 2,
    marginRight: TILE_GUTTER,
  },
  tileQuadBottomRight: {
    width: (MAX_MEDIA_WIDTH - TILE_GUTTER) / 2,
    height: (MAX_MEDIA_WIDTH - TILE_GUTTER) / 2,
  },
  tileImage: {
    flex: 1,
  },
  tilePlaceholder: {
    backgroundColor: neutral[300],
  },
  tileLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  tileFailed: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.55)',
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Document
  docTile: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacingPixels[2.5],
    paddingHorizontal: spacingPixels[3],
    borderRadius: radiusPixels.lg,
  },
  docIconBox: {
    width: 40,
    height: 40,
    borderRadius: radiusPixels.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacingPixels[3],
  },
  docMeta: {
    flex: 1,
    minWidth: 0,
  },
});
