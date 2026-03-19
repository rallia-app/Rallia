/**
 * Rating Proof Upload Service
 *
 * Unified service for uploading rating proof files:
 * - Videos → Backblaze B2 (cost-effective for large files)
 * - Images → Supabase Storage
 * - Documents → Supabase Storage
 *
 * This service also handles creating the `file` record in the database
 * and linking it to the `rating_proof` table.
 */

import { supabase, Logger } from '@rallia/shared-services';
import { getStoragePublicUrl } from './imageUpload';
import {
  uploadVideoToBackblaze,
  isBackblazeConfigured,
  BackblazeUploadProgress,
} from './backblazeUpload';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Convert base64 string to Uint8Array for Supabase upload
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Types
export type ProofFileType = 'video' | 'image' | 'document';
export type StorageProvider = 'supabase' | 'backblaze';

export interface ProofUploadResult {
  success: boolean;
  fileId?: string;
  url?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface ProofUploadOptions {
  fileUri: string;
  fileType: ProofFileType;
  originalName: string;
  mimeType: string;
  fileSize: number;
  userId: string;
  playerRatingScoreId: string;
  title: string;
  description?: string;
  onProgress?: (progress: number) => void;
}

/**
 * Determine which storage provider to use based on file type
 */
function getStorageProvider(fileType: ProofFileType): StorageProvider {
  if (fileType === 'video' && isBackblazeConfigured()) {
    return 'backblaze';
  }
  return 'supabase';
}

/**
 * Get Supabase bucket name based on file type
 */
function getSupabaseBucket(fileType: ProofFileType): string {
  switch (fileType) {
    case 'image':
      return 'rating-proof-images';
    case 'document':
      return 'rating-proof-documents';
    case 'video':
      return 'rating-proof-videos'; // Fallback if Backblaze not configured
    default:
      return 'rating-proof-files';
  }
}

/**
 * Upload file to Supabase Storage
 */
async function uploadToSupabase(
  fileUri: string,
  fileType: ProofFileType,
  userId: string,
  originalName: string,
  mimeType: string,
  onProgress?: (progress: number) => void
): Promise<{ url: string; storageKey: string; error?: Error }> {
  const bucket = getSupabaseBucket(fileType);
  const fileExt = originalName.split('.').pop() || 'file';
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const fileName = `${timestamp}-${random}.${fileExt}`;
  const filePath = `${userId}/${fileName}`;

  try {
    // Report starting
    onProgress?.(0);

    // Read file as base64 using expo-file-system (React Native compatible)
    const base64Data = await FileSystem.readAsStringAsync(fileUri, {
      encoding: 'base64',
    });

    // Convert base64 to Uint8Array for upload
    const fileData = base64ToUint8Array(base64Data);

    // Upload to Supabase
    const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, fileData, {
      contentType: mimeType,
      upsert: false,
    });

    if (uploadError) {
      throw uploadError;
    }

    // Get public URL
    const url = getStoragePublicUrl(bucket, filePath);

    // Report completion
    onProgress?.(100);

    Logger.info('Supabase upload completed', { bucket, filePath, url });

    return {
      url,
      storageKey: `${bucket}/${filePath}`,
    };
  } catch (error) {
    Logger.error('Supabase upload error', error as Error, { bucket, fileType });
    return {
      url: '',
      storageKey: '',
      error: error as Error,
    };
  }
}

/**
 * Create a file record in the database
 */
async function createFileRecord(
  userId: string,
  storageKey: string,
  url: string,
  originalName: string,
  fileType: ProofFileType,
  mimeType: string,
  fileSize: number,
  storageProvider: StorageProvider,
  thumbnailUrl?: string
): Promise<{ fileId: string | null; error?: Error }> {
  try {
    // Map our file type to database enum
    const dbFileType =
      fileType === 'document' ? 'document' : fileType === 'image' ? 'image' : 'video';

    const { data, error } = await supabase
      .from('file')
      .insert({
        uploaded_by: userId,
        storage_key: storageKey,
        url,
        thumbnail_url: thumbnailUrl || null,
        original_name: originalName,
        file_type: dbFileType,
        mime_type: mimeType,
        file_size: fileSize,
        storage_provider: storageProvider,
        metadata: {
          proof_type: true,
          uploaded_via: 'mobile_app',
        },
      })
      .select('id')
      .single();

    if (error) {
      throw error;
    }

    Logger.info('File record created', { fileId: data.id, storageProvider });

    return { fileId: data.id };
  } catch (error) {
    Logger.error('Failed to create file record', error as Error);
    return { fileId: null, error: error as Error };
  }
}

/**
 * Create a rating proof record in the database
 */
async function createRatingProofRecord(
  playerRatingScoreId: string,
  fileId: string,
  title: string,
  description?: string
): Promise<{ proofId: string | null; error?: Error }> {
  try {
    // First, get the current rating_score_id from player_rating_score
    // This ensures the proof is linked to the correct rating level at upload time
    const { data: playerRatingScore, error: fetchError } = await supabase
      .from('player_rating_score')
      .select('rating_score_id')
      .eq('id', playerRatingScoreId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    const { data, error } = await supabase
      .from('rating_proof')
      .insert({
        player_rating_score_id: playerRatingScoreId,
        rating_score_id: playerRatingScore.rating_score_id, // Explicitly set the rating level
        proof_type: 'file', // 'file' for uploaded files, 'external_link' for URLs
        file_id: fileId,
        title,
        description: description || null,
        status: 'pending', // All new proofs start as pending
      })
      .select('id')
      .single();

    if (error) {
      throw error;
    }

    Logger.info('Rating proof record created', {
      proofId: data.id,
      ratingScoreId: playerRatingScore.rating_score_id,
    });

    return { proofId: data.id };
  } catch (error) {
    Logger.error('Failed to create rating proof record', error as Error);
    return { proofId: null, error: error as Error };
  }
}

/**
 * Upload a rating proof file (video, image, or document)
 *
 * This is the main entry point for uploading proof files.
 * It handles:
 * 1. Uploading the file to the appropriate storage (Backblaze for videos, Supabase for others)
 * 2. Creating a file record in the database
 * 3. Creating a rating_proof record linked to the file
 */
export async function uploadRatingProofFile(
  options: ProofUploadOptions
): Promise<ProofUploadResult> {
  const {
    fileUri,
    fileType,
    originalName,
    mimeType,
    fileSize,
    userId,
    playerRatingScoreId,
    title,
    description,
    onProgress,
  } = options;

  try {
    Logger.info('Starting rating proof upload', {
      fileType,
      originalName,
      fileSize,
      userId,
    });

    const storageProvider = getStorageProvider(fileType);
    let uploadResult: { url: string; storageKey: string; error?: Error };

    // Upload based on file type and storage provider
    if (storageProvider === 'backblaze' && fileType === 'video') {
      // Upload video to Backblaze
      const bbResult = await uploadVideoToBackblaze(
        fileUri,
        userId,
        originalName,
        (progress: BackblazeUploadProgress) => {
          onProgress?.(progress.percentage);
        }
      );

      if (bbResult.error) {
        throw bbResult.error;
      }

      uploadResult = {
        url: bbResult.url,
        storageKey: `backblaze/${bbResult.fileName}`,
      };
    } else {
      // Upload to Supabase Storage
      uploadResult = await uploadToSupabase(
        fileUri,
        fileType,
        userId,
        originalName,
        mimeType,
        onProgress
      );

      if (uploadResult.error) {
        throw uploadResult.error;
      }
    }

    // Create file record in database
    const fileResult = await createFileRecord(
      userId,
      uploadResult.storageKey,
      uploadResult.url,
      originalName,
      fileType,
      mimeType,
      fileSize,
      storageProvider
    );

    if (fileResult.error || !fileResult.fileId) {
      throw fileResult.error || new Error('Failed to create file record');
    }

    // Create rating proof record
    const proofResult = await createRatingProofRecord(
      playerRatingScoreId,
      fileResult.fileId,
      title,
      description
    );

    if (proofResult.error) {
      // Clean up file record on failure
      await supabase.from('file').delete().eq('id', fileResult.fileId);
      throw proofResult.error;
    }

    Logger.info('Rating proof upload completed successfully', {
      fileId: fileResult.fileId,
      proofId: proofResult.proofId,
      url: uploadResult.url,
    });

    return {
      success: true,
      fileId: fileResult.fileId,
      url: uploadResult.url,
    };
  } catch (error) {
    Logger.error('Rating proof upload failed', error as Error, {
      fileType,
      playerRatingScoreId,
    });

    return {
      success: false,
      error: (error as Error).message || 'Upload failed',
    };
  }
}

/**
 * Update an existing rating proof (title, description, external_url, or file_id)
 */
export async function updateRatingProof(
  proofId: string,
  updates: {
    title?: string;
    description?: string;
    external_url?: string;
    file_id?: string;
  }
): Promise<ProofUploadResult> {
  try {
    // Build the update object - only include non-empty values
    const updateData: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.title !== undefined && updates.title.trim()) {
      updateData.title = updates.title.trim();
    }

    if (updates.description !== undefined) {
      updateData.description = updates.description.trim() || null;
    }

    if (updates.external_url !== undefined && updates.external_url.trim()) {
      updateData.external_url = updates.external_url.trim();
    }

    if (updates.file_id !== undefined) {
      updateData.file_id = updates.file_id;
      // Reset status to pending when file is replaced
      updateData.status = 'pending';
    }

    const { data, error } = await supabase
      .from('rating_proof')
      .update(updateData)
      .eq('id', proofId)
      .select('id, external_url')
      .single();

    if (error) {
      throw error;
    }

    Logger.info('Rating proof updated', { proofId, updates: Object.keys(updateData) });

    return {
      success: true,
      url: data.external_url || undefined,
    };
  } catch (error) {
    Logger.error('Failed to update rating proof', error as Error, { proofId });
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

export interface ReplaceProofFileOptions {
  proofId: string;
  fileUri: string;
  fileType: ProofFileType;
  originalName: string;
  mimeType: string;
  fileSize: number;
  userId: string;
  title: string;
  description?: string;
  onProgress?: (progress: number) => void;
}

/**
 * Replace the file in an existing proof with a new file
 * This uploads a new file and updates the proof to reference it
 */
export async function replaceProofFile(
  options: ReplaceProofFileOptions
): Promise<ProofUploadResult> {
  const {
    proofId,
    fileUri,
    fileType,
    originalName,
    mimeType,
    fileSize,
    userId,
    title,
    description,
    onProgress,
  } = options;

  try {
    Logger.info('Replacing proof file', { proofId, fileType, originalName });

    const storageProvider = getStorageProvider(fileType);
    let uploadResult: { url: string; storageKey: string; error?: Error };

    // Upload based on file type and storage provider
    if (storageProvider === 'backblaze' && fileType === 'video') {
      const bbResult = await uploadVideoToBackblaze(
        fileUri,
        userId,
        originalName,
        (progress: BackblazeUploadProgress) => {
          onProgress?.(progress.percentage);
        }
      );

      if (bbResult.error) {
        throw bbResult.error;
      }

      uploadResult = {
        url: bbResult.url,
        storageKey: `backblaze/${bbResult.fileName}`,
      };
    } else {
      uploadResult = await uploadToSupabase(
        fileUri,
        fileType,
        userId,
        originalName,
        mimeType,
        onProgress
      );

      if (uploadResult.error) {
        throw uploadResult.error;
      }
    }

    // Create new file record
    const fileResult = await createFileRecord(
      userId,
      uploadResult.storageKey,
      uploadResult.url,
      originalName,
      fileType,
      mimeType,
      fileSize,
      storageProvider
    );

    if (fileResult.error || !fileResult.fileId) {
      throw fileResult.error || new Error('Failed to create file record');
    }

    // Update the proof with the new file and reset status to pending
    const updateResult = await updateRatingProof(proofId, {
      file_id: fileResult.fileId,
      title: title,
      description: description,
    });

    if (!updateResult.success) {
      // Clean up the new file on failure
      await supabase.from('file').delete().eq('id', fileResult.fileId);
      throw new Error(updateResult.error || 'Failed to update proof');
    }

    Logger.info('Proof file replaced successfully', { proofId, newFileId: fileResult.fileId });

    return {
      success: true,
      fileId: fileResult.fileId,
      url: uploadResult.url,
    };
  } catch (error) {
    Logger.error('Failed to replace proof file', error as Error, { proofId });
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Create an external link rating proof (no file upload)
 */
export async function createExternalLinkProof(
  playerRatingScoreId: string,
  externalUrl: string,
  title: string,
  description?: string
): Promise<ProofUploadResult> {
  try {
    const { data, error } = await supabase
      .from('rating_proof')
      .insert({
        player_rating_score_id: playerRatingScoreId,
        proof_type: 'external_link',
        external_url: externalUrl,
        title,
        description: description || null,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      throw error;
    }

    Logger.info('External link proof created', { proofId: data.id, externalUrl });

    return {
      success: true,
      url: externalUrl,
    };
  } catch (error) {
    Logger.error('Failed to create external link proof', error as Error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Get supported video formats
 */
export function getSupportedVideoFormats(): string[] {
  return ['mp4', 'mov', 'avi', 'webm', 'mkv', '3gp', 'm4v'];
}

/**
 * Get supported image formats
 */
export function getSupportedImageFormats(): string[] {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'];
}

/**
 * Get supported document formats
 */
export function getSupportedDocumentFormats(): string[] {
  return ['pdf', 'doc', 'docx', 'txt', 'rtf'];
}

/**
 * Get maximum file sizes (in bytes)
 */
export function getMaxFileSizes(): Record<ProofFileType, number> {
  return {
    video: 250 * 1024 * 1024, // 250 MB
    image: 10 * 1024 * 1024, // 10 MB
    document: 25 * 1024 * 1024, // 25 MB
  };
}

/**
 * Validate file before upload
 */
export function validateProofFile(
  fileName: string,
  fileSize: number,
  fileType: ProofFileType
): { valid: boolean; error?: string } {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const maxSizes = getMaxFileSizes();

  // Check file size
  if (fileSize > maxSizes[fileType]) {
    const maxMB = Math.round(maxSizes[fileType] / (1024 * 1024));
    return {
      valid: false,
      error: `File size exceeds maximum allowed (${maxMB} MB)`,
    };
  }

  // Check file format
  let supportedFormats: string[];
  switch (fileType) {
    case 'video':
      supportedFormats = getSupportedVideoFormats();
      break;
    case 'image':
      supportedFormats = getSupportedImageFormats();
      break;
    case 'document':
      supportedFormats = getSupportedDocumentFormats();
      break;
  }

  if (!ext || !supportedFormats.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported file format. Allowed: ${supportedFormats.join(', ')}`,
    };
  }

  return { valid: true };
}
