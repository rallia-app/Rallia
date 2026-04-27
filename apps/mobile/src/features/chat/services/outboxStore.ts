/**
 * Persistent send queue (chat outbox).
 *
 * Stores in-flight + failed optimistic chat messages in AsyncStorage so they
 * survive app navigation, screen unmount, and app kill. The format is
 * intentionally narrow — we only persist what's needed to redrive uploads on
 * the next chat-screen mount.
 *
 * The hook in `shared-hooks` (useSendMessageWithUploads) is the source of
 * truth for runtime state; this module only provides durable storage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'chat:outbox:v1';

export interface OutboxAttachment {
  localId: string;
  uri: string;
  thumbnailUri: string | null;
  kind: 'image' | 'video' | 'document';
  mimeType: string;
  size: number;
  originalName: string;
  fileId?: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  error?: string;
}

export interface OutboxRow {
  tmpId: string;
  conversationId: string;
  senderId: string;
  userId: string;
  content: string;
  replyToMessageId?: string;
  attachments: OutboxAttachment[];
  status: 'sending' | 'failed';
  createdAt: string;
}

async function readAll(): Promise<OutboxRow[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OutboxRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(rows: OutboxRow[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export async function listAll(): Promise<OutboxRow[]> {
  return readAll();
}

export async function listByConversation(conversationId: string): Promise<OutboxRow[]> {
  const all = await readAll();
  return all.filter(r => r.conversationId === conversationId);
}

export async function upsertRow(row: OutboxRow): Promise<void> {
  const rows = await readAll();
  const idx = rows.findIndex(r => r.tmpId === row.tmpId);
  if (idx === -1) {
    rows.push(row);
  } else {
    rows[idx] = row;
  }
  await writeAll(rows);
}

export async function removeRow(tmpId: string): Promise<void> {
  const rows = await readAll();
  await writeAll(rows.filter(r => r.tmpId !== tmpId));
}

export async function clearAll(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
