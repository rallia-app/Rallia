/**
 * Storage Utilities
 *
 * Utilities for working with Supabase Storage URLs.
 * Handles normalization of URLs to ensure they work across different environments.
 */

/**
 * Get the Supabase URL from environment variables
 * Works in both React Native (Expo) and Next.js environments
 */
function getSupabaseUrl(): string {
  // Try Expo env var first, then Next.js
  if (typeof process !== 'undefined' && process.env) {
    return process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  }
  return '';
}

/**
 * Construct a public URL for a storage file
 * Uses the current environment's Supabase URL
 *
 * @param bucket - Storage bucket name
 * @param filePath - Path to the file within the bucket
 * @returns Full public URL for the file
 *
 * @example
 * ```ts
 * const url = getStoragePublicUrl('profile-pictures', 'user-123/avatar.jpg');
 * // Returns: https://xxx.supabase.co/storage/v1/object/public/profile-pictures/user-123/avatar.jpg
 * ```
 */
export function getStoragePublicUrl(bucket: string, filePath: string): string {
  const supabaseUrl = getSupabaseUrl();
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
}

/**
 * Extract the file path from a Supabase storage URL
 *
 * @param url - Full storage URL
 * @param bucket - Storage bucket name
 * @returns File path within the bucket, or null if URL format is invalid
 *
 * @example
 * ```ts
 * const path = extractStorageFilePath(
 *   'https://xxx.supabase.co/storage/v1/object/public/profile-pictures/user-123/avatar.jpg',
 *   'profile-pictures'
 * );
 * // Returns: 'user-123/avatar.jpg'
 * ```
 */
export function extractStorageFilePath(url: string, bucket: string): string | null {
  const bucketPath = `/storage/v1/object/public/${bucket}/`;
  const pathIndex = url.indexOf(bucketPath);

  if (pathIndex === -1) {
    return null;
  }

  return url.substring(pathIndex + bucketPath.length);
}

/**
 * Normalize a storage URL to use the current environment's Supabase URL
 *
 * This is important because when running locally, URLs might be saved with
 * a local IP address (e.g., http://192.168.1.157:54321) that won't work
 * when the device is on a different network or when switching to production.
 *
 * This function extracts the file path from the stored URL and reconstructs
 * it using the current environment's Supabase URL.
 *
 * @param storedUrl - The URL stored in the database (may have old/different base URL)
 * @param bucket - Storage bucket name (default: 'profile-pictures')
 * @returns URL with the current environment's Supabase base URL, or null if input is null/undefined
 *
 * @example
 * ```ts
 * // URL saved locally with local IP
 * const localUrl = 'http://192.168.1.157:54321/storage/v1/object/public/profile-pictures/user-123/avatar.jpg';
 *
 * // In production, normalizes to production URL
 * const normalizedUrl = normalizeStorageUrl(localUrl);
 * // Returns: https://xxx.supabase.co/storage/v1/object/public/profile-pictures/user-123/avatar.jpg
 * ```
 */
export function normalizeStorageUrl(
  storedUrl: string | null | undefined,
  bucket: string = 'profile-pictures'
): string | null {
  if (!storedUrl) return null;

  // Extract the file path from the stored URL
  const filePath = extractStorageFilePath(storedUrl, bucket);

  if (!filePath) {
    // URL doesn't match expected format, return as-is
    // This handles cases like external URLs or already-correct URLs
    return storedUrl;
  }

  return getStoragePublicUrl(bucket, filePath);
}

/**
 * Whether the Supabase image-transformation render endpoint is available
 * in the current environment. The feature requires Pro plan and above.
 * On mobile, derived from EXPO_PUBLIC_APP_ENV (baked into the binary, OTA-safe).
 * On web, controlled by NEXT_PUBLIC_ENABLE_IMAGE_TRANSFORM.
 */
function isImageTransformEnabled(): boolean {
  if (typeof process === 'undefined' || !process.env) return true;
  // Mobile: only production builds run on the Pro Supabase project
  const appEnv = process.env.EXPO_PUBLIC_APP_ENV;
  if (appEnv !== undefined) return appEnv === 'production';
  // Web fallback
  const raw = process.env.NEXT_PUBLIC_ENABLE_IMAGE_TRANSFORM;
  if (raw === undefined) return true;
  return raw !== 'false' && raw !== '0';
}

/**
 * Rewrite a public Supabase Storage URL to use the image render endpoint,
 * which resizes and recompresses the image server-side before delivery.
 * The rendered result is CDN-cached, so repeated requests are free.
 *
 * Only applies to hosted Supabase URLs (*.supabase.co) — local dev URLs
 * are returned as-is since the render endpoint isn't available locally.
 *
 * Note: Supabase's render endpoint negotiates WebP/AVIF automatically via
 * the client's `Accept` header — no explicit `format` param needed.
 *
 * @param url - Public storage URL to transform
 * @param options.width - Max width in pixels (image is scaled proportionally)
 * @param options.quality - JPEG quality 1–100
 * @returns Transformed URL, or the original URL if transform doesn't apply
 */
export function getStorageImageUrl(
  url: string | null | undefined,
  options: { width?: number; height?: number; quality?: number } = {}
): string | null {
  if (!url) return null;
  if (!url.includes('.supabase.co')) return url;
  if (!url.includes('/storage/v1/object/public/')) return url;
  if (!isImageTransformEnabled()) return url;

  const renderUrl = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  const params = new URLSearchParams();
  if (options.width) params.set('width', String(options.width));
  if (options.height) params.set('height', String(options.height));
  if (options.quality) params.set('quality', String(options.quality));
  const qs = params.toString();
  return qs ? `${renderUrl}?${qs}` : renderUrl;
}

/**
 * Get the normalized profile picture URL for a user.
 *
 * Avatars are resized to 320px (~display size) at upload, so we serve the raw
 * storage object rather than the render endpoint — this avoids a billable
 * Supabase image transformation per origin image. The render endpoint stays
 * reserved for large, low-volume images (covers, OG cards) via getStorageImageUrl.
 *
 * @param profilePictureUrl - The URL stored in the profile table
 * @returns Normalized raw URL or null
 */
export function getProfilePictureUrl(profilePictureUrl: string | null | undefined): string | null {
  return normalizeStorageUrl(profilePictureUrl, 'profile-pictures');
}

/**
 * Resolve a tournament poster/logo URL for display. Served raw from the public
 * `tournament-logos` bucket (no Supabase image transform).
 * @returns Normalized raw URL or null
 */
export function getTournamentLogoUrl(logoUrl: string | null | undefined): string | null {
  return normalizeStorageUrl(logoUrl, 'tournament-logos');
}

/**
 * Get a thumbnail URL for a group/community cover image.
 * Defaults to 800×400 q75 list-row sizing (retina-friendly); override per
 * surface for headers (e.g. 1200×600 for hero) or square avatars.
 *
 * @param coverImageUrl - The URL stored in the group/community row
 * @param options - Optional sizing overrides
 * @returns Transformed URL or null
 */
export function getCoverImageUrl(
  coverImageUrl: string | null | undefined,
  options: { width?: number; height?: number; quality?: number } = {}
): string | null {
  const normalized = normalizeStorageUrl(coverImageUrl, 'group-images');
  return getStorageImageUrl(normalized, {
    width: options.width ?? 800,
    height: options.height ?? 400,
    quality: options.quality ?? 75,
  });
}
