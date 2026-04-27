/**
 * Media compression for chat attachments.
 *
 * Runs at pick time, before the file lands in the composer's pending list.
 * Goals:
 *  - Cut upload size for large iPhone photos / 4K videos so the visible
 *    "uploading" phase finishes quickly.
 *  - Skip cheap files entirely so we don't burn battery for no win.
 *  - Never abort a pick on a compression failure — fall back to the original.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Video } from 'react-native-compressor';
import { Logger } from '@rallia/shared-services';

const IMAGE_MAX_DIMENSION = 2048;
const IMAGE_QUALITY = 0.8;
const IMAGE_SKIP_BELOW_BYTES = 200 * 1024;

const VIDEO_SKIP_BELOW_BYTES = 5 * 1024 * 1024;

export interface CompressionResult {
  uri: string;
  size: number;
  mimeType: string;
}

function isAnimatedOrVector(mime: string): boolean {
  return mime === 'image/gif' || mime === 'image/webp' || mime === 'image/svg+xml';
}

async function fileSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof (info as { size?: number }).size === 'number') {
      return (info as { size?: number }).size ?? 0;
    }
  } catch {
    // ignore — fall through
  }
  return 0;
}

/**
 * Resize + re-encode an image to JPEG. Returns the original on skip or error.
 */
export async function compressImage(
  uri: string,
  mimeType: string,
  sizeBytes: number
): Promise<CompressionResult> {
  if (sizeBytes > 0 && sizeBytes < IMAGE_SKIP_BELOW_BYTES) {
    return { uri, size: sizeBytes, mimeType };
  }
  if (isAnimatedOrVector(mimeType)) {
    return { uri, size: sizeBytes, mimeType };
  }

  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: IMAGE_MAX_DIMENSION } }],
      {
        compress: IMAGE_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
    const newSize = await fileSize(result.uri);
    return {
      uri: result.uri,
      size: newSize > 0 ? newSize : sizeBytes,
      mimeType: 'image/jpeg',
    };
  } catch (err) {
    Logger.warn('Image compression failed, using original', {
      err: (err as Error).message,
    });
    return { uri, size: sizeBytes, mimeType };
  }
}

/**
 * Compress a video using react-native-compressor. Returns the original on
 * skip or error.
 */
export async function compressVideo(
  uri: string,
  mimeType: string,
  sizeBytes: number
): Promise<CompressionResult> {
  if (sizeBytes > 0 && sizeBytes < VIDEO_SKIP_BELOW_BYTES) {
    return { uri, size: sizeBytes, mimeType };
  }

  try {
    const compressedUri = await Video.compress(uri, {
      compressionMethod: 'auto',
    });
    const newSize = await fileSize(compressedUri);
    return {
      uri: compressedUri,
      size: newSize > 0 ? newSize : sizeBytes,
      mimeType: 'video/mp4',
    };
  } catch (err) {
    Logger.warn('Video compression failed, using original', {
      err: (err as Error).message,
    });
    return { uri, size: sizeBytes, mimeType };
  }
}

/**
 * Dispatch by kind. Documents are not compressed.
 */
export async function compressForChat(
  kind: 'image' | 'video' | 'document',
  uri: string,
  mimeType: string,
  sizeBytes: number
): Promise<CompressionResult> {
  if (kind === 'image') return compressImage(uri, mimeType, sizeBytes);
  if (kind === 'video') return compressVideo(uri, mimeType, sizeBytes);
  return { uri, size: sizeBytes, mimeType };
}
