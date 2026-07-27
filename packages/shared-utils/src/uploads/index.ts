/**
 * Image-upload rules shared by every platform.
 *
 * These are contracts, not preferences: the storage buckets enforce a MIME allow-list
 * and a size cap, and the RLS policy on storage.objects requires the first path segment
 * to be the uploader's auth uid. Getting any of them wrong fails at the storage layer
 * with an opaque error, so both apps derive them from here.
 */

/**
 * Max stored width per bucket. Images are downscaled before upload to cap what the
 * bucket holds — avatars in particular are served raw, so the stored file *is* the
 * delivered file.
 */
export const IMAGE_RESIZE_WIDTHS: Record<string, number> = {
  'profile-pictures': 320,
  'facility-images': 800,
  'group-images': 800,
  'tournament-logos': 1080,
  'league-logos': 1080,
  'feedback-screenshots': 800,
  'report-evidence': 800,
};

/** JPEG quality used when re-encoding a resized image. */
export const IMAGE_RESIZE_QUALITY = 0.85;

/** Mirrors the buckets' allowed_mime_types. HEIC is absent on purpose — see below. */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const;

/** Matches the buckets' file_size_limit (5 MB). */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Normalizes a file extension for storage.
 *
 * HEIC/HEIF are what an iPhone produces by default and what Supabase Storage rejects,
 * so they are re-encoded to JPEG on the way up and must be named accordingly.
 */
export function normalizeImageExtension(extension: string): string {
  const lower = extension.toLowerCase().replace(/^\./, '').split('?')[0];
  if (lower === 'heic' || lower === 'heif') return 'jpg';
  if (lower === 'jpeg') return 'jpg';
  return lower || 'jpg';
}

export function contentTypeForExtension(extension: string): string {
  const normalized = normalizeImageExtension(extension);
  return `image/${normalized === 'jpg' ? 'jpeg' : normalized}`;
}

/**
 * Builds the object path for an upload.
 *
 * The `${userId}/` prefix is load-bearing: the storage RLS policy checks
 * `(storage.foldername(name))[1] = auth.uid()::text`, so a flat path is rejected.
 */
export function buildStorageObjectPath(
  userId: string,
  extension: string,
  now: number = Date.now()
): string {
  return `${userId}/${now}.${normalizeImageExtension(extension)}`;
}

/** Cache-Control sent with uploads: one week. */
export const IMAGE_UPLOAD_CACHE_CONTROL = '604800';
