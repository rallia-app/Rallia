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
import { Logger } from '@rallia/shared-services';

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
  content: string | null;
  replyToMessageId?: string;
  attachments: OutboxAttachment[];
  status: 'sending' | 'failed';
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Internal: serialized write queue
// All mutating operations go through enqueueWrite so concurrent calls never
// race on the readAll → mutate → writeAll cycle.
// ---------------------------------------------------------------------------

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(fn: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(fn);
  // Keep the shared chain alive regardless of whether fn throws.
  // Return `next` (not the silenced version) so callers can observe errors.
  writeQueue = next.catch(() => {});
  return next;
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
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch (err) {
    Logger.error('OutboxStore: failed to persist rows', err as Error);
    throw err;
  }
}

export function listAll(): Promise<OutboxRow[]> {
  return readAll();
}

export async function listByConversation(conversationId: string): Promise<OutboxRow[]> {
  const all = await readAll();
  return all.filter(r => r.conversationId === conversationId);
}

export function upsertRow(row: OutboxRow): Promise<void> {
  return enqueueWrite(async () => {
    const rows = await readAll();
    const idx = rows.findIndex(r => r.tmpId === row.tmpId);
    if (idx === -1) rows.push(row);
    else rows[idx] = row;
    await writeAll(rows);
  });
}

export function removeRow(tmpId: string): Promise<void> {
  return enqueueWrite(async () => {
    const rows = await readAll();
    await writeAll(rows.filter(r => r.tmpId !== tmpId));
  });
}

export function clearAll(): Promise<void> {
  return enqueueWrite(() => AsyncStorage.removeItem(STORAGE_KEY));
}
