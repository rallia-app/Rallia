/**
 * Chat Attachment Download Service
 *
 * Saves a chat attachment to the user's device or hands it off to the
 * system share sheet. Permissions are handled inline:
 *  - Photos & videos: requires Media Library write permission, then saved
 *    via MediaLibrary.saveToLibraryAsync.
 *  - Documents: downloaded into the cache and shared via expo-sharing so the
 *    user can route to Files / Mail / iCloud / etc.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import {
  Logger,
  createChatAttachmentSignedUrl,
  type ChatAttachment,
} from '@rallia/shared-services';

export type DownloadFailureReason = 'permission' | 'network' | 'cancelled' | 'unsupported';

export type ChatAttachmentDownloadResult =
  | { ok: true; mode: 'saved-to-library' | 'shared' }
  | { ok: false; reason: DownloadFailureReason; message?: string };

interface DownloadOptions {
  onProgress?: (percent: number) => void;
}

/**
 * Resolve a usable URL for an attachment. Falls back to the stored `file.url`
 * for legacy public attachments (e.g. Backblaze-hosted videos).
 */
async function resolveAttachmentUrl(attachment: ChatAttachment): Promise<string | null> {
  const file = attachment.file;
  // Backblaze-hosted videos use the public stored URL.
  if (file.storage_key.startsWith('backblaze/')) {
    return file.url || null;
  }
  const signed = await createChatAttachmentSignedUrl(file.storage_key);
  return signed ?? file.url ?? null;
}

function destinationFromAttachment(attachment: ChatAttachment): string {
  const cacheDir = FileSystem.cacheDirectory ?? '';
  const safeName =
    attachment.file.original_name?.replace(/[^a-zA-Z0-9._-]+/g, '_') ||
    `attachment-${attachment.id}`;
  return `${cacheDir}rallia-chat-${attachment.id}-${safeName}`;
}

async function ensureMediaLibraryPermission(): Promise<boolean> {
  const current = await MediaLibrary.getPermissionsAsync(true /* writeOnly */);
  if (current.status === 'granted' || current.accessPrivileges === 'all') return true;
  if (!current.canAskAgain) return false;
  const requested = await MediaLibrary.requestPermissionsAsync(true /* writeOnly */);
  return requested.status === 'granted' || requested.accessPrivileges === 'all';
}

/**
 * Save an image or video attachment to the system photo library.
 */
async function saveMediaToLibrary(
  attachment: ChatAttachment,
  options: DownloadOptions
): Promise<ChatAttachmentDownloadResult> {
  const hasPermission = await ensureMediaLibraryPermission();
  if (!hasPermission) {
    return { ok: false, reason: 'permission' };
  }

  const url = await resolveAttachmentUrl(attachment);
  if (!url) {
    return { ok: false, reason: 'network', message: 'Could not resolve attachment URL' };
  }

  try {
    const dest = destinationFromAttachment(attachment);
    const downloadResumable = FileSystem.createDownloadResumable(
      url,
      dest,
      {},
      options.onProgress
        ? progress => {
            const pct =
              progress.totalBytesExpectedToWrite > 0
                ? Math.round(
                    (progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100
                  )
                : 0;
            options.onProgress?.(pct);
          }
        : undefined
    );

    const downloaded = await downloadResumable.downloadAsync();
    if (!downloaded?.uri) {
      return { ok: false, reason: 'network' };
    }

    await MediaLibrary.saveToLibraryAsync(downloaded.uri);

    // Best-effort cleanup of the cached copy.
    void FileSystem.deleteAsync(downloaded.uri, { idempotent: true }).catch(() => undefined);

    return { ok: true, mode: 'saved-to-library' };
  } catch (err) {
    Logger.error('Failed to save chat attachment to library', err as Error, {
      attachmentId: attachment.id,
    });
    return { ok: false, reason: 'network', message: (err as Error).message };
  }
}

/**
 * Share a document (or any attachment) via the system share sheet, after
 * downloading it into the cache so the share target can read the bytes.
 */
async function shareAttachment(
  attachment: ChatAttachment,
  options: DownloadOptions
): Promise<ChatAttachmentDownloadResult> {
  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, reason: 'unsupported' };
  }

  const url = await resolveAttachmentUrl(attachment);
  if (!url) {
    return { ok: false, reason: 'network', message: 'Could not resolve attachment URL' };
  }

  try {
    const dest = destinationFromAttachment(attachment);
    const downloadResumable = FileSystem.createDownloadResumable(
      url,
      dest,
      {},
      options.onProgress
        ? progress => {
            const pct =
              progress.totalBytesExpectedToWrite > 0
                ? Math.round(
                    (progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100
                  )
                : 0;
            options.onProgress?.(pct);
          }
        : undefined
    );
    const downloaded = await downloadResumable.downloadAsync();
    if (!downloaded?.uri) {
      return { ok: false, reason: 'network' };
    }

    await Sharing.shareAsync(downloaded.uri, {
      mimeType: attachment.file.mime_type || undefined,
      dialogTitle: attachment.file.original_name,
    });

    // We intentionally do not clean up here: on Android the receiving app may
    // still be reading the file after shareAsync resolves. The cache is
    // wiped by the OS over time.

    return { ok: true, mode: 'shared' };
  } catch (err) {
    Logger.error('Failed to share chat attachment', err as Error, {
      attachmentId: attachment.id,
    });
    return { ok: false, reason: 'network', message: (err as Error).message };
  }
}

/**
 * Save an attachment to the device. Image/video → photo library. Document →
 * share sheet (so user picks Files / iCloud / mail / etc.).
 */
export async function downloadAttachmentToDevice(
  attachment: ChatAttachment,
  options: DownloadOptions = {}
): Promise<ChatAttachmentDownloadResult> {
  const kind = attachment.file.file_type;
  if (kind === 'image' || kind === 'video') {
    return saveMediaToLibrary(attachment, options);
  }
  return shareAttachment(attachment, options);
}

/**
 * Always route through the share sheet, regardless of media kind. Useful for
 * a "Share" action distinct from "Save to Photos".
 */
export async function shareAttachmentViaSystemSheet(
  attachment: ChatAttachment,
  options: DownloadOptions = {}
): Promise<ChatAttachmentDownloadResult> {
  return shareAttachment(attachment, options);
}
