/**
 * Image picker utilities with Android-optimized cropping
 *
 * On Android, the native image editor has confusing UI with grayed-out buttons.
 * This utility provides a better experience by using a custom cropper on Android
 * while keeping the native iOS experience.
 */

import { Platform, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SheetManager } from 'react-native-actions-sheet';

export interface PickImageOptions {
  /** Aspect ratio for cropping [width, height], default [1, 1] */
  aspectRatio?: [number, number];
  /** Image quality 0-1, default 0.8 */
  quality?: number;
  /** Source: 'gallery' | 'camera' */
  source?: 'gallery' | 'camera';
  /** Skip editing/cropping entirely */
  skipEditing?: boolean;
  /** Title for the cropper modal */
  title?: string;
}

export interface PickImageResult {
  uri: string | null;
  error?: string;
}

/**
 * Pick an image with platform-optimized editing experience
 *
 * On iOS: Uses native editing (excellent UX)
 * On Android: Uses custom cropper (better than confusing native UI)
 */
export async function pickImageWithCropper(
  options: PickImageOptions = {}
): Promise<PickImageResult> {
  const {
    aspectRatio = [1, 1],
    quality = 0.8,
    source = 'gallery',
    skipEditing = false,
    title,
  } = options;

  // On iOS, use native editing; on Android, we'll show custom cropper
  const useNativeEditing = Platform.OS === 'ios' && !skipEditing;

  try {
    // Request permissions
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== ImagePicker.PermissionStatus.GRANTED) {
        return { uri: null, error: 'Camera permission denied' };
      }
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== ImagePicker.PermissionStatus.GRANTED) {
        return { uri: null, error: 'Photo library permission denied' };
      }
    }

    // Launch picker
    const pickerOptions: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: useNativeEditing,
      aspect: aspectRatio,
      quality,
    };

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(pickerOptions)
        : await ImagePicker.launchImageLibraryAsync(pickerOptions);

    if (result.canceled || !result.assets[0]) {
      return { uri: null };
    }

    const pickedUri = result.assets[0].uri;

    // On Android (and when native editing is disabled), show custom cropper
    if (!useNativeEditing && !skipEditing) {
      return new Promise<PickImageResult>(resolve => {
        void SheetManager.show('image-cropper', {
          payload: {
            imageUri: pickedUri,
            aspectRatio,
            title,
            onConfirm: (croppedUri: string) => {
              resolve({ uri: croppedUri });
            },
            onCancel: () => {
              resolve({ uri: null });
            },
          },
        });
      });
    }

    return { uri: pickedUri };
  } catch (error) {
    console.error('Error picking image:', error);
    return { uri: null, error: 'Failed to pick image' };
  }
}

/**
 * Show permission denied alert
 */
export function showPermissionDeniedAlert(
  t: (key: string) => string,
  permissionType: 'camera' | 'library' = 'library'
): void {
  const titleKey =
    permissionType === 'camera' ? 'groups.permissionRequired' : 'groups.permissionRequired';
  const messageKey =
    permissionType === 'camera' ? 'groups.cameraAccessRequired' : 'groups.photoAccessRequired';

  Alert.alert(t(titleKey), t(messageKey));
}
