import { supabase, Logger } from '@rallia/shared-services';

export interface UploadResult {
  url: string | null;
  error: Error | null;
}

/**
 * Get the Supabase URL from environment variables
 * This ensures we always use the current environment's URL
 */
function getSupabaseUrl(): string {
  return process.env.EXPO_PUBLIC_SUPABASE_URL || '';
}

/**
 * Construct a public URL for a storage file
 * Uses the current environment's Supabase URL instead of the one from the client
 *
 * This is important because when running locally, the client might be configured
 * with a local IP address (e.g., http://192.168.1.157:54321) that won't work
 * when the device is on a different network or when switching to production.
 *
 * @param bucket - Storage bucket name
 * @param filePath - Path to the file within the bucket
 * @returns Full public URL for the file
 */
export function getStoragePublicUrl(bucket: string, filePath: string): string {
  const supabaseUrl = getSupabaseUrl();
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
}

/**
 * Convert a stored profile picture URL to use the current environment's Supabase URL
 *
 * This is useful when displaying images that were uploaded in a different environment
 * (e.g., uploaded locally but now viewing in production, or vice versa)
 *
 * @param storedUrl - The URL stored in the database (may have old/different base URL)
 * @param bucket - Storage bucket name (default: 'profile-pictures')
 * @returns URL with the current environment's Supabase base URL
 */
export function normalizeStorageUrl(
  storedUrl: string | null | undefined,
  bucket: string = 'profile-pictures'
): string | null {
  if (!storedUrl) return null;

  // Extract the file path from the stored URL
  // URL format: https://xxx.supabase.co/storage/v1/object/public/{bucket}/{userId}/{filename}
  const bucketPath = `/storage/v1/object/public/${bucket}/`;
  const pathIndex = storedUrl.indexOf(bucketPath);

  if (pathIndex === -1) {
    // URL doesn't match expected format, return as-is
    Logger.warn('Could not normalize storage URL - unexpected format', { storedUrl, bucket });
    return storedUrl;
  }

  const filePath = storedUrl.substring(pathIndex + bucketPath.length);
  return getStoragePublicUrl(bucket, filePath);
}

/**
 * Uploads an image to Supabase Storage and returns the public URL
 *
 * @param imageUri - Local file URI from image picker (file:///, content:///, data:, etc.)
 * @param bucket - Storage bucket name (default: 'profile-pictures')
 * @param userId - User ID for organizing files
 * @returns Public URL of uploaded image or null if failed
 *
 * @example
 * const { url, error } = await uploadImage(imageUri, 'profile-pictures', userId);
 * if (url) {
 *   // Save URL to database
 *   await supabase.from('profile').update({ profile_picture_url: url });
 * }
 */
export async function uploadImage(
  imageUri: string,
  bucket: string = 'profile-pictures',
  userId?: string
): Promise<UploadResult> {
  try {
    // If no userId provided, get from auth
    if (!userId) {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) {
        Logger.error('Auth error getting user for image upload', authError);
        return { url: null, error: new Error(`Auth error: ${authError.message}`) };
      }
      if (!user) {
        Logger.warn('No user session found for image upload');
        return { url: null, error: new Error('User not authenticated - no active session') };
      }
      userId = user.id;
      Logger.debug('Got user ID for image upload', { userId });
    }

    // Create unique filename with folder structure for RLS policy
    // RLS policy expects: (storage.foldername(name))[1] = auth.uid()::text
    // So we must upload to: {userId}/{filename}.ext
    const rawExt = (imageUri.split('.').pop()?.split('?')[0] || 'jpg').toLowerCase();
    // Normalize HEIC/HEIF to JPEG — Supabase Storage doesn't support HEIC
    const fileExt = rawExt === 'heic' || rawExt === 'heif' ? 'jpg' : rawExt;
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${userId}/${fileName}`;
    const contentType = `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`;

    let uploadData: ArrayBuffer | Blob;

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      // Web: Convert data URI or blob URL to blob
      const response = await fetch(imageUri);
      uploadData = await response.blob();
    } else {
      // React Native: Use XMLHttpRequest to get the file as a blob, then use FileReader to convert to ArrayBuffer
      Logger.debug('Reading image file for upload', {
        imageUri: imageUri.substring(0, 50) + '...',
      });
      uploadData = await new Promise<ArrayBuffer>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.onload = () => {
          try {
            const blob = xhr.response as Blob;
            Logger.debug('Got blob from XHR', { blobSize: blob.size, blobType: blob.type });

            // Use FileReader to convert blob to ArrayBuffer (more reliable in RN)
            const reader = new FileReader();
            reader.onloadend = () => {
              if (reader.result instanceof ArrayBuffer) {
                Logger.debug('FileReader converted to ArrayBuffer', {
                  size: reader.result.byteLength,
                });
                resolve(reader.result);
              } else {
                reject(new Error('FileReader did not return ArrayBuffer'));
              }
            };
            reader.onerror = () => reject(new Error('FileReader error'));
            reader.readAsArrayBuffer(blob);
          } catch (e) {
            Logger.error('Error processing blob', e as Error);
            reject(e);
          }
        };
        xhr.onerror = () => {
          Logger.error('XHR error loading image', new Error('XHR failed'));
          reject(new Error('Failed to load image file'));
        };
        xhr.responseType = 'blob';
        xhr.open('GET', imageUri, true);
        xhr.send(null);
      });
    }

    // Upload to Supabase Storage
    Logger.debug('Uploading image to Supabase Storage', { bucket, filePath, contentType, userId });
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, uploadData, {
        contentType,
        upsert: false, // Create new file each time
      });

    if (uploadError) {
      Logger.error('Supabase Storage upload error', uploadError, { bucket, filePath, userId });
      throw uploadError;
    }

    // Get public URL using the helper function
    // This ensures we always use the current environment's Supabase URL
    const publicUrl = getStoragePublicUrl(bucket, filePath);

    Logger.info('Image uploaded successfully', { publicUrl, userId });
    return { url: publicUrl, error: null };
  } catch (error) {
    Logger.error('Error uploading image', error as Error, { bucket, userId });
    return { url: null, error: error as Error };
  }
}

/**
 * Uploads a new image and deletes the old one (if provided)
 * Use this when replacing an existing profile picture to avoid orphaned files.
 *
 * @param imageUri - Local file URI from image picker
 * @param oldImageUrl - URL of the existing image to delete (optional)
 * @param bucket - Storage bucket name (default: 'profile-pictures')
 * @param userId - User ID for organizing files
 * @returns Public URL of uploaded image or null if failed
 *
 * @example
 * const { url, error } = await replaceImage(newImageUri, profile.profile_picture_url, 'profile-pictures');
 */
export async function replaceImage(
  imageUri: string,
  oldImageUrl: string | null | undefined,
  bucket: string = 'profile-pictures',
  userId?: string
): Promise<UploadResult> {
  // First upload the new image
  const result = await uploadImage(imageUri, bucket, userId);

  // If upload succeeded and there was an old image, delete it
  if (result.url && oldImageUrl) {
    // Delete asynchronously - don't block on this
    deleteImage(oldImageUrl, bucket).catch(err => {
      Logger.warn('Failed to delete old image during replace, continuing anyway', {
        oldImageUrl,
        error: err,
      });
    });
  }

  return result;
}

/**
 * Deletes an image from Supabase Storage
 *
 * @param imageUrl - Public URL or file path of the image to delete
 * @param bucket - Storage bucket name (default: 'profile-pictures')
 * @returns Success boolean
 */
export async function deleteImage(
  imageUrl: string,
  bucket: string = 'profile-pictures'
): Promise<boolean> {
  try {
    // Extract file path from public URL
    // URL format: https://xxx.supabase.co/storage/v1/object/public/{bucket}/{userId}/{filename}
    // We need to extract: {userId}/{filename}
    const bucketIndex = imageUrl.indexOf(`/${bucket}/`);
    if (bucketIndex === -1) {
      Logger.warn('Could not find bucket in image URL', { imageUrl, bucket });
      return false;
    }
    const filePath = imageUrl.substring(bucketIndex + bucket.length + 2); // +2 for the slashes

    Logger.debug('Deleting image from storage', { bucket, filePath });
    const { error } = await supabase.storage.from(bucket).remove([filePath]);

    if (error) {
      Logger.error('Error deleting image from storage', error, { bucket, filePath });
      return false;
    }

    Logger.info('Image deleted successfully', { bucket, filePath });
    return true;
  } catch (error) {
    Logger.error('Error deleting image', error as Error, { imageUrl, bucket });
    return false;
  }
}
