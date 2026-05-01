/**
 * Tests for attachmentService — focuses on the batch-chunked signed-URL helper.
 */

import { createChatAttachmentSignedUrls, SIGNED_URL_TTL_SECONDS } from './attachmentService';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(),
    },
  },
}));

function makeStorageMock(signedUrl: string | null, error?: object) {
  const createSignedUrl = jest.fn().mockResolvedValue({
    data: signedUrl ? { signedUrl } : null,
    error: error ?? null,
  });
  (supabase.storage.from as jest.Mock).mockReturnValue({ createSignedUrl });
  return createSignedUrl;
}

describe('createChatAttachmentSignedUrls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an empty map for an empty input', async () => {
    const result = await createChatAttachmentSignedUrls([]);
    expect(result.size).toBe(0);
  });

  it('mints a URL for a single key', async () => {
    const createSignedUrl = makeStorageMock('https://signed.example/file.jpg');
    const result = await createChatAttachmentSignedUrls(['chat-attachments/conv-1/msg-1/file.jpg']);
    expect(result.size).toBe(1);
    expect(result.get('chat-attachments/conv-1/msg-1/file.jpg')).toBe(
      'https://signed.example/file.jpg'
    );
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith('conv-1/msg-1/file.jpg', SIGNED_URL_TTL_SECONDS);
  });

  it('strips the bucket prefix before calling the SDK', async () => {
    const createSignedUrl = makeStorageMock('https://signed.example/a.jpg');
    await createChatAttachmentSignedUrls(['chat-attachments/conv-x/msg-y/a.jpg']);
    // path passed to createSignedUrl must NOT include the bucket prefix
    expect(createSignedUrl).toHaveBeenCalledWith('conv-x/msg-y/a.jpg', SIGNED_URL_TTL_SECONDS);
  });

  it('processes exactly BATCH_SIZE keys in the first parallel round', async () => {
    // 13 keys → first batch of 10, second batch of 3
    const keys = Array.from({ length: 13 }, (_, i) => `chat-attachments/c/m/file-${i}.jpg`);

    let maxConcurrent = 0;
    let activeCalls = 0;

    const createSignedUrl = jest.fn().mockImplementation(async (path: string) => {
      activeCalls++;
      maxConcurrent = Math.max(maxConcurrent, activeCalls);
      // Simulate async work — let other microtasks run
      await new Promise(r => setTimeout(r, 0));
      activeCalls--;
      return { data: { signedUrl: `https://signed/${path}` }, error: null };
    });

    (supabase.storage.from as jest.Mock).mockReturnValue({ createSignedUrl });

    const result = await createChatAttachmentSignedUrls(keys);

    expect(result.size).toBe(13);
    // Concurrency must never exceed 10
    expect(maxConcurrent).toBeLessThanOrEqual(10);
    expect(createSignedUrl).toHaveBeenCalledTimes(13);
  });

  it('omits keys whose signed-URL call fails', async () => {
    const createSignedUrl = jest
      .fn()
      .mockResolvedValueOnce({ data: { signedUrl: 'https://ok.example/a.jpg' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    (supabase.storage.from as jest.Mock).mockReturnValue({ createSignedUrl });

    const keys = ['chat-attachments/c/m/a.jpg', 'chat-attachments/c/m/b.jpg'];
    const result = await createChatAttachmentSignedUrls(keys);

    expect(result.size).toBe(1);
    expect(result.has('chat-attachments/c/m/a.jpg')).toBe(true);
    expect(result.has('chat-attachments/c/m/b.jpg')).toBe(false);
  });

  it('uses the provided custom TTL', async () => {
    const createSignedUrl = makeStorageMock('https://signed.example/x.jpg');
    await createChatAttachmentSignedUrls(['chat-attachments/c/m/x.jpg'], 300);
    expect(createSignedUrl).toHaveBeenCalledWith('c/m/x.jpg', 300);
  });
});
