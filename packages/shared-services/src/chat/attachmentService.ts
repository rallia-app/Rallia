/**
 * Attachment Service
 * Helpers for working with chat-attachment files. The chat-attachments bucket
 * is private, so reads go through short-lived signed URLs.
 */

import { supabase } from '../supabase';

export const CHAT_ATTACHMENTS_BUCKET = 'chat-attachments';

/** Default signed URL TTL — long enough to keep a chat open, short enough that
 * a snapshot of the URL leaking has a bounded blast radius. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Mint a short-lived signed URL for a chat-attachment file.
 *
 * `storage_key` is the value persisted on the `file` row, e.g.
 *   "chat-attachments/{conversationId}/{messageId}/{filename}".
 *
 * Returns null on failure so callers can fall back to the stored `url` field
 * (which works for legacy files that lived in a public bucket).
 */
export async function createChatAttachmentSignedUrl(
  storageKey: string,
  expiresIn: number = SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  if (!storageKey) return null;

  // The `file.storage_key` is stored as "{bucket}/{path}". Strip the bucket
  // prefix because the Storage SDK already knows which bucket to address.
  const prefix = `${CHAT_ATTACHMENTS_BUCKET}/`;
  const path = storageKey.startsWith(prefix) ? storageKey.slice(prefix.length) : storageKey;

  const { data, error } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error) {
    console.error('Failed to create chat-attachment signed URL', { storageKey, error });
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * Batch-mint signed URLs for many attachments.
 * Processed in chunks of 10 to avoid fanning out unlimited parallel requests
 * when a long conversation has many attachments.
 */
export async function createChatAttachmentSignedUrls(
  storageKeys: string[],
  expiresIn: number = SIGNED_URL_TTL_SECONDS
): Promise<Map<string, string>> {
  const BATCH_SIZE = 10;
  const out = new Map<string, string>();
  for (let i = 0; i < storageKeys.length; i += BATCH_SIZE) {
    const batch = storageKeys.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async key => {
        const url = await createChatAttachmentSignedUrl(key, expiresIn);
        if (url) out.set(key, url);
      })
    );
  }
  return out;
}
