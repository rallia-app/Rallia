/**
 * Chat Attachment Upload Service
 *
 * Uploads images, videos, and documents that will be attached to a chat
 * message. Mirrors `ratingProofUpload.ts` but writes to the
 * `chat-attachments` bucket and creates a `file` row tagged for chat usage.
 *
 * Storage path scheme:
 *   chat-attachments/{conversationId}/{tempId}/{filename}
 * The leading `conversationId` folder is what the bucket RLS policy uses to
 * verify the uploader is a participant of that conversation.
 *
 * Videos go to Backblaze when configured (cheaper for big files), images and
 * documents go to Supabase Storage.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { supabase, Logger } from '@rallia/shared-services';

import {
  uploadVideoToBackblaze,
  isBackblazeConfigured,
  type BackblazeUploadProgress,
} from './backblazeUpload';

export type ChatAttachmentKind = 'image' | 'video' | 'document';

export type StorageProvider = 'supabase' | 'backblaze';

export interface ChatAttachmentUploadOptions {
  /** Local URI from image/document picker. */
  fileUri: string;
  fileType: ChatAttachmentKind;
  originalName: string;
  mimeType: string;
  fileSize: number;
  /** Authenticated user id (becomes file.uploaded_by). */
  userId: string;
  /** Conversation that the attachment will be sent into. */
  conversationId: string;
  onProgress?: (percent: number) => void;
}

export interface ChatAttachmentUploadResult {
  success: boolean;
  fileId?: string;
  url?: string;
  thumbnailUrl?: string | null;
  error?: string;
}

const CHAT_BUCKET = 'chat-attachments';
const THUMBNAIL_FOLDER = 'thumbnails';

// Per-type client-side caps. Bucket itself caps at 250 MB.
export const CHAT_ATTACHMENT_MAX_SIZE: Record<ChatAttachmentKind, number> = {
  image: 10 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  document: 25 * 1024 * 1024,
};

// =============================================================================
// Helpers
// =============================================================================

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function deriveExtension(originalName: string, fallback: string): string {
  const ext = originalName.split('.').pop()?.toLowerCase();
  return ext && ext.length <= 5 ? ext : fallback;
}

function makeStoragePath(conversationId: string, tempId: string, filename: string): string {
  return `${conversationId}/${tempId}/${filename}`;
}

function getSupabaseUrl(): string {
  return process.env.EXPO_PUBLIC_SUPABASE_URL || '';
}

function getStorageObjectUrl(bucket: string, path: string): string {
  // For private buckets the URL acts as a stable identifier; readers mint
  // signed URLs at view time via createChatAttachmentSignedUrl.
  return `${getSupabaseUrl()}/storage/v1/object/${bucket}/${path}`;
}

/** Validate a file before any upload work. */
export function validateChatAttachmentFile(
  fileName: string,
  fileSize: number,
  fileType: ChatAttachmentKind
): { valid: boolean; error?: string } {
  if (fileSize <= 0) {
    return { valid: false, error: 'File is empty' };
  }
  const max = CHAT_ATTACHMENT_MAX_SIZE[fileType];
  if (fileSize > max) {
    const maxMB = Math.round(max / (1024 * 1024));
    return { valid: false, error: `File exceeds the ${maxMB} MB limit` };
  }
  if (!fileName) {
    return { valid: false, error: 'Missing filename' };
  }
  return { valid: true };
}

// =============================================================================
// Supabase Storage upload
// =============================================================================

async function uploadToSupabase(params: {
  fileUri: string;
  conversationId: string;
  tempId: string;
  fileName: string;
  mimeType: string;
  onProgress?: (percent: number) => void;
}): Promise<{ url: string; storageKey: string; path: string }> {
  const { fileUri, conversationId, tempId, fileName, mimeType, onProgress } = params;

  onProgress?.(0);

  const base64Data = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
  const bytes = base64ToUint8Array(base64Data);

  const path = makeStoragePath(conversationId, tempId, fileName);

  const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, bytes, {
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    throw error;
  }

  onProgress?.(100);

  return {
    url: getStorageObjectUrl(CHAT_BUCKET, path),
    storageKey: `${CHAT_BUCKET}/${path}`,
    path,
  };
}

/**
 * Generate a thumbnail for a video and upload it to the same conversation
 * folder. Returns the (private) URL or null on failure (non-fatal).
 */
async function generateAndUploadVideoThumbnail(
  videoUri: string,
  conversationId: string,
  tempId: string
): Promise<{ url: string | null; storageKey: string | null }> {
  try {
    const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time: 1000,
      quality: 0.6,
    });
    const base64 = await FileSystem.readAsStringAsync(thumbUri, { encoding: 'base64' });
    const bytes = base64ToUint8Array(base64);
    const path = `${conversationId}/${tempId}/${THUMBNAIL_FOLDER}/${Date.now()}.jpg`;
    const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (error) {
      Logger.warn('Failed to upload chat video thumbnail', { error: error.message });
      return { url: null, storageKey: null };
    }
    return {
      url: getStorageObjectUrl(CHAT_BUCKET, path),
      storageKey: `${CHAT_BUCKET}/${path}`,
    };
  } catch (err) {
    Logger.warn('Failed to generate chat video thumbnail', { err: (err as Error).message });
    return { url: null, storageKey: null };
  }
}

// =============================================================================
// File row helper
// =============================================================================

async function createFileRecord(args: {
  userId: string;
  storageKey: string;
  url: string;
  thumbnailUrl: string | null;
  originalName: string;
  fileType: ChatAttachmentKind;
  mimeType: string;
  fileSize: number;
  storageProvider: StorageProvider;
  conversationId: string;
}): Promise<string> {
  const dbFileType =
    args.fileType === 'document' ? 'document' : args.fileType === 'image' ? 'image' : 'video';

  const { data, error } = await supabase
    .from('file')
    .insert({
      uploaded_by: args.userId,
      storage_key: args.storageKey,
      url: args.url,
      thumbnail_url: args.thumbnailUrl,
      original_name: args.originalName,
      file_type: dbFileType,
      mime_type: args.mimeType,
      file_size: args.fileSize,
      storage_provider: args.storageProvider,
      metadata: {
        chat_attachment: true,
        conversation_id: args.conversationId,
        uploaded_via: 'mobile_app',
      },
    })
    .select('id')
    .single();

  if (error || !data) {
    throw error ?? new Error('Failed to create file record');
  }

  return data.id;
}

// =============================================================================
// Main upload entry point
// =============================================================================

export async function uploadChatAttachment(
  options: ChatAttachmentUploadOptions
): Promise<ChatAttachmentUploadResult> {
  const {
    fileUri,
    fileType,
    originalName,
    mimeType,
    fileSize,
    userId,
    conversationId,
    onProgress,
  } = options;

  // Validate first so we never start a long upload on a doomed file.
  const validation = validateChatAttachmentFile(originalName, fileSize, fileType);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // tempId scopes the file inside its own folder so a re-upload of the same
  // filename never collides.
  const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fallbackExt = fileType === 'image' ? 'jpg' : fileType === 'video' ? 'mp4' : 'bin';
  const fileExt = deriveExtension(originalName, fallbackExt);
  const safeBase = originalName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || `file.${fileExt}`;
  const fileName = safeBase.includes('.') ? safeBase : `${safeBase}.${fileExt}`;

  try {
    let storageProvider: StorageProvider = 'supabase';
    let url = '';
    let storageKey = '';
    let thumbnailUrl: string | null = null;

    if (fileType === 'video' && isBackblazeConfigured()) {
      // Backblaze for videos
      storageProvider = 'backblaze';
      const bb = await uploadVideoToBackblaze(
        fileUri,
        userId,
        originalName,
        (p: BackblazeUploadProgress) => onProgress?.(p.percentage)
      );
      if (bb.error) throw bb.error;
      url = bb.url;
      storageKey = `backblaze/${bb.fileName}`;

      // Thumbnail still goes to Supabase so participants can preview it.
      const thumb = await generateAndUploadVideoThumbnail(fileUri, conversationId, tempId);
      thumbnailUrl = thumb.url;
    } else {
      const sup = await uploadToSupabase({
        fileUri,
        conversationId,
        tempId,
        fileName,
        mimeType,
        onProgress,
      });
      url = sup.url;
      storageKey = sup.storageKey;

      if (fileType === 'video') {
        const thumb = await generateAndUploadVideoThumbnail(fileUri, conversationId, tempId);
        thumbnailUrl = thumb.url;
      }
    }

    const fileId = await createFileRecord({
      userId,
      storageKey,
      url,
      thumbnailUrl,
      originalName,
      fileType,
      mimeType,
      fileSize,
      storageProvider,
      conversationId,
    });

    Logger.info('Chat attachment uploaded', { fileId, storageProvider, fileType });

    return { success: true, fileId, url, thumbnailUrl };
  } catch (err) {
    const error = err as Error;
    Logger.error('Chat attachment upload failed', error, { fileType, conversationId });
    return { success: false, error: error.message || 'Upload failed' };
  }
}
