/**
 * Tests for chatAttachmentUpload — exercises the real implementation
 * with mocked supabase, fetch, and native modules.
 */

import { uploadChatAttachment, validateChatAttachmentFile } from './chatAttachmentUpload';

jest.mock('@rallia/shared-services', () => ({
  supabase: {
    storage: {
      from: jest.fn(),
    },
    from: jest.fn(),
  },
  Logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('./backblazeUpload', () => ({
  isBackblazeConfigured: jest.fn().mockReturnValue(false),
  uploadVideoToBackblaze: jest.fn(),
}));

import { supabase } from '@rallia/shared-services';

function makeStorageUploadMock(error: object | null = null) {
  const upload = jest.fn().mockResolvedValue({ data: { path: 'test/path' }, error });
  (supabase.storage.from as jest.Mock).mockReturnValue({ upload });
  return upload;
}

function makeFileInsertMock(id = 'file-id-123') {
  const single = jest.fn().mockResolvedValue({ data: { id }, error: null });
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  (supabase.from as jest.Mock).mockReturnValue({ insert });
  return { insert, select, single };
}

function makeArrayBuffer(size = 100): ArrayBuffer {
  return new ArrayBuffer(size);
}

// Patch global Response so new Response(blob).arrayBuffer() works in Node test env
const mockArrayBuffer = makeArrayBuffer();
const OriginalResponse = global.Response;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).Response = class extends (OriginalResponse ?? Object) {
  arrayBuffer() {
    return Promise.resolve(mockArrayBuffer);
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default fetch mock: returns a blob (arrayBuffer is called via new Response(blob))
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    blob: jest.fn().mockResolvedValue(new Blob()),
  });
});

describe('validateChatAttachmentFile', () => {
  it('rejects empty files', () => {
    expect(validateChatAttachmentFile('file.jpg', 0, 'image').valid).toBe(false);
  });

  it('rejects oversized images (>10 MB)', () => {
    const result = validateChatAttachmentFile('file.jpg', 11 * 1024 * 1024, 'image');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/10 MB/);
  });

  it('rejects oversized documents (>25 MB)', () => {
    const result = validateChatAttachmentFile('doc.pdf', 26 * 1024 * 1024, 'document');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/25 MB/);
  });

  it('accepts valid image within limit', () => {
    expect(validateChatAttachmentFile('photo.jpg', 5 * 1024 * 1024, 'image').valid).toBe(true);
  });

  it('rejects missing filename', () => {
    expect(validateChatAttachmentFile('', 1000, 'image').valid).toBe(false);
  });
});

describe('uploadChatAttachment — upload path', () => {
  it('calls fetch with the local file URI (not base64)', async () => {
    makeStorageUploadMock();
    makeFileInsertMock();

    await uploadChatAttachment({
      fileUri: 'file:///local/photo.jpg',
      fileType: 'image',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 500 * 1024,
      userId: 'user-1',
      conversationId: 'conv-1',
    });

    // Must call fetch with the local URI — no base64 read
    expect(global.fetch).toHaveBeenCalledWith('file:///local/photo.jpg');
  });

  it('passes ArrayBuffer (not Uint8Array/string) to supabase.storage.upload', async () => {
    const upload = makeStorageUploadMock();
    makeFileInsertMock();

    await uploadChatAttachment({
      fileUri: 'file:///local/photo.jpg',
      fileType: 'image',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 500 * 1024,
      userId: 'user-1',
      conversationId: 'conv-1',
    });

    const body = upload.mock.calls[0][1];
    expect(body).toBeInstanceOf(ArrayBuffer);
  });

  it('returns success with fileId on happy path', async () => {
    makeStorageUploadMock();
    makeFileInsertMock('returned-file-id');

    const result = await uploadChatAttachment({
      fileUri: 'file:///local/photo.jpg',
      fileType: 'image',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 500 * 1024,
      userId: 'user-1',
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(true);
    expect(result.fileId).toBe('returned-file-id');
  });

  it('returns error when file validation fails', async () => {
    const result = await uploadChatAttachment({
      fileUri: 'file:///local/photo.jpg',
      fileType: 'image',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 0,
      userId: 'user-1',
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns error on storage upload failure', async () => {
    makeStorageUploadMock({ message: 'storage error', status: 500 });

    const result = await uploadChatAttachment({
      fileUri: 'file:///local/photo.jpg',
      fileType: 'image',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 500 * 1024,
      userId: 'user-1',
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(false);
  });

  it('retries on 5xx storage errors before giving up', async () => {
    const upload = jest
      .fn()
      .mockResolvedValueOnce({ error: { message: 'server error', status: 503 } })
      .mockResolvedValueOnce({ data: { path: 'ok' }, error: null });

    (supabase.storage.from as jest.Mock).mockReturnValue({ upload });
    makeFileInsertMock();

    const result = await uploadChatAttachment({
      fileUri: 'file:///local/photo.jpg',
      fileType: 'image',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 500 * 1024,
      userId: 'user-1',
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(true);
    expect(upload).toHaveBeenCalledTimes(2);
  }, 10000); // allow for retry delays

  it('does not retry on 4xx errors', async () => {
    const upload = jest.fn().mockResolvedValue({
      error: { message: 'Unauthorized', status: 401 },
    });
    (supabase.storage.from as jest.Mock).mockReturnValue({ upload });

    const result = await uploadChatAttachment({
      fileUri: 'file:///local/photo.jpg',
      fileType: 'image',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 500 * 1024,
      userId: 'user-1',
      conversationId: 'conv-1',
    });

    expect(result.success).toBe(false);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
