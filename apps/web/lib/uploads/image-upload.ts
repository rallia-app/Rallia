import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_RESIZE_QUALITY,
  IMAGE_RESIZE_WIDTHS,
  IMAGE_UPLOAD_CACHE_CONTROL,
  MAX_IMAGE_UPLOAD_BYTES,
  buildStorageObjectPath,
  contentTypeForExtension,
  getStoragePublicUrl,
} from '@rallia/shared-utils';

import { createClient } from '@/lib/supabase/client';

export type ImageUploadError = 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'DECODE_FAILED' | 'UPLOAD_FAILED';

export interface ImageUploadResult {
  url: string | null;
  error: ImageUploadError | null;
}

/**
 * Downscales an image to `maxWidth` and re-encodes it as JPEG.
 *
 * The web counterpart to mobile's expo-image-manipulator step, using canvas. Images
 * taller than they are wide keep their aspect ratio, and anything already narrower
 * than the cap is left at its own width rather than upscaled.
 *
 * createImageBitmap rather than an <img> + onload dance: it decodes off the main
 * thread and rejects cleanly on a file the browser cannot read, which is the case
 * that matters here (an iPhone HEIC that Safari opens and Chrome does not).
 */
async function resizeToJpegBlob(file: File, maxWidth: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxWidth / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    context.drawImage(bitmap, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Canvas produced no blob'))),
        'image/jpeg',
        IMAGE_RESIZE_QUALITY
      );
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Uploads a user-selected image and returns its public URL.
 *
 * Everything the storage layer enforces — the object path's `{userId}/` prefix, the
 * MIME allow-list, the size cap — comes from @rallia/shared-utils so this and the
 * mobile uploader cannot disagree.
 *
 * Validation runs against the *resized* blob for size, because a 12 MB camera
 * original routinely lands well under the cap once it is 320px wide; rejecting on the
 * original would turn ordinary phone photos into errors.
 */
export async function uploadProfileImage(
  file: File,
  userId: string,
  bucket = 'profile-pictures'
): Promise<ImageUploadResult> {
  const declaredType = file.type.toLowerCase();
  const isHeic = /hei[cf]/.test(declaredType) || /\.hei[cf]$/i.test(file.name);

  // HEIC is what an iPhone shoots by default. Browsers that can decode it will produce
  // a JPEG through the canvas step; those that cannot fail at createImageBitmap and
  // surface DECODE_FAILED, which is a far better message than the bucket's MIME reject.
  if (
    !isHeic &&
    declaredType &&
    !(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(declaredType)
  ) {
    return { url: null, error: 'UNSUPPORTED_TYPE' };
  }

  let blob: Blob;
  try {
    blob = await resizeToJpegBlob(file, IMAGE_RESIZE_WIDTHS[bucket] ?? 800);
  } catch {
    return { url: null, error: 'DECODE_FAILED' };
  }

  if (blob.size > MAX_IMAGE_UPLOAD_BYTES) {
    return { url: null, error: 'TOO_LARGE' };
  }

  // Always .jpg: the canvas step re-encodes to JPEG regardless of what went in.
  const objectPath = buildStorageObjectPath(userId, 'jpg');

  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).upload(objectPath, blob, {
    contentType: contentTypeForExtension('jpg'),
    cacheControl: IMAGE_UPLOAD_CACHE_CONTROL,
    // Matches mobile: a fresh object per upload rather than overwriting, so a cached
    // avatar URL never serves someone a stale image.
    upsert: false,
  });

  if (error) {
    console.error('[uploadProfileImage]', error.message);
    return { url: null, error: 'UPLOAD_FAILED' };
  }

  return { url: getStoragePublicUrl(bucket, objectPath), error: null };
}
